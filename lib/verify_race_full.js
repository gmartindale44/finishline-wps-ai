// lib/verify_race_full.js
// Full CSE + HRN + Equibase parsing pipeline for verify_race
// All environment variable reads and network calls are inside functions (no top-level execution)

import * as cheerio from "cheerio";
import {
  resolveEquibaseOutcome,
} from "./equibase.js";

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
    console.error("[verify_race_full] extractOutcomeFromRunnerTable error", err);
    return { win: "", place: "", show: "" };
  }
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
    console.error("[verify_race_full] parseHRNRaceOutcome failed", error);
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
    console.error("[verify_race_full] parseOutcomeFromHtml failed", error);
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
        console.warn("[verify_race_full] Page validation failed", {
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
    console.error("[verify_race_full] extractOutcomeFromResultPage failed", {
      url,
      error: error?.message || String(error),
    });
    return {};
  }
}

/**
 * Direct Google CSE API call
 * Environment variables are read inside this function (not at top level)
 */
async function cseDirect(query) {
  try {
    const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
    const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
      console.warn("[verify_race_full] Google CSE credentials missing");
      return [];
    }

    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.searchParams.set("key", GOOGLE_API_KEY);
    u.searchParams.set("cx", GOOGLE_CSE_ID);
    u.searchParams.set("q", query);

    const r = await fetch(u.toString()).catch((err) => {
      console.error("[verify_race_full] CSE fetch failed", err);
      return null;
    });

    if (!r || !r.ok) {
      const text = await r?.text().catch(() => "") || "";
      console.error("[verify_race_full] CSE response not ok", {
        status: r?.status,
        text: text.slice(0, 200),
      });
      return [];
    }

    const j = await r.json().catch((err) => {
      console.error("[verify_race_full] CSE JSON parse failed", err);
      return { items: [] };
    });

    const items = Array.isArray(j.items) ? j.items : [];
    return items.map((i) => ({
      title: i?.title || "",
      link: i?.link || "",
      snippet: i?.snippet || "",
    }));
  } catch (err) {
    console.error("[verify_race_full] cseDirect error", err);
    return [];
  }
}

/**
 * CSE via bridge endpoint
 * Environment variables are read inside this function (not at top level)
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
      console.error("[verify_race_full] CSE bridge fetch failed", err);
      return null;
    });

    if (!r || !r.ok) {
      console.error("[verify_race_full] CSE bridge response not ok", {
        status: r?.status,
      });
      return [];
    }

    const j = await r.json().catch(() => ({}));
    const arr = Array.isArray(j.results) ? j.results : [];
    return arr.map((i) => ({
      title: i?.title || "",
      link: i?.link || "",
      snippet: i?.snippet || "",
    }));
  } catch (err) {
    console.error("[verify_race_full] cseViaBridge error", err);
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
    console.error("[verify_race_full] pickBestResult error", err);
    return null;
  }
}

/**
 * Run search (direct or via bridge)
 * Environment variables are read inside this function (not at top level)
 */
async function runSearch(req, query) {
  try {
    const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
    const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

    const items = await (GOOGLE_API_KEY && GOOGLE_CSE_ID
      ? cseDirect(query)
      : cseViaBridge(req, query));

    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error("[verify_race_full] runSearch error", err);
    return [];
  }
}

/**
 * Build a Google search URL for the given query
 */
function buildGoogleSearchUrl(query) {
  try {
    const base = "https://www.google.com/search";
    const qs = `q=${encodeURIComponent(query || "")}`;
    return `${base}?${qs}`;
  } catch (err) {
    console.error("[verify_race_full] buildGoogleSearchUrl error", err);
    return "https://www.google.com/search?q=";
  }
}

/**
 * Main entry point: Run full verify race with CSE + HRN + Equibase parsing
 * @param {Object} context
 * @param {string} context.track
 * @param {string} context.date - ISO date (YYYY-MM-DD)
 * @param {string|number} context.raceNo
 * @param {Object} [context.predicted] - { win?: string; place?: string; show?: string }
 * @param {Object} [context.req] - Request object (for CSE bridge)
 * @returns {Promise<Object>} VerifyRaceResponse
 */
