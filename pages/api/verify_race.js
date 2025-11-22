// pages/api/verify_race.js
//
// CSE + HRN/Equibase parsing with safe google-only fallback
// - Tries CSE search + HRN/Equibase parsing first
// - Falls back to Google search URL if CSE/parsing fails
// - Always returns HTTP 200 with structured JSON
// - No Redis / Upstash dependencies
// - No top-level executable code

import * as cheerio from "cheerio";
import {
  fetchEquibaseChartHtml,
  parseEquibaseOutcome,
} from "../../lib/equibase.js";

export const config = {
  runtime: "nodejs",
};

/**
 * Safely parse the request body into a plain object.
 */
function safeParseBody(req) {
  const body = req.body;
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") {
    return body;
  }
  return {};
}

/**
 * Normalize horse name for comparison
 */
function normalizeHorseName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

/**
 * Extract Win/Place/Show from a runner table using WPS payout indicators
 */
function extractOutcomeFromRunnerTable($, table, idx) {
  try {
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
  } catch (err) {
    console.error("[verify_race] extractOutcomeFromRunnerTable error", err);
    return { win: "", place: "", show: "" };
  }
}

/**
 * Parse HRN race-specific outcome from HTML using cheerio
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
 */
async function extractOutcomeFromResultPage(url, ctx) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    });

    if (!res.ok) {
      return {};
    }

    const html = await res.text();

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
    return outcome;
  } catch (error) {
    console.error("[verify_race] extractOutcomeFromResultPage failed", {
      url,
      error: error?.message || String(error),
    });
    return {};
  }
}

/**
 * Direct Google CSE API call (with error handling)
 */
async function cseDirect(query) {
  try {
    // Read env vars inside function, not at top level
    const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
    const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
      console.warn("[verify_race] Google CSE credentials missing");
      return [];
    }

    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.searchParams.set("key", GOOGLE_API_KEY);
    u.searchParams.set("cx", GOOGLE_CSE_ID);
    u.searchParams.set("q", query);

    const r = await fetch(u.toString());
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("[verify_race] CSE API error", {
        status: r.status,
        text: text.slice(0, 200),
      });
      return [];
    }

    const j = await r.json().catch((err) => {
      console.error("[verify_race] CSE JSON parse error", err);
      return { items: [] };
    });

    const items = Array.isArray(j.items) ? j.items : [];
    return items.map((i) => ({
      title: i.title || "",
      link: i.link || "",
      snippet: i.snippet || "",
    }));
  } catch (err) {
    console.error("[verify_race] cseDirect error", String(err?.message || err));
    return [];
  }
}

/**
 * CSE via bridge endpoint (with error handling)
 */
async function cseViaBridge(req, query) {
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
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

    if (!r || !r.ok) {
      console.error("[verify_race] CSE bridge response not ok", {
        status: r?.status,
      });
      return [];
    }

    const j = await r.json().catch(() => ({}));

    const arr = Array.isArray(j.results) ? j.results : [];
    return arr.map((i) => ({
      title: i.title || "",
      link: i.link || "",
      snippet: i.snippet || "",
    }));
  } catch (err) {
    console.error("[verify_race] cseViaBridge error", String(err?.message || err));
    return [];
  }
}

/**
 * Pick best result: prefer HRN entries/results pages, then Equibase
 */
function pickBestResult(results) {
  try {
    if (!Array.isArray(results) || results.length === 0) return null;

    // 1) Prefer HorseracingNation entries/results pages
    const hrnPreferred = results.find((r) => {
      const url = (r.link || "").toLowerCase();
      return (
        url.includes("horseracingnation.com") &&
        (url.includes("/entries-results/") ||
          url.includes("/entries/") ||
          url.includes("/entries-results-"))
      );
    });
    if (hrnPreferred) return hrnPreferred;

    // 2) Fall back to Equibase chart pages
    const equibaseChart = results.find((r) => {
      const url = (r.link || "").toLowerCase();
      return url.includes("equibase.com") && url.includes("chart");
    });
    if (equibaseChart) return equibaseChart;

    // 3) Finally, just use the first result
    return results[0];
  } catch (err) {
    console.error("[verify_race] pickBestResult error", err);
    return null;
  }
}

/**
 * Run search (direct or via bridge)
 */
async function runSearch(req, query) {
  try {
    // Read env vars inside function, not at top level
    const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
    const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

    const items = await (GOOGLE_API_KEY && GOOGLE_CSE_ID
      ? cseDirect(query)
      : cseViaBridge(req, query));

    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error("[verify_race] runSearch error", String(err?.message || err));
    return [];
  }
}

/**
 * Build a human-readable query for the race.
 */
