// pages/api/verify_race.js
// Real implementation with CSE search + HRN/Equibase parsing
// NO Redis/Upstash dependencies - pure search + parse only

// Force Node runtime (not edge)
export const config = { runtime: "nodejs" };

import * as cheerio from "cheerio";
import {
  fetchEquibaseChartHtml,
  parseEquibaseOutcome,
} from "../../lib/equibase.js";

// Safe env var access - never throw if missing
const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

/**
 * Normalize horse name for comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

/**
 * Safely parse request body (supports JSON string)
 */
function safeParseBody(req) {
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  if (!body || typeof body !== "object") {
    body = {};
  }

  return body;
}

/**
 * Extract Win/Place/Show from a runner table using WPS payout indicators
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio<cheerio.Element>} table
 * @param {{ runnerIdx: number; winIdx: number; placeIdx: number; showIdx: number }} idx
 * @returns {{ win: string; place: string; show: string }}
 */
function extractOutcomeFromRunnerTable($, table, idx) {
  const { runnerIdx, winIdx, placeIdx, showIdx } = idx;
  const $rows = $(table).find("tr");
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const runners = [];

  $rows.each((i, tr) => {
    const $cells = $(tr).find("td");
    if (!$cells.length) return;

    const runnerText = runnerIdx > -1 ? norm($cells.eq(runnerIdx).text()) : "";
    if (!runnerText) return;

    // Skip header-ish rows
    if (/runner\s*\(speed\)/i.test(runnerText)) return;

    const winText = winIdx > -1 ? norm($cells.eq(winIdx).text()) : "";
    const placeText = placeIdx > -1 ? norm($cells.eq(placeIdx).text()) : "";
    const showText = showIdx > -1 ? norm($cells.eq(showIdx).text()) : "";

    // If no payouts at all, ignore the row
    if (!winText && !placeText && !showText) return;

    // Normalize runner name: strip footnote markers
    let runnerName = runnerText.replace(/\s*\([^)]*\)\s*$/, "").trim();
    runnerName = normalizeHorseName(runnerName);
    if (!runnerName) return;

    // Hard filters to avoid junk rows
    const lowerRunner = runnerName.toLowerCase();
    const junkPatterns = [
      "preliminary speed figures",
      "also rans",
      "pool",
      "daily double",
      "trifecta",
      "superfecta",
      "pick 3",
      "pick 4",
      "this script inside",
      "head tags",
    ];
    if (
      lowerRunner.startsWith("*") ||
      junkPatterns.some((pattern) => lowerRunner.includes(pattern))
    ) {
      return;
    }

    runners.push({
      name: runnerName,
      hasWin: !!winText && winText !== "-",
      hasPlace: !!placeText && placeText !== "-",
      hasShow: !!showText && showText !== "-",
    });
  });

  if (!runners.length) {
    return { win: "", place: "", show: "" };
  }

  // 1) WIN: first row that has a Win payout
  const winHorse = runners.find((r) => r.hasWin)?.name || "";

  // 2) PLACE: Prefer a horse that has PLACE but not WIN, and is not the WIN horse
  const placeHorse =
    runners.find(
      (r) => r.hasPlace && r.name !== winHorse && !r.hasWin
    )?.name ||
    runners.find((r) => r.hasPlace && r.name !== winHorse)?.name ||
    "";

  // 3) SHOW: Prefer a horse that has SHOW only (no WIN/PLACE) and isn't WIN/PLACE
  const showHorse =
    runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse &&
        !r.hasWin &&
        !r.hasPlace
    )?.name ||
    runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse &&
        !r.hasWin
    )?.name ||
    runners.find(
      (r) => r.hasShow && r.name !== winHorse && r.name !== placeHorse
    )?.name ||
    "";

  return {
    win: winHorse,
    place: placeHorse,
    show: showHorse,
  };
}

/**
 * Parse HRN race-specific outcome from HTML using cheerio
 * Finds the specific race section and parses the Runner (speed) W/P/S table
 * @param {cheerio.CheerioAPI} $
 * @param {string} raceNo
 * @returns {{ win?: string; place?: string; show?: string }}
 */
