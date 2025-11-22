// pages/api/verify_race.js

// Restored HRN/Equibase parsing on top of ultra-safe Google fallback
// - Always returns HTTP 200 with structured JSON
// - Never throws unhandled errors
// - Tries CSE search + HRN/Equibase parsing first
// - Falls back to Google search URL if parsing fails

import * as cheerio from "cheerio";
import {
  fetchEquibaseChartHtml,
  parseEquibaseOutcome,
  getEquibaseTrackCode,
} from "../../lib/equibase.js";

export const config = {
  runtime: "nodejs",
};

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

const preferHosts = [
  "horseracingnation.com",
  "entries.horseracingnation.com",
  "equibase.com",
];

/**
 * Normalize horse name for comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
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

    // Get raw texts
    const runnerText =
      runnerIdx > -1 ? norm($cells.eq(runnerIdx).text()) : "";

    if (!runnerText) return;

    // Skip header-ish rows that somehow ended up as <td>
    if (/runner\s*\(speed\)/i.test(runnerText)) return;

    const winText =
      winIdx > -1 ? norm($cells.eq(winIdx).text()) : "";

    const placeText =
      placeIdx > -1 ? norm($cells.eq(placeIdx).text()) : "";

    const showText =
      showIdx > -1 ? norm($cells.eq(showIdx).text()) : "";

    // If the row has no payouts at all, it's not useful for W/P/S.
    if (!winText && !placeText && !showText) return;

    // Normalize runner name: strip footnote markers like (*) or (114*)
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
      return; // Skip this row
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
  let winHorse =
    runners.find((r) => r.hasWin)?.name || "";

  // 2) PLACE:
  // Prefer a horse that has PLACE but not WIN, and is not the WIN horse
  let placeHorse =
    runners.find(
      (r) =>
        r.hasPlace &&
        r.name !== winHorse &&
        !r.hasWin
    )?.name ||
    runners.find(
      (r) =>
        r.hasPlace &&
        r.name !== winHorse
    )?.name ||
    "";

  // 3) SHOW:
  // Prefer a horse that has SHOW only (no WIN/PLACE) and isn't WIN/PLACE
  let showHorse =
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
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse
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
    // --- 1) Collect all candidate Runner/Win/Place/Show tables and infer their race number ---
    /**
     * Try to extract "Race X" from a cheerio node's text.
     * Returns the race number as a string, or null if not found.
     */
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

      // Identify Runner / Win / Place / Show columns
      const runnerIdx = headerTexts.findIndex(
        (h) => h.includes("runner") || h.includes("horse")
      );
      const winIdx = headerTexts.findIndex((h) => h.includes("win"));
      const placeIdx = headerTexts.findIndex((h) => h.includes("place"));
      const showIdx = headerTexts.findIndex((h) => h.includes("show"));

      // Not a Runner (speed) W/P/S table
      if (
        runnerIdx === -1 ||
        winIdx === -1 ||
        placeIdx === -1 ||
        showIdx === -1
      ) {
        return;
      }

      // --- Infer which race this table belongs to by scanning nearby headings ---
      let inferredRaceNo = null;

      // 1a) Look at previous siblings of the table
      let prev = $table.prev();
      while (prev.length && !inferredRaceNo) {
        inferredRaceNo = getRaceFromNode(prev);
        prev = prev.prev();
      }

      // 1b) Walk up ancestors and inspect their previous siblings
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

    // --- 2) Choose the table whose inferred race number matches requestedRaceNo ---
    let target =
      runnerTables.find((t) => t.raceNo === requestedRaceNo) ||
      runnerTables[0]; // fallback to first if we couldn't infer a race number

    const { table: $runnerTable, runnerIdx, winIdx, placeIdx, showIdx } = target;

    // --- Extract win/place/show from the chosen runner table using WPS payouts ---
    const extracted = extractOutcomeFromRunnerTable($, $runnerTable, {
      runnerIdx,
      winIdx,
      placeIdx,
      showIdx,
    });

    if (!extracted.win && !extracted.place && !extracted.show) {
      console.warn("[verify_race][hrn] extractOutcomeFromRunnerTable returned empty outcome");
    } else {
      outcome.win = extracted.win || "";
      outcome.place = extracted.place || "";
      outcome.show = extracted.show || "";
    }
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
      // If HRN parsing failed, fall through to generic parsing
    }

    // Generic parsing: Try to find a results table with finishing positions
    const rows = [];
    $("table tr").each((_, el) => {
      const cells = $(el).find("td, th");
      if (cells.length < 2) return;

      const firstCell = $(cells[0]).text().trim();
      // Match position: "1", "1st", "2", "2nd", etc.
      const posMatch =
        firstCell.match(/^(\d+)[a-z]{0,2}$/i) || firstCell.match(/^(\d+)$/);
      if (!posMatch) return;

      const pos = parseInt(posMatch[1], 10);
      // Only care about positions 1, 2, 3
      if (pos < 1 || pos > 3) return;

      let name = $(cells[1]).text();
      name = normalizeHorseName(name);
      if (!name) return;

      rows.push({ pos, name });
    });

    // Build outcome from rows
    const byPos = new Map();
    rows.forEach(({ pos, name }) => {
      if (!byPos.has(pos)) {
        byPos.set(pos, name);
      }
    });

    if (byPos.get(1)) outcome.win = byPos.get(1);
    if (byPos.get(2)) outcome.place = byPos.get(2);
    if (byPos.get(3)) outcome.show = byPos.get(3);

    // If we didn't find anything in tables, try text-based heuristics
    if (!outcome.win && !outcome.place && !outcome.show) {
      // Look for "Win: HorseName" patterns
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
 * Extract outcome from result page
 * @param {string} url
 * @param {{ track: string; date: string; raceNo?: string | null }} ctx
 * @returns {Promise<{ win?: string; place?: string; show?: string }>}
 */
async function extractOutcomeFromResultPage(url, ctx) {
  try {
    if (!url || typeof url !== "string") {
      return {};
    }

    const link = url.toLowerCase();
    const isHRN = link.includes("horseracingnation.com");
    const isEquibase = link.includes("equibase.com");

    // For Equibase, use the dedicated parser
    if (isEquibase && ctx.track && ctx.date) {
      try {
        const html = await fetchEquibaseChartHtml({
          track: ctx.track,
          dateISO: ctx.date,
          raceNo: String(ctx.raceNo || ""),
        });
        const equibaseOutcome = parseEquibaseOutcome(html);
        if (equibaseOutcome && (equibaseOutcome.win || equibaseOutcome.place || equibaseOutcome.show)) {
          return {
            win: equibaseOutcome.win || "",
            place: equibaseOutcome.place || "",
            show: equibaseOutcome.show || "",
          };
        }
      } catch (equibaseError) {
        console.error("[verify_race] Equibase parse failed", {
          url,
          error: equibaseError?.message,
        });
        // Fall through to generic parsing
      }
    }

    // For HRN or generic pages, fetch and parse HTML
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    }).catch((err) => {
      console.error("[verify_race] fetch failed", {
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
    if (ctx.raceNo) {
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

    const outcome = parseOutcomeFromHtml(html, url, ctx.raceNo);
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
 * Safely parse the request body
 */
function safeParseBody(req) {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== "object") {
      return {};
    }
    return body;
  } catch {
    return {};
  }
}

/**
 * Google HTML fallback - returns a Google search URL when parsing fails
 */
async function googleHtmlFallback(track, date, raceNo) {
  const datePart = date ? ` ${date}` : "";
  const racePart = raceNo ? ` Race ${raceNo}` : "";
  const query = `${track}${racePart}${datePart} results Win Place Show`.trim();

  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  const top = {
    title: `Google search: ${query}`,
    link: googleUrl,
  };

  const outcome = {
    win: "",
    place: "",
    show: "",
  };

  const predictedSafe = {
    win: "",
    place: "",
    show: "",
  };

  const hits = {
    winHit: false,
    placeHit: false,
    showHit: false,
    top3Hit: false,
  };

  const summaryLines = [
    "Ultra-safe verify_race fallback (no external APIs).",
    "",
    `Track: ${track || "(none)"}`,
    `Date: ${date || "(none)"}`,
    `Race #: ${raceNo ?? "(none)"}`,
    "",
    `Query: ${query}`,
    `Top Result: ${top.link}`,
    "",
    "Note: This fallback does NOT auto-parse Win/Place/Show from charts.",
    "Use the 'Open Top Result' button to view search results and official charts.",
  ];

  const summary = summaryLines.join("\n");

  return {
    ok: true,
    step: "verify_race_google_fallback",
    query,
    top,
    outcome,
    predicted: predictedSafe,
    hits,
    summary,
  };
}

/**
 * CSE Direct search (with safe error handling)
 */
async function cseDirect(query) {
  try {
    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
      console.warn("[verify_race] Google CSE credentials missing");
      return [];
    }
    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.searchParams.set("key", GOOGLE_API_KEY);
    u.searchParams.set("cx", GOOGLE_CSE_ID);
    u.searchParams.set("q", query);
    const r = await fetch(u.toString()).catch((err) => {
      console.error("[verify_race] CSE fetch failed", err);
      return null;
    });
    if (!r || !r.ok) {
      const text = await r?.text().catch(() => "") || "";
      console.error("[verify_race] CSE response not ok", {
        status: r?.status,
        text: text.slice(0, 200),
      });
      return [];
    }
    const j = await r.json().catch((err) => {
      console.error("[verify_race] CSE JSON parse failed", err);
      return { items: [] };
    });
    const items = Array.isArray(j.items) ? j.items : [];
    return items.map((i) => ({
      title: i?.title || "",
      link: i?.link || "",
      snippet: i?.snippet || "",
    }));
  } catch (err) {
    console.error("[verify_race] cseDirect error", err);
    return [];
  }
}

/**
 * CSE Via Bridge (with safe error handling)
 */
async function cseViaBridge(req, query) {
  try {
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
      console.error("[verify_race] CSE bridge fetch failed", err);
      return null;
    });
    if (!r) {
      return [];
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("[verify_race] CSE bridge response not ok", {
        status: r.status,
        error: j?.error,
      });
      return [];
    }
    const arr = Array.isArray(j.results) ? j.results : [];
    return arr.map((i) => ({
      title: i?.title || "",
      link: i?.link || "",
      snippet: i?.snippet || "",
    }));
  } catch (err) {
    console.error("[verify_race] cseViaBridge error", err);
    return [];
  }
}

/**
 * Pick best result from search results (prefer HRN/Equibase)
 */
function pickBestResult(items) {
  try {
    if (!Array.isArray(items) || !items.length) return null;

    // 1) Prefer HorseracingNation entries/results pages
    const hrnPreferred = items.find((r) => {
      const url = (r?.link || "").toLowerCase();
      return (
        url.includes("horseracingnation.com") &&
        (url.includes("/entries-results/") ||
          url.includes("/entries/") ||
          url.includes("/entries-results-"))
      );
    });
    if (hrnPreferred) return hrnPreferred;

    // 2) Fall back to Equibase chart pages
    const equibaseChart = items.find((r) => {
      const url = (r?.link || "").toLowerCase();
      return url.includes("equibase.com") && url.includes("chart");
    });
    if (equibaseChart) return equibaseChart;

    // 3) Finally, just use the first result
    return items[0];
  } catch (err) {
    console.error("[verify_race] pickBestResult error", String(err?.message || err));
    return null;
  }
}

/**
 * Run search (CSE direct or via bridge)
 */
async function runSearch(req, query) {
  try {
    const items = await (GOOGLE_API_KEY && GOOGLE_CSE_ID
      ? cseDirect(query)
      : cseViaBridge(req, query));
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error("[verify_race] runSearch error", String(err?.message || err));
    return [];
  }
}

export default async function handler(req, res) {
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  if (req.method !== "POST") {
    return res.status(200).json({
      ok: false,
      step: "verify_race_method_validation",
      error: "Method Not Allowed",
      details: "Only POST requests are accepted",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary: "verify_race accepts only POST.",
    });
  }

  try {
    const body = safeParseBody(req);
    const {
      track,
      date: inputDate,
      raceNo,
      race_no,
      predicted = {},
    } = body || {};

    const raceNumber = raceNo ?? race_no ?? null;

    safeTrack = track || "";
    safeDate = (inputDate && String(inputDate).trim()) || "";
    safeRaceNo = raceNumber ? String(raceNumber).trim() : null;

    if (!safeTrack) {
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
        summary: "Track is required for verify_race.",
      });
    }

    // ---------- SEARCH + PARSE PATH ----------

    const racePart = safeRaceNo ? ` Race ${safeRaceNo}` : "";
    const baseQuery = `${safeTrack}${racePart} ${safeDate} results Win Place Show`.trim();
    const altQuery = `${safeTrack}${racePart} ${safeDate} result chart official`.trim();
    const siteBias =
      "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";

    const queries = [
      `${baseQuery} ${siteBias}`.trim(),
      `${altQuery} ${siteBias}`.trim(),
      baseQuery,
      altQuery,
    ];

    let results = [];
    let queryUsed = queries[0];

    for (const q of queries) {
      const items = await runSearch(req, q);
      if (items && items.length) {
        results = items;
        queryUsed = q;
        break;
      }
    }

    let step = "verify_race";
    let top = null;
    let outcome = { win: "", place: "", show: "" };

    if (results.length) {
      top = pickBestResult(results);
      if (top && top.link) {
        outcome = await extractOutcomeFromResultPage(top.link, {
          track: safeTrack,
          date: safeDate,
          raceNo: safeRaceNo,
        });
      }
    }

    // If we still have no outcome, fall back to the existing Google HTML fallback implementation
    if (!outcome || (!outcome.win && !outcome.place && !outcome.show)) {
      step = "verify_race_google_fallback";
      const fb = await googleHtmlFallback(safeTrack, safeDate, safeRaceNo);
      // fb should include: query, top, outcome, hits, summary
      return res.status(200).json({
        ok: fb.ok ?? true,
        step,
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        query: fb.query,
        top: fb.top || null,
        outcome: fb.outcome || { win: "", place: "", show: "" },
        predicted: fb.predicted || {
          win: predicted.win || "",
          place: predicted.place || "",
          show: predicted.show || "",
        },
        hits: fb.hits || {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        summary: fb.summary || "Ultra-safe verify_race fallback (no external APIs).",
      });
    }

    // ---------- HIT CALCULATION ----------

    const norm = (v = "") => v.toString().toLowerCase().replace(/\s+/g, " ").trim();

    const predictedSafe = {
      win: predicted.win ? String(predicted.win) : "",
      place: predicted.place ? String(predicted.place) : "",
      show: predicted.show ? String(predicted.show) : "",
    };

    const pWin = norm(predictedSafe.win);
    const pPlace = norm(predictedSafe.place);
    const pShow = norm(predictedSafe.show);
    const oWin = norm(outcome.win);
    const oPlace = norm(outcome.place);
    const oShow = norm(outcome.show);

    const hits = {
      winHit: !!pWin && !!oWin && pWin === oWin,
      placeHit: !!pPlace && !!oPlace && pPlace === oPlace,
      showHit: !!pShow && !!oShow && pShow === oShow,
      top3Hit:
        (!!pWin && [oWin, oPlace, oShow].includes(pWin)) ||
        (!!pPlace && [oWin, oPlace, oShow].includes(pPlace)) ||
        (!!pShow && [oWin, oPlace, oShow].includes(pShow)),
    };

    const summaryLines = [];
    summaryLines.push(`Using date: ${safeDate || "(none)"}`);
    summaryLines.push(`Step: ${step}`);
    summaryLines.push(`Query: ${queryUsed}`);
    if (top?.title) summaryLines.push(`Top: ${top.title} -> ${top.link || "(no link)"}`);
    if (outcome.win || outcome.place || outcome.show) {
      const parts = [outcome.win, outcome.place, outcome.show].filter(Boolean);
      summaryLines.push(`Outcome: ${parts.join(" / ")}`);
    }
    const hitLabels = [];
    if (hits.winHit) hitLabels.push("Win");
    if (hits.placeHit) hitLabels.push("Place");
    if (hits.showHit) hitLabels.push("Show");
    if (hits.top3Hit) hitLabels.push("Top3");
    if (hitLabels.length) summaryLines.push(`Hits: ${hitLabels.join(", ")}`);

    const summary = summaryLines.join("\n");

    const response = {
      ok: true,
      step,
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      query: queryUsed,
      top: top && top.link ? { title: top.title || "", link: top.link } : null,
      outcome,
      predicted: predictedSafe,
      hits,
      summary,
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error("[verify_race] outer handler error", err);
    return res.status(200).json({
      ok: false,
      step: "verify_race_outer_error",
      error: String(err?.message || err),
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary: "verify_race outer error – see server logs for details.",
    });
  }
}