function buildQuery({ track, date, raceNo }) {
  const parts = [];
  if (track) {
    parts.push(track);
  }
  if (raceNo) {
    parts.push(`Race ${raceNo}`);
  }
  if (date) {
    parts.push(date);
  }
  parts.push("results Win Place Show");
  return parts.join(" ");
}

/**
 * Build a Google search URL for the given query.
 */
function buildGoogleSearchUrl(query) {
  const base = "https://www.google.com/search";
  const qs = `q=${encodeURIComponent(query || "")}`;
  return `${base}?${qs}`;
}

/**
 * Normalize prediction object into a consistent shape.
 */
function normalizePredicted(predicted) {
  if (!predicted || typeof predicted !== "object") {
    return { win: "", place: "", show: "" };
  }
  return {
    win: String(predicted.win || "").trim(),
    place: String(predicted.place || "").trim(),
    show: String(predicted.show || "").trim(),
  };
}

/**
 * Google-only fallback response
 */
function buildGoogleFallbackResponse(track, date, raceNo, query, predicted) {
  const googleUrl = buildGoogleSearchUrl(query);
  const top = {
    title: `Google search: ${query}`,
    link: googleUrl,
  };

  const outcome = { win: "", place: "", show: "" };
  const hits = {
    winHit: false,
    placeHit: false,
    showHit: false,
    top3Hit: false,
  };

  const summaryLines = [
    `Using date: ${date || "(none)"}`,
    "Step: verify_race_google_only",
    "",
    `Query: ${query || "(none)"}`,
    `Top Result: ${top.title}`,
    `URL: ${top.link}`,
    "",
    "Outcome: (none) - using google-only fallback",
    "Hits: none",
    "",
    `Track: ${track || "(none)"}`,
    `Race #: ${raceNo || "(none)"}`,
    "",
    "Note: CSE search or parsing failed. Using Google search fallback.",
  ];

  return {
    ok: true,
    step: "verify_race_google_only",
    date,
    track,
    raceNo,
    query,
    top,
    outcome,
    predicted,
    hits,
    summary: summaryLines.join("\n"),
    debug: {
      googleUrl: googleUrl,
    },
  };
}

/**
 * Core verify implementation
 */