function parseHRNRaceOutcome($, raceNo) {
  const outcome = {};
  const requestedRaceNo = String(raceNo || "").trim();
  if (!requestedRaceNo) return outcome;

  try {
    // Extract "Race X" from a cheerio node's text
    const getRaceFromNode = (node) => {
      if (!node || !node.length) return null;
      const text = node.text().trim();
      if (!text) return null;
      const m = text.match(/race\s*#?\s*(\d+)/i);
      return m ? m[1] : null;
    };

    const runnerTables = [];

    $("table").each((_, table) => {
      const $table = $(table);
      const headerRow = $table.find("tr").first();
      const headerCells = headerRow.find("th, td").toArray();
      if (!headerCells.length) return;

      const headerTexts = headerCells.map((cell) =>
        $(cell).text().toLowerCase().trim()
      );

      const runnerIdx = headerTexts.findIndex(
        (h) => h.includes("runner") || h.includes("horse")
      );
      const winIdx = headerTexts.findIndex((h) => h.includes("win"));
      const placeIdx = headerTexts.findIndex((h) => h.includes("place"));
      const showIdx = headerTexts.findIndex((h) => h.includes("show"));

      if (
        runnerIdx === -1 ||
        winIdx === -1 ||
        placeIdx === -1 ||
        showIdx === -1
      ) {
        return;
      }

      // Infer which race this table belongs to
      let inferredRaceNo = null;

      // Look at previous siblings
      let prev = $table.prev();
      while (prev.length && !inferredRaceNo) {
        inferredRaceNo = getRaceFromNode(prev);
        prev = prev.prev();
      }

      // Walk up ancestors
      if (!inferredRaceNo) {
        let parent = $table.parent();
        let depth = 0;
        while (parent.length && depth < 6 && !inferredRaceNo) {
          let sib = parent.prev();
          while (sib.length && !inferredRaceNo) {
            inferredRaceNo = getRaceFromNode(sib);
            sib = sib.prev();
          }
          parent = parent.parent();
          depth += 1;
        }
      }

      runnerTables.push({
        table: $table,
        runnerIdx,
        winIdx,
        placeIdx,
        showIdx,
        raceNo: inferredRaceNo,
      });
    });

    if (!runnerTables.length) {
      return outcome;
    }

    // Choose the table whose inferred race number matches requestedRaceNo
    const target =
      runnerTables.find((t) => t.raceNo === requestedRaceNo) ||
      runnerTables[0]; // fallback to first

    const { table: $runnerTable, runnerIdx, winIdx, placeIdx, showIdx } =
      target;

    const extracted = extractOutcomeFromRunnerTable($, $runnerTable, {
      runnerIdx,
      winIdx,
      placeIdx,
      showIdx,
    });

    if (!extracted.win && !extracted.place && !extracted.show) {
      return outcome;
    }

    outcome.win = extracted.win || "";
    outcome.place = extracted.place || "";
    outcome.show = extracted.show || "";
  } catch (error) {
    console.error("[verify_race] parseHRNRaceOutcome failed", error);
  }

  return outcome;
}

/**
 * Parse outcome from HTML using cheerio
 * @param {string} html
 * @param {string} url
 * @param {string | number | null} raceNo
 * @returns {{ win?: string; place?: string; show?: string }}
 */
function parseOutcomeFromHtml(html, url, raceNo = null) {
  const outcome = {};
  try {
    const $ = cheerio.load(html);
    const isHRN = /horseracingnation\.com/i.test(url);

    // For HRN pages, use race-specific parsing
    if (isHRN && raceNo) {
      const hrnOutcome = parseHRNRaceOutcome($, String(raceNo));
      if (hrnOutcome.win || hrnOutcome.place || hrnOutcome.show) {
        return hrnOutcome;
      }
    }

    // Generic parsing: Try to find a results table with finishing positions
    const rows = [];
    $("table tr").each((_, el) => {
      const cells = $(el).find("td, th");
      if (cells.length < 2) return;

      const firstCell = $(cells[0]).text().trim();
      const posMatch =
        firstCell.match(/^(\d+)[a-z]{0,2}$/i) || firstCell.match(/^(\d+)$/);
      if (!posMatch) return;

      const pos = parseInt(posMatch[1], 10);
      if (pos < 1 || pos > 3) return;

      let name = $(cells[1]).text();
      name = normalizeHorseName(name);
      if (!name) return;

      rows.push({ pos, name });
    });

    const byPos = new Map();
    rows.forEach(({ pos, name }) => {
      if (!byPos.has(pos)) {
        byPos.set(pos, name);
      }
    });

    if (byPos.get(1)) outcome.win = byPos.get(1);
    if (byPos.get(2)) outcome.place = byPos.get(2);
    if (byPos.get(3)) outcome.show = byPos.get(3);

    // Text-based heuristics fallback
    if (!outcome.win && !outcome.place && !outcome.show) {
      const winMatch = html.match(/Win[:\s]+([A-Za-z0-9' .\-]+)/i);
      const placeMatch = html.match(/Place[:\s]+([A-Za-z0-9' .\-]+)/i);
      const showMatch = html.match(/Show[:\s]+([A-Za-z0-9' .\-]+)/i);

      if (winMatch) outcome.win = normalizeHorseName(winMatch[1]);
      if (placeMatch) outcome.place = normalizeHorseName(placeMatch[1]);
      if (showMatch) outcome.show = normalizeHorseName(showMatch[1]);
    }
  } catch (error) {
    console.error("[verify_race] parseOutcomeFromHtml failed", error);
  }

  return outcome;
}

/**
 * Extract outcome from result page using cheerio
 * @param {string} url
 * @param {{ track: string; date: string; raceNo?: string | null }} ctx
 * @returns {Promise<{ win?: string; place?: string; show?: string }>}
 */
async function extractOutcomeFromResultPage(url, ctx) {
  try {
    if (!url || typeof url !== "string") {
      return {};
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    }).catch((err) => {
      console.error("[verify_race] fetch failed in extractOutcomeFromResultPage", {
        url,
        error: err?.message || String(err),
      });
      return null;
    });

    if (!res || !res.ok) {
      return {};
    }

    const html = await res.text().catch(() => "");

    if (!html) {
      return {};
    }

    // Verify page contains the correct race number before parsing
    if (ctx && ctx.raceNo) {
      const raceNoStr = String(ctx.raceNo).trim();
      const trackLower = (ctx.track || "").toLowerCase();

      const hasRaceNo = new RegExp(
        `Race\\s*#?\\s*${raceNoStr}\\b`,
        "i"
      ).test(html);

      const hasTrack = trackLower
        ? new RegExp(
            trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i"
          ).test(html)
        : true;

      if (!hasRaceNo || !hasTrack) {
        console.warn("[verify_race] Page validation failed", {
          url,
          raceNo: ctx.raceNo,
          track: ctx.track,
          hasRaceNo,
          hasTrack,
        });
        return {};
      }
    }

    const outcome = parseOutcomeFromHtml(html, url, ctx?.raceNo);
    return outcome || {};
  } catch (error) {
    console.error("[verify_race] extractOutcomeFromResultPage failed", {
      url,
      error: error?.message || String(error),
    });
    return {};
  }
}

/**
 * Direct Google CSE API call
 */
async function cseDirect(query) {
  try {
    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
      throw new Error("Google CSE credentials missing");
    }

    if (!query || typeof query !== "string") {
      throw new Error("Invalid query");
    }

    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.searchParams.set("key", GOOGLE_API_KEY);
    u.searchParams.set("cx", GOOGLE_CSE_ID);
    u.searchParams.set("q", query);
    
    const r = await fetch(u.toString()).catch((err) => {
      throw new Error(`Google CSE fetch failed: ${err?.message || String(err)}`);
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Google CSE ${r.status}: ${text.slice(0, 200)}`);
    }

    const j = await r.json().catch((err) => {
      throw new Error(`Google CSE JSON parse failed: ${err?.message || String(err)}`);
    });

    const items = Array.isArray(j.items) ? j.items : [];
    return items.map((i) => ({
      title: i?.title || "",
      link: i?.link || "",
      snippet: i?.snippet || "",
    }));
  } catch (error) {
    console.error("[verify_race] cseDirect failed", {
      query,
      error: error?.message || String(error),
    });
    throw error; // Re-throw to be caught by runSearch
  }
}

/**
 * CSE via bridge endpoint
 */
async function cseViaBridge(req, query) {
  try {
    if (!query || typeof query !== "string") {
      throw new Error("Invalid query");
    }

    const proto = req?.headers?.["x-forwarded-proto"] || "https";
    const host = req?.headers?.host || "localhost:3000";
    const basePath = (
      process.env.NEXT_PUBLIC_BASE_PATH || process.env.NEXT_BASE_PATH || ""
    ).replace(/\/+$/, "");
    const pathPrefix = basePath
      ? basePath.startsWith("/")
        ? basePath
        : `/${basePath}`
      : "";
    const url = `${proto}://${host}${pathPrefix}/api/cse_resolver?q=${encodeURIComponent(
      query
    )}`;
    
    const r = await fetch(url, { cache: "no-store" }).catch((err) => {
      throw new Error(`CSE bridge fetch failed: ${err?.message || String(err)}`);
    });

    const j = await r.json().catch(() => ({}));
    
    if (!r.ok) {
      throw new Error(j?.error || `CSE bridge ${r.status}`);
    }

    const arr = Array.isArray(j.results) ? j.results : [];
    return arr.map((i) => ({
      title: i?.title || "",
      link: i?.link || "",
      snippet: i?.snippet || "",
    }));
  } catch (error) {
    console.error("[verify_race] cseViaBridge failed", {
      query,
      error: error?.message || String(error),
    });
    throw error; // Re-throw to be caught by runSearch
  }
}

/**
 * Pick best result: prefer HRN entries/results pages, then Equibase
 */
function pickBestResult(results) {
  try {
    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    // 1) Prefer HorseracingNation entries/results pages
    const hrnPreferred = results.find((r) => {
      const url = (r?.link || "").toLowerCase();
      return (
        url.includes("horseracingnation.com") &&
        (url.includes("/entries-results/") ||
          url.includes("/entries/") ||
          url.includes("/entries-results-"))
      );
    });
    if (hrnPreferred) {
      return {
        title: hrnPreferred.title || "",
        link: hrnPreferred.link || "",
        snippet: hrnPreferred.snippet || "",
      };
    }

    // 2) Fall back to Equibase chart pages
    const equibaseChart = results.find((r) => {
      const url = (r?.link || "").toLowerCase();
      return url.includes("equibase.com") && url.includes("chart");
    });
    if (equibaseChart) {
      return {
        title: equibaseChart.title || "",
        link: equibaseChart.link || "",
        snippet: equibaseChart.snippet || "",
      };
    }

    // 3) Finally, just use the first result
    const first = results[0];
    return first
      ? {
          title: first.title || "",
          link: first.link || "",
          snippet: first.snippet || "",
        }
      : null;
  } catch (error) {
    console.error("[verify_race] pickBestResult failed", {
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Run search (direct or via bridge)
 */
async function runSearch(req, query) {
  try {
    if (!query || typeof query !== "string") {
      throw new Error("Invalid query parameter");
    }

    return GOOGLE_API_KEY && GOOGLE_CSE_ID
      ? await cseDirect(query)
      : await cseViaBridge(req, query);
  } catch (error) {
    console.error("[verify_race] runSearch failed", {
      query,
      error: error?.message || String(error),
    });
    throw error; // Re-throw to be caught by handler
  }
}

export default async function handler(req, res) {
  // Initialize safe defaults *outside* try so they exist in the catch
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: false,
        step: "verify_race_method",
        error: "Method Not Allowed",
        details: "Only POST is allowed",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        summary: "Invalid method",
      });
    }

    const body = safeParseBody(req);

    const {
      track,
      date: inputDate,
      raceNo,
      race_no,
      predicted = {},
    } = body;

    const raceNumber = raceNo ?? race_no ?? null;

    safeDate = (inputDate && String(inputDate).trim()) || "";
    safeTrack = track || null;
    safeRaceNo = raceNumber;

    // Validation: track is required
    if (!track) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_validation",
        error: "Missing required field: track",
        details: "Track is required to verify a race",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        summary: "Track is required",
      });
    }

    // Build search queries
    const racePart = raceNumber ? ` Race ${raceNumber}` : "";
    const datePart = safeDate ? ` ${safeDate}` : "";
    const baseQuery = `${track}${racePart}${datePart} results Win Place Show order`;
    const altQuery = `${track}${racePart}${datePart} result chart official`;
    const siteBias =
      "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";

    const queries = [
      `${baseQuery} ${siteBias}`.trim(),
      `${altQuery} ${siteBias}`.trim(),
      baseQuery,
      altQuery,
    ];

    let results = [];
    let queryUsed = queries[0] || "";
    let lastError = null;

    // Try each query until we get results
    for (const q of queries) {
      if (!q) continue;
      try {
        const items = await runSearch(req, q);
        queryUsed = q;
        results = items || [];
        if (items && items.length) break;
      } catch (err) {
        lastError = err;
        console.error("[verify_race] Search query failed", {
          query: q,
          error: err?.message || String(err),
        });
      }
    }

    if (!results || !results.length) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_search",
        error: "Search failed",
        details:
          lastError?.message ||
          "No search results from Google CSE / CSE resolver",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        query: queryUsed,
        summary: "No search results",
      });
    }

    const top = pickBestResult(results); // must NOT throw; return null or a safe object

    let outcome = { win: "", place: "", show: "" };

    if (top && top.link) {
      // Route into HRN / Equibase parser using your helpers
      const parsed = await extractOutcomeFromResultPage(top.link, {
        track: safeTrack || "",
        date: safeDate || "",
        raceNo: raceNumber,
      });

      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        outcome = {
          win: parsed.win || "",
          place: parsed.place || "",
          show: parsed.show || "",
        };
      }
    }

    // Try Equibase parsing if applicable
    if (
      top &&
      top.link &&
      top.link.toLowerCase().includes("equibase.com") &&
      safeDate &&
      raceNumber
    ) {
      try {
        const html = await fetchEquibaseChartHtml({
          track: safeTrack || "",
          dateISO: safeDate,
          raceNo: String(raceNumber || ""),
        }).catch((err) => {
          console.error("[verify_race] fetchEquibaseChartHtml failed", {
            error: err?.message || String(err),
          });
          return null;
        });

        if (html) {
          const equibaseOutcome = parseEquibaseOutcome(html);
          if (
            equibaseOutcome &&
            (equibaseOutcome.win ||
              equibaseOutcome.place ||
              equibaseOutcome.show)
          ) {
            outcome = {
              win: equibaseOutcome.win || "",
              place: equibaseOutcome.place || "",
              show: equibaseOutcome.show || "",
            };
          }
        }
      } catch (equibaseError) {
        console.error("[verify_race] Equibase parse failed", {
          link: top?.link,
          error: equibaseError?.message || String(equibaseError),
        });
        // Continue with existing outcome
      }
    }

    // Normalize predictions and compute hits (Win / Place / Show / Top3)
    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const normalizeName = (value = "") =>
      (value || "").toLowerCase().replace(/\s+/g, " ").trim();

    const pWin = normalizeName(predictedSafe.win);
    const pPlace = normalizeName(predictedSafe.place);
    const pShow = normalizeName(predictedSafe.show);
    const oWin = normalizeName(outcome.win);
    const oPlace = normalizeName(outcome.place);
    const oShow = normalizeName(outcome.show);

    const hits = {
      winHit: !!pWin && !!oWin && pWin === oWin,
      placeHit: !!pPlace && !!oPlace && pPlace === oPlace,
      showHit: !!pShow && !!oShow && pShow === oShow,
      top3Hit:
        (!!pWin && [oWin, oPlace, oShow].includes(pWin)) ||
        (!!pPlace && [oWin, oPlace, oShow].includes(pPlace)) ||
        (!!pShow && [oWin, oPlace, oShow].includes(pShow)),
    };

    // Build human-readable summary for the UI
    const lines = [];
    if (queryUsed) lines.push(`Query: ${queryUsed}`);
    if (top?.title) lines.push(`Top: ${top.title} -> ${top.link}`);
    if (top?.link) {
      try {
        const hostname = new URL(top.link).hostname;
        lines.push(`Host: ${hostname}`);
      } catch {
        // ignore URL parse error
      }
    }
    const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(
      Boolean,
    );
    if (outcomeParts.length) {
      lines.push(`Outcome: ${outcomeParts.join(" / ")}`);
    }
    const hitParts = [
      hits.winHit ? "Win" : null,
      hits.placeHit ? "Place" : null,
      hits.showHit ? "Show" : null,
      hits.top3Hit ? "Top3" : null,
    ].filter(Boolean);
    if (hitParts.length) {
      lines.push(`Hits: ${hitParts.join(", ")}`);
    }

    const summary = lines.join("\n") || "No outcome parsed";

    return res.status(200).json({
      ok: true,
      step: "verify_race",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      query: queryUsed,
      top: top
        ? { title: top.title || null, link: top.link || null }
        : null,
      outcome,
      predicted: predictedSafe,
      hits,
      summary,
    });
  } catch (err) {
    // Final safety net: NEVER let this throw a 500
    console.error("[verify_race] outer handler error", err);

    return res.status(200).json({
      ok: false,
      step: "verify_race_outer",
      error: String(err?.message || err || "Unknown error"),
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary: "verify_race outer handler error",
    });
  }
}