export async function runFullVerifyRace(context) {
  const {
    track,
    date,
    raceNo,
    predicted = {},
    req = null,
  } = context || {};

  const safeTrack = (track || "").trim();
  const safeDate = (date || "").trim();
  const safeRaceNo = raceNo ? String(raceNo).trim() : "";

  // Build default response structure
  const defaultResponse = {
    ok: false,
    step: "verify_race_full_error",
    date: safeDate,
    track: safeTrack,
    raceNo: safeRaceNo,
    query: "",
    top: null,
    outcome: { win: "", place: "", show: "" },
    predicted: {
      win: (predicted?.win || "").trim(),
      place: (predicted?.place || "").trim(),
      show: (predicted?.show || "").trim(),
    },
    hits: {
      winHit: false,
      placeHit: false,
      showHit: false,
      top3Hit: false,
    },
    summary: "Full verify race encountered an error.",
    debug: {
      googleUrl: buildGoogleSearchUrl(""),
    },
  };

  try {
    if (!safeTrack || !safeDate) {
      return {
        ...defaultResponse,
        step: "verify_race_full_validation",
        error: "Missing required fields: track and date",
        summary: "Full verify race requires track and date.",
      };
    }

    // EQUIBASE-FIRST: Try to resolve outcome from Equibase chart
    try {
      const equibaseResult = await resolveEquibaseOutcome({
        track: safeTrack,
        date: safeDate,
        raceNo: safeRaceNo,
      });

      if (equibaseResult && equibaseResult.outcome) {
        // Equibase succeeded - compute hits and return immediately
        const outcome = equibaseResult.outcome;
        const equibaseUrl = equibaseResult.url;

        // Normalize names for comparison
        const normalizeName = (value = "") =>
          (value || "").toLowerCase().replace(/\s+/g, " ").trim();

        const predictedSafe = {
          win: (predicted?.win || "").trim(),
          place: (predicted?.place || "").trim(),
          show: (predicted?.show || "").trim(),
        };

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
            (pWin &&
              (pWin === oWin || pWin === oPlace || pWin === oShow)) ||
            (pPlace &&
              (pPlace === oWin || pPlace === oPlace || pPlace === oShow)) ||
            (pShow && (pShow === oWin || pShow === oPlace || pShow === oShow)),
        };

        // Build summary
        const summaryLines = [];
        summaryLines.push(`Using date: ${safeDate}`);
        summaryLines.push(`Step: verify_race_equibase`);
        summaryLines.push(`Query: Equibase chart: ${safeTrack} ${safeDate} Race ${safeRaceNo}`);
        summaryLines.push(`Top: Equibase chart -> ${equibaseUrl}`);

        const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(
          Boolean
        );
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
        } else {
          summaryLines.push("Hits: (none)");
        }

        const summary = summaryLines.filter(Boolean).join("\n");

        return {
          ok: true,
          step: "verify_race_equibase",
          date: safeDate,
          track: safeTrack,
          raceNo: safeRaceNo,
          query: `Equibase chart: ${safeTrack} ${safeDate} Race ${safeRaceNo}`,
          top: {
            title: "Equibase chart",
            link: equibaseUrl,
          },
          outcome,
          predicted: predictedSafe,
          hits,
          summary,
          debug: {
            source: "equibase",
            equibaseUrl,
          },
        };
      }
    } catch (equibaseError) {
      // Log but don't throw - fall through to CSE/HRN logic
      console.error("[verify_race] Equibase failed, falling back to CSE/HRN", {
        error: equibaseError?.message || String(equibaseError),
        track: safeTrack,
        date: safeDate,
        raceNo: safeRaceNo,
      });
    }

    // Build search queries (fallback to CSE/HRN if Equibase failed)
    const racePart = safeRaceNo ? ` Race ${safeRaceNo}` : "";
    const baseQuery = `${safeTrack}${racePart} ${safeDate} results Win Place Show order`;
    const altQuery = `${safeTrack}${racePart} ${safeDate} result chart official`;
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
    let lastError = null;

    // Try each query until we get results
    for (const q of queries) {
      try {
        const items = await runSearch(req, q);
        queryUsed = q;
        results = items;
        if (items.length) break;
      } catch (error) {
        lastError = error;
        console.error("[verify_race_full] Search query failed", {
          query: q,
          error: error?.message || String(error),
        });
      }
    }

    if (!results.length) {
      return {
        ...defaultResponse,
        step: "verify_race_full_search_failed",
        query: queryUsed,
        error: lastError?.message || "Search failed",
        summary: `Full verify race: search failed for query "${queryUsed}". ${lastError?.message || ""}`,
        debug: {
          googleUrl: buildGoogleSearchUrl(queryUsed),
        },
      };
    }

    // Pick best result
    const top = pickBestResult(results);

    if (!top || !top.link) {
      return {
        ...defaultResponse,
        step: "verify_race_full_no_results",
        query: queryUsed,
        summary: `Full verify race: no suitable results found from search.`,
        debug: {
          googleUrl: buildGoogleSearchUrl(queryUsed),
        },
      };
    }

    // Parse outcome from the top result
    let parsedOutcome = { win: "", place: "", show: "" };
    const link = (top.link || "").toLowerCase();

    try {
      if (link.includes("horseracingnation.com")) {
        // Use HRN parser
        const parsed = await extractOutcomeFromResultPage(top.link, {
          track: safeTrack,
          date: safeDate,
          raceNo: safeRaceNo,
        });

        if (parsed && (parsed.win || parsed.place || parsed.show)) {
          parsedOutcome = {
            win: parsed.win || "",
            place: parsed.place || "",
            show: parsed.show || "",
          };
        }
      } else if (link.includes("equibase.com")) {
        // Try Equibase parser (fallback if direct Equibase resolution failed earlier)
        try {
          const equibaseResult = await resolveEquibaseOutcome({
            track: safeTrack,
            date: safeDate,
            raceNo: safeRaceNo,
          });
          if (equibaseResult && equibaseResult.outcome) {
            parsedOutcome = {
              win: equibaseResult.outcome.win || "",
              place: equibaseResult.outcome.place || "",
              show: equibaseResult.outcome.show || "",
            };
          }
        } catch (equibaseError) {
          console.error("[verify_race_full] Equibase parse failed", {
            link: top.link,
            error: equibaseError?.message,
          });
        }
      }
    } catch (err) {
      console.error("[verify_race_full] parser error", {
        link: top.link,
        error: err?.message,
      });
      // Continue with empty outcome - don't throw
    }

    // Build clean outcome
    const outcome =
      parsedOutcome && (parsedOutcome.win || parsedOutcome.place || parsedOutcome.show)
        ? parsedOutcome
        : { win: "", place: "", show: "" };

    // Normalize names for comparison
    const normalizeName = (value = "") =>
      (value || "").toLowerCase().replace(/\s+/g, " ").trim();

    const predictedSafe = {
      win: (predicted?.win || "").trim(),
      place: (predicted?.place || "").trim(),
      show: (predicted?.show || "").trim(),
    };

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
        (pWin &&
          (pWin === oWin || pWin === oPlace || pWin === oShow)) ||
        (pPlace &&
          (pPlace === oWin || pPlace === oPlace || pPlace === oShow)) ||
        (pShow && (pShow === oWin || pShow === oPlace || pShow === oShow)),
    };

    // Build summary
    const summaryLines = [];
    summaryLines.push(`Using date: ${safeDate}`);
    summaryLines.push(`Step: verify_race`);
    summaryLines.push(`Query: ${queryUsed || ""}`);

    if (top) {
      if (top.title) summaryLines.push(`Top: ${top.title} -> ${top.link}`);
      if (top.link) {
        try {
          const hostname = new URL(top.link).hostname;
          summaryLines.push(`Host: ${hostname}`);
        } catch {
          // ignore
        }
      }
    }

    const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(
      Boolean
    );
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

    return {
      ok: true,
      step: "verify_race",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      query: queryUsed || "",
      top: top
        ? { title: top.title || "", link: top.link || "" }
        : null,
      outcome,
      predicted: predictedSafe,
      hits,
      summary,
      debug: {
        googleUrl: buildGoogleSearchUrl(queryUsed),
      },
    };
  } catch (err) {
    console.error("[verify_race_full] runFullVerifyRace error", {
      error: err?.message || String(err),
      stack: err?.stack,
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
    });

    return {
      ...defaultResponse,
      step: "verify_race_full_unhandled_error",
      error: String(err?.message || err) || "Unknown error",
      summary: `Full verify race encountered an unhandled error: ${err?.message || String(err)}`,
      debug: {
        googleUrl: buildGoogleSearchUrl(""),
      },
    };
  }
}