async function verifyRace(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "POST") {
    return res.status(200).json({
      ok: false,
      step: "verify_race_invalid_method",
      error: "Only POST is supported for verify_race.",
      date: null,
      track: null,
      raceNo: null,
      query: "",
      top: null,
      outcome: { win: "", place: "", show: "" },
      predicted: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary:
        "Step: verify_race_invalid_method\nError: Only POST is supported for verify_race.",
      debug: {
        googleUrl: null,
      },
    });
  }

  const body = safeParseBody(req);
  const track = String(body.track || "").trim();
  const date = String(body.date || "").trim();
  const raceNo = String(body.raceNo || body.race || "").trim();
  const predicted = normalizePredicted(body.predicted);

  if (!track || !date) {
    const query = buildQuery({ track, date, raceNo });
    const googleUrl = buildGoogleSearchUrl(query);

    return res.status(200).json({
      ok: false,
      step: "verify_race_validation",
      error: "Missing required field(s)",
      details: "Track and date are required to verify a race",
      date,
      track,
      raceNo,
      query,
      top: null,
      outcome: { win: "", place: "", show: "" },
      predicted,
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary: "Track and date are required for verify_race.",
      debug: {
        googleUrl,
      },
    });
  }

  // Build search queries
  const racePart = raceNo ? ` Race ${raceNo}` : "";
  const baseQuery = `${track}${racePart} ${date} results Win Place Show order`;
  const altQuery = `${track}${racePart} ${date} result chart official`;
  const siteBias =
    "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";

  const queries = [
    `${baseQuery} ${siteBias}`.trim(),
    `${altQuery} ${siteBias}`.trim(),
    baseQuery,
    altQuery,
  ];

  // Try CSE + HRN/Equibase parsing path
  let results = [];
  let queryUsed = queries[0];
  let lastError = null;

  for (const q of queries) {
    try {
      const items = await runSearch(req, q);
      if (items && items.length > 0) {
        results = items;
        queryUsed = q;
        break;
      }
    } catch (error) {
      lastError = error;
      console.error("[verify_race] Search query failed", {
        query: q,
        error: error?.message || String(error),
      });
    }
  }

  // If we have results, try to parse
  if (results.length > 0) {
    const top = pickBestResult(results);

    if (top && top.link) {
      let parsedOutcome = { win: "", place: "", show: "" };
      const link = (top.link || "").toLowerCase();

      try {
        if (link.includes("horseracingnation.com")) {
          // Use HRN parser
          const parsed = await extractOutcomeFromResultPage(top.link, {
            track: track || "",
            date: date || "",
            raceNo: raceNo,
          });

          if (parsed && (parsed.win || parsed.place || parsed.show)) {
            parsedOutcome = {
              win: parsed.win || "",
              place: parsed.place || "",
              show: parsed.show || "",
            };
          }
        } else if (link.includes("equibase.com")) {
          // Try Equibase parser
          try {
            const html = await fetchEquibaseChartHtml({
              track: track || "",
              dateISO: date,
              raceNo: String(raceNo || ""),
            });
            const equibaseOutcome = parseEquibaseOutcome(html);
            if (
              equibaseOutcome &&
              (equibaseOutcome.win ||
                equibaseOutcome.place ||
                equibaseOutcome.show)
            ) {
              parsedOutcome = {
                win: equibaseOutcome.win || "",
                place: equibaseOutcome.place || "",
                show: equibaseOutcome.show || "",
              };
            }
          } catch (equibaseError) {
            console.error("[verify_race] Equibase parse failed", {
              link: top.link,
              error: equibaseError?.message,
            });
          }
        }
      } catch (err) {
        console.error("[verify_race] parser error", {
          link: top.link,
          error: err?.message,
        });
        // Continue with empty outcome - will fall back to google-only
      }

      // If we got a valid outcome, return success response
      if (parsedOutcome.win || parsedOutcome.place || parsedOutcome.show) {
        // Normalize names for comparison
        const normalizeName = (value = "") =>
          (value || "").toLowerCase().replace(/\s+/g, " ").trim();

        const pWin = normalizeName(predicted.win);
        const pPlace = normalizeName(predicted.place);
        const pShow = normalizeName(predicted.show);
        const oWin = normalizeName(parsedOutcome.win);
        const oPlace = normalizeName(parsedOutcome.place);
        const oShow = normalizeName(parsedOutcome.show);

        const hits = {
          winHit: !!pWin && !!oWin && pWin === oWin,
          placeHit: !!pPlace && !!oPlace && pPlace === oPlace,
          showHit: !!pShow && !!oShow && pShow === oShow,
          top3Hit:
            (pWin &&
              (pWin === oWin || pWin === oPlace || pWin === oShow)) ||
            (pPlace &&
              (pPlace === oWin || pPlace === oPlace || pPlace === oShow)) ||
            (pShow && (pShow === oWin || pShow === oPlace || pShow === oShow)),
        };

        // Build summary
        const summaryLines = [];
        summaryLines.push(`Query: ${queryUsed || ""}`);

        if (top.title) {
          summaryLines.push(`Top: ${top.title} -> ${top.link}`);
        }
        if (top.link) {
          try {
            const hostname = new URL(top.link).hostname;
            summaryLines.push(`Host: ${hostname}`);
          } catch {
            // ignore
          }
        }

        const outcomeParts = [
          parsedOutcome.win,
          parsedOutcome.place,
          parsedOutcome.show,
        ].filter(Boolean);
        if (outcomeParts.length) {
          summaryLines.push(`Outcome: ${outcomeParts.join(" / ")}`);
        }

        const hitList = [
          hits.winHit ? "Win" : null,
          hits.placeHit ? "Place" : null,
          hits.showHit ? "Show" : null,
          hits.top3Hit ? "Top3" : null,
        ].filter(Boolean);

        if (hitList.length) {
          summaryLines.push(`Hits: ${hitList.join(", ")}`);
        }

        const summary = summaryLines.filter(Boolean).join("\n");

        // Build Google search URL for debug button
        const googleQuery = buildQuery({ track, date, raceNo });
        const googleUrl = buildGoogleSearchUrl(googleQuery);

        return res.status(200).json({
          ok: true,
          step: "verify_race",
          date,
          track,
          raceNo,
          query: queryUsed || googleQuery,
          top: top ? { title: top.title || "", link: top.link || "" } : null,
          outcome: parsedOutcome,
          predicted,
          hits,
          summary,
          debug: {
            googleUrl,
          },
        });
      }
    }
  }

  // Fall back to google-only mode
  const query = buildQuery({ track, date, raceNo });
  const fallback = buildGoogleFallbackResponse(track, date, raceNo, query, predicted);

  if (lastError) {
    console.warn("[verify_race] Falling back to google-only", {
      error: lastError?.message || String(lastError),
    });
  }

  return res.status(200).json(fallback);
}

/**
 * Public API handler – bulletproof wrapper.
 */
export default async function handler(req, res) {
  try {
    await verifyRace(req, res);
  } catch (err) {
    console.error("[verify_race] UNHANDLED ERROR", err);
    return res.status(200).json({
      ok: false,
      step: "verify_race_unhandled_error",
      error: err ? String(err.message || err) : "Unknown error",
      date: null,
      track: null,
      raceNo: null,
      query: "",
      top: null,
      outcome: { win: "", place: "", show: "" },
      predicted: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary:
        "[verify_race] Unhandled error in handler wrapper. See server logs for details.",
      debug: {
        googleUrl: null,
      },
    });
  }
}
