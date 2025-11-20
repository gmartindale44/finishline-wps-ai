// pages/api/verify_race.js

import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import * as cheerio from "cheerio";
import { fetchAndParseResults } from "../../lib/results.js";
import {
  fetchEquibaseChartHtml,
  parseEquibaseOutcome,
  getEquibaseTrackCode,
} from "../../lib/equibase.js";

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

const TTL_SECONDS = 60 * 60 * 24; // 24h
const isVercel = !!process.env.VERCEL;
const RECON_LIST = "reconciliations:v1";
const RECON_DAY_PREFIX = "reconciliations:v1:";

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error("[verify_race] Failed to init Redis client", error);
      redisClient = null;
    }
  }
  return redisClient;
}

const slug = (s = "") =>
  s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * Normalize horse name for comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

/**
 * Parse HRN runner table to extract Win/Place/Show from chart results
 * @param {cheerio.CheerioAPI} $ - cheerio instance
 * @param {cheerio.Cheerio<cheerio.Element>} $table - cheerio-wrapped <table> for the runner (speed) grid
 * @returns {{ win: string; place: string; show: string }}
 */
function parseHRNRunnerTable($, $table) {
  // Defensive guards: never throw, always return a safe default
  if (!$ || !$table || !$table.length) {
    return { win: "", place: "", show: "" };
  }

  // Identify header cells (th) and determine column indexes
  const headerRow = $table.find("tr").first();
  const headerCells = headerRow.find("th, td").toArray();
  
  if (!headerCells.length) {
    return { win: "", place: "", show: "" };
  }

  const headerTexts = headerCells.map((cell) =>
    $(cell).text().toLowerCase().trim()
  );

  const runnerIdx = headerTexts.findIndex(
    (h) => h.includes("runner") || h.includes("horse")
  );
  const winIdx = headerTexts.findIndex((h) => h.includes("win"));
  const placeIdx = headerTexts.findIndex((h) => h.includes("place"));
  const showIdx = headerTexts.findIndex((h) => h.includes("show"));

  // Require runner column, but Win/Place/Show columns are optional (we'll fallback to order)
  if (runnerIdx === -1) {
    return { win: "", place: "", show: "" };
  }

  // Loop through tbody tr rows
  let winHorse = "";
  let placeHorse = "";
  let showHorse = "";
  const runnerOrder = []; // Track runner names in finishing order

  $table.find("tr").slice(1).each((_, tr) => {
    const $cells = $(tr).find("td");
    if (!$cells.length) return;

    // Get runner name
    const runnerText = runnerIdx > -1 
      ? ($cells.eq(runnerIdx).text() || "").trim() 
      : "";
    
    if (!runnerText) return;
    
    // Skip header rows
    if (/runner\s*\(speed\)/i.test(runnerText)) return;
    
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

    // Track finishing order by row (HRN lists runners in finishing order)
    runnerOrder.push(runnerName);

    // Get Win/Place/Show cell texts (if columns exist)
    const winText = winIdx > -1 && $cells.eq(winIdx).length
      ? ($cells.eq(winIdx).text() || "").trim()
      : "";
    const placeText = placeIdx > -1 && $cells.eq(placeIdx).length
      ? ($cells.eq(placeIdx).text() || "").trim()
      : "";
    const showText = showIdx > -1 && $cells.eq(showIdx).length
      ? ($cells.eq(showIdx).text() || "").trim()
      : "";

    // Selection rules: first non-empty Win cell becomes results.win
    if (winText && !winHorse) {
      winHorse = runnerName;
    }

    // First non-empty Place cell becomes results.place
    if (placeText && !placeHorse) {
      placeHorse = runnerName;
    }

    // First non-empty Show cell becomes results.show
    if (showText && !showHorse) {
      showHorse = runnerName;
    }
  });

  // Fallback: if some result slots are still empty, use runnerOrder as a strict
  // finishing-order proxy (1st = win, 2nd = place, 3rd = show)
  // This handles races like Churchill Downs R2 where payouts are sparse
  if (!winHorse && runnerOrder.length >= 1) {
    winHorse = runnerOrder[0];
  }
  if (!placeHorse && runnerOrder.length >= 2) {
    placeHorse = runnerOrder[1];
  }
  if (!showHorse && runnerOrder.length >= 3) {
    showHorse = runnerOrder[2];
  }

  return {
    win: winHorse || "",
    place: placeHorse || "",
    show: showHorse || "",
  };
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

    // Check for icons/images in payout cells (HRN sometimes uses icons instead of text)
    const winCell = winIdx > -1 ? $cells.eq(winIdx) : null;
    const placeCell = placeIdx > -1 ? $cells.eq(placeIdx) : null;
    const showCell = showIdx > -1 ? $cells.eq(showIdx) : null;

    // If no text but there are icons (img/svg) treat as non-empty payout indicator
    const hasWinIcon = winCell && !winText && winCell.find("img, svg, [class*='icon'], [class*='check']").length > 0;
    const hasPlaceIcon = placeCell && !placeText && placeCell.find("img, svg, [class*='icon'], [class*='check']").length > 0;
    const hasShowIcon = showCell && !showText && showCell.find("img, svg, [class*='icon'], [class*='check']").length > 0;

    // If the row has no payouts at all, it's not useful for W/P/S.
    if (!winText && !placeText && !showText && !hasWinIcon && !hasPlaceIcon && !hasShowIcon) return;

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
      hasWin: (!!winText && winText !== "-") || hasWinIcon,
      hasPlace: (!!placeText && placeText !== "-") || hasPlaceIcon,
      hasShow: (!!showText && showText !== "-") || hasShowIcon,
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
  // Find the first horse that has a Show payout and is not already assigned to Win or Place
  // This is the third-place finisher
  let showHorse = "";
  if (showIdx >= 0) {
    // Strategy: Find the first runner with a Show payout that isn't already Win or Place
    // This should be the third-place finisher
    const showRunner = runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse
    );
    if (showRunner) {
      showHorse = showRunner.name;
    } else {
      // Fallback: if we have win and place but no distinct show, try to find
      // any runner with show payout (handles edge cases where positions might overlap)
      const anyShowRunner = runners.find((r) => r.hasShow);
      if (anyShowRunner && 
          anyShowRunner.name !== winHorse && 
          anyShowRunner.name !== placeHorse) {
        showHorse = anyShowRunner.name;
      }
    }
  }

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

    if (process.env.VERIFY_DEBUG === "true") {
      console.log("[verify_race] HRN runnerTables", {
        requestedRaceNo,
        candidates: runnerTables.map((t) => t.raceNo),
        chosenRaceNo: target.raceNo,
      });
    }

    const { table: $runnerTable, runnerIdx, winIdx, placeIdx, showIdx } = target;

    // --- STEP 1: Extract runner names in table order (fallback seed) ---
    const runners = [];
    $runnerTable.find("tr").each((i, tr) => {
      const $cells = $(tr).find("td");
      if (!$cells.length) return;
      
      const runnerText = runnerIdx > -1 
        ? ($cells.eq(runnerIdx).text() || "").replace(/\s+/g, " ").trim()
        : "";
      
      if (!runnerText) return;
      
      // Skip header rows
      if (/runner\s*\(speed\)/i.test(runnerText)) return;
      
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
      
      runners.push(runnerName);
    });

    // --- STEP 2: Seed win/place/show from first 3 runners (safe fallback) ---
    // Only set if not already set, so we don't clobber better data from other passes
    if (Array.isArray(runners) && runners.length > 0) {
      if (!outcome.win && runners[0]) {
        outcome.win = runners[0];
      }
      if (runners.length > 1 && !outcome.place && runners[1]) {
        outcome.place = runners[1];
      }
      if (runners.length > 2 && !outcome.show && runners[2]) {
        outcome.show = runners[2];
      }
    }

    // --- STEP 3: Extract win/place/show from the chosen runner table using WPS payouts ---
    const parsed = parseHRNRunnerTable($, $runnerTable);

    // --- STEP 4: Overwrite only with non-empty WPS parsing results (defensive) ---
    // Never assign empty strings - only overwrite when we have actual parsed values
    if (parsed.win) {
      outcome.win = parsed.win;
    }
    if (parsed.place) {
      outcome.place = parsed.place;
    }
    if (parsed.show) {
      outcome.show = parsed.show;
    }

    // Debug log for HRN parse success
    console.log("[verify_race] HRN WPS outcome", {
      requestedRaceNo,
      outcome,
      columnIdx: { runnerIdx, winIdx, placeIdx, showIdx },
    });

    // NOTE: we keep the existing fallback logic (Pool/Finish/$2 Payout table)
    // that comes AFTER this function in the file. If you already have a
    // "Fallback: If we didn't get all three positions..." block, leave it
    // exactly as it is so it still runs when outcome is incomplete.
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

    // Only overwrite if we have non-empty values (defensive)
    if (byPos.get(1)) outcome.win = byPos.get(1);
    if (byPos.get(2)) outcome.place = byPos.get(2);
    if (byPos.get(3)) outcome.show = byPos.get(3);

    // If we didn't find anything in tables, try text-based heuristics
    if (!outcome.win && !outcome.place && !outcome.show) {
      // Look for "Win: HorseName" patterns
      const winMatch = html.match(/Win[:\s]+([A-Za-z0-9' .\-]+)/i);
      const placeMatch = html.match(/Place[:\s]+([A-Za-z0-9' .\-]+)/i);
      const showMatch = html.match(/Show[:\s]+([A-Za-z0-9' .\-]+)/i);

      // Only overwrite if we have non-empty values (defensive)
      if (winMatch) {
        const winName = normalizeHorseName(winMatch[1]);
        if (winName) outcome.win = winName;
      }
      if (placeMatch) {
        const placeName = normalizeHorseName(placeMatch[1]);
        if (placeName) outcome.place = placeName;
      }
      if (showMatch) {
        const showName = normalizeHorseName(showMatch[1]);
        if (showName) outcome.show = showName;
      }
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
      
      // Check for race number in page text
      const hasRaceNo = new RegExp(
        `Race\\s*#?\\s*${raceNoStr}\\b`,
        "i"
      ).test(html);
      
      // Check for track name in page text
      const hasTrack = trackLower
        ? new RegExp(trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(html)
        : true;

      if (!hasRaceNo || !hasTrack) {
        console.warn("[verify_race] Page validation failed", {
          url,
          raceNo: ctx.raceNo,
          track: ctx.track,
          hasRaceNo,
          hasTrack,
        });
        return {}; // Return empty outcome if validation fails
      }
    }

    const outcome = parseOutcomeFromHtml(html, url, ctx.raceNo);
    return outcome;
  } catch (error) {
    // Best-effort only; swallow errors and return empty so UI still works
    console.error("[verify_race] extractOutcomeFromResultPage failed", {
      url,
      error: error?.message || String(error),
    });
    return {};
  }
}

async function cseDirect(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    const err = new Error("Google CSE credentials missing");
    err.step = "cse_credentials";
    throw err;
  }
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", GOOGLE_API_KEY);
  u.searchParams.set("cx", GOOGLE_CSE_ID);
  u.searchParams.set("q", query);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`Google CSE ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const items = Array.isArray(j.items) ? j.items : [];
  return items.map((i) => ({
    title: i.title,
    link: i.link,
    snippet: i.snippet,
  }));
}

async function cseViaBridge(req, query) {
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
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `CSE bridge ${r.status}`);
  const arr = Array.isArray(j.results) ? j.results : [];
  return arr.map((i) => ({
    title: i.title,
    link: i.link,
    snippet: i.snippet,
  }));
}

const preferHosts = [
  "horseracingnation.com",
  "entries.horseracingnation.com",
  "equibase.com",
];

function pickBest(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const scored = items
    .map((item) => {
    try {
        const url = new URL(item.link || "");
        const host = url.hostname || "";
      const idx = preferHosts.findIndex((h) => host.includes(h));
      return { item, score: idx === -1 ? 10 : idx };
    } catch {
      return { item, score: 10 };
    }
    })
    .sort((a, b) => a.score - b.score);
  return scored.length ? scored[0].item : null;
}

async function runSearch(req, query) {
  return GOOGLE_API_KEY && GOOGLE_CSE_ID
    ? await cseDirect(query)
    : await cseViaBridge(req, query);
}

export default async function handler(req, res) {
  // Extract safe values early for error responses
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        error: "Method Not Allowed",
        details: "Only POST requests are accepted",
        step: "verify_race_method_validation",
        results: { win: "", place: "", show: "" }, // Always include results as object
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false },
      });
    }

    // Be tolerant of either req.body object or JSON string
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body && typeof req.json === "function") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const {
      track,
      date: inputDate,
      raceNo,
      race_no,
      distance = "",
      surface = "",
      strategy = "",
      ai_picks = "",
      predicted = {},
    } = body || {};

    const raceNumber = raceNo ?? race_no;
    // Always use the requested date from the request body, never default to "today"
    safeDate = (inputDate && String(inputDate).trim()) || "";
    safeTrack = track || null;
    safeRaceNo = raceNumber ?? null;

    console.info("[verify_race] request", {
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
    });

    if (!track) {
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        error: "Missing required field: track",
        details: "Track is required to verify a race",
        step: "verify_race_validation",
        results: { win: "", place: "", show: "" }, // Always include results as object
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false },
      });
    }

    // Use the requested date throughout - never override with "today"
    const date = safeDate;
    const dateISO = date; // Use ISO format (YYYY-MM-DD)

    // Build search queries
    const racePart = raceNumber ? ` Race ${raceNumber}` : "";
    const baseQuery = `${track}${racePart} ${dateISO} results Win Place Show order`;
    const altQuery = `${track}${racePart} ${dateISO} result chart official`;
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
    const searchStep = "verify_race_search";

    try {
    for (const q of queries) {
      try {
        const items = await runSearch(req, q);
        queryUsed = q;
        results = items;
        if (items.length) break;
      } catch (error) {
        lastError = error;
          console.error("[verify_race] Search query failed", {
            query: q,
            error: error?.message || String(error),
          });
      }
    }

    if (!results.length && lastError) {
      throw lastError;
    }
    } catch (error) {
      console.error("[verify_race] Search failed", {
        error: error?.message || String(error),
        stack: error?.stack,
      });
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        error: "Search failed",
        details:
          lastError?.message ||
          error?.message ||
          "Unable to fetch race results from search providers",
        step: searchStep,
        query: queryUsed || queries[0] || null,
        results: { win: "", place: "", show: "" }, // Always include results as object
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false },
      });
    }

    // Pick best result: prefer HRN entries/results pages, then Equibase
    function pickBestResult(results) {
      if (!Array.isArray(results) || results.length === 0) return null;

      // 1) Prefer HorseracingNation entries/results pages (where we already have a working parser)
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
    }

    const top = pickBestResult(results);

    if (!top) {
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        results: { win: "", place: "", show: "" }, // Always include results as object
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false },
        error: "No search results",
        step: "verify_race_search",
        query: queryUsed,
        summary: "No results from Google CSE",
      });
    }

    // Route the top result into the correct parser
    // IMPORTANT: outcome is ONLY populated from parsed chart data, NEVER from search snippets
    // Initialize with safe defaults - always an object with win/place/show
    let parsedOutcome = { win: "", place: "", show: "" };

    const link = (top.link || "").toLowerCase();

    // Wrap entire parsing pipeline in try/catch to prevent 500 errors
    try {
      if (link.includes("horseracingnation.com")) {
        // Use the existing HRN parser: it already knows how to handle multiple races
        // on the same page and pull out W/P/S for the given raceNo.
        const parsed = await extractOutcomeFromResultPage(top.link, {
          track: safeTrack || "",
          date: safeDate || "",
          raceNo: raceNumber,
        });

        if (parsed && typeof parsed === "object") {
          parsedOutcome = {
            win: (parsed.win || "").trim(),
            place: (parsed.place || "").trim(),
            show: (parsed.show || "").trim(),
          };
        }
      } else if (link.includes("equibase.com")) {
        // Try Equibase parser if available
        try {
          const html = await fetchEquibaseChartHtml({
            track,
            dateISO,
            raceNo: String(raceNumber || ""),
          });
          const equibaseOutcome = parseEquibaseOutcome(html);
          if (equibaseOutcome && typeof equibaseOutcome === "object") {
            parsedOutcome = {
              win: (equibaseOutcome.win || "").trim(),
              place: (equibaseOutcome.place || "").trim(),
              show: (equibaseOutcome.show || "").trim(),
            };
          }
        } catch (equibaseError) {
          console.error("[verify_race] Equibase parse failed", {
            link: top.link,
            error: equibaseError?.message,
          });
          // Keep parsedOutcome as empty strings - don't throw
        }
      }
    } catch (err) {
      // Log error but don't throw - keep parsedOutcome as safe defaults
      console.error("[verify_race] parser error", {
        link: top.link,
        host: link,
        message: err?.message,
        stack: err?.stack,
      });
      // parsedOutcome already has safe defaults, so we're good
    }

    // Build clean outcome: only use parsed data, never snippets
    // Ensure it's always an object with win/place/show keys
    const cleanOutcome = parsedOutcome && typeof parsedOutcome === "object"
      ? {
          win: (parsedOutcome.win || "").trim(),
          place: (parsedOutcome.place || "").trim(),
          show: (parsedOutcome.show || "").trim(),
        }
      : { win: "", place: "", show: "" };

    // Store parsedOutcome for results object (will be set later)
    const parsedOutcomeForResults = cleanOutcome;

    const normalizeName = (value = "") =>
      (value || "").toLowerCase().replace(/\s+/g, " ").trim();

    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const hits = (() => {
      if (!predictedSafe || !outcome) {
        return { winHit: false, placeHit: false, showHit: false };
      }

      const pWin = normalizeName(predictedSafe.win);
      const pPlace = normalizeName(predictedSafe.place);
      const pShow = normalizeName(predictedSafe.show);
      const oWin = normalizeName(outcome.win);
      const oPlace = normalizeName(outcome.place);
      const oShow = normalizeName(outcome.show);

      return {
        winHit: pWin && oWin && pWin === oWin,
        placeHit: pPlace && oPlace && pPlace === oPlace,
        showHit: pShow && oShow && pShow === oShow,
    };
    })();

    const summary = (() => {
      const lines = [];
      lines.push(`Query: ${queryUsed || baseQuery}`);
      if (top) {
        if (top.title) lines.push(`Top: ${top.title} -> ${top.link}`);
        if (top.link) {
          try {
            const hostname = new URL(top.link).hostname;
            lines.push(`Host: ${hostname}`);
          } catch {
            // Skip if URL parsing fails
          }
        }
        lines.push(`Using chart: ${top.title}`);
      } else {
        lines.push("No top result returned.");
      }
      const outcomeParts = [
        outcome.win,
        outcome.place,
        outcome.show,
      ].filter(Boolean);
      if (outcomeParts.length)
        lines.push(`Outcome: ${outcomeParts.join(" / ")}`);
      const hitList = [
        hits.winHit ? "Win" : null,
        hits.placeHit ? "Place" : null,
        hits.showHit ? "Show" : null,
      ].filter(Boolean);
      if (hitList.length) lines.push(`Hits: ${hitList.join(", ")}`);
      return lines.filter(Boolean).join("\n");
    })();

    const summarySafe =
      summary ||
      (top?.title
        ? `Top Result: ${top.title}${top.link ? `\n${top.link}` : ""}`
        : "No summary returned.");

    // Build results object from parsed chart data
    // results holds the chart outcome { win, place, show }
    // predicted holds the model's picks
    // Always ensure results is an object, never undefined or array
    const results = parsedOutcomeForResults && typeof parsedOutcomeForResults === "object"
      ? {
          win: (parsedOutcomeForResults.win || "").trim(),
          place: (parsedOutcomeForResults.place || "").trim(),
          show: (parsedOutcomeForResults.show || "").trim(),
        }
      : { win: "", place: "", show: "" };

    // Keep outcome for backward compatibility (same as results)
    const outcome = results;

    // Log outcome for debugging
    console.info("[verify_race] outcome", {
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
      results,
      outcome,
      hits,
    });

    const tsIso = new Date().toISOString();
    const redis = getRedis();

    // Redis event log (namespaced) – best-effort
    if (redis) {
      const raceLabel = raceNumber ? `R${raceNumber}` : "R?";
      const ns = `fl:cse:reconcile:${slug(track)}:${date}:${raceLabel}`;
      const eventKey = `${ns}:${Date.now()}:${crypto
        .randomBytes(4)
        .toString("hex")}`;
      try {
        await redis.set(
          eventKey,
          JSON.stringify({
          ts: tsIso,
          track,
          date,
          raceNo: raceNumber ?? null,
          distance,
          surface,
          strategy,
          ai_picks,
            query: queryUsed || null,
            count: 0,
            results: [],
          predicted: predictedSafe,
          outcome,
          hits,
          summary: summarySafe,
          }),
        );
        await redis.expire(eventKey, TTL_SECONDS);
        await redis.lpush(`${ns}:log`, eventKey);
        await redis.ltrim(`${ns}:log`, 0, 99);
        await redis.expire(`${ns}:log`, TTL_SECONDS);
      } catch (error) {
        console.error("[verify_race] Redis event log failed", error);
      }
    }

    if (redis) {
      try {
        const row = {
          ts: Date.now(),
          date,
          track,
          raceNo: raceNumber ?? null,
          query: queryUsed || null,
          top: top ? { title: top.title, link: top.link } : null,
          outcome,
          predicted: predictedSafe,
          hits,
          summary: summarySafe,
        };
        await redis.rpush(RECON_LIST, JSON.stringify(row));
        const dayKey = `${RECON_DAY_PREFIX}${date}`;
        await redis.rpush(dayKey, JSON.stringify(row));
        await redis.expire(dayKey, 60 * 60 * 24 * 90);
        await redis.hincrby("cal:v1", "total", 1);
        if (hits.winHit) await redis.hincrby("cal:v1", "correctWin", 1);
        if (hits.placeHit) await redis.hincrby("cal:v1", "correctPlace", 1);
        if (hits.showHit) await redis.hincrby("cal:v1", "correctShow", 1);
        if (hits.top3Hit) await redis.hincrby("cal:v1", "top3Hit", 1);
      } catch (error) {
        console.error("Redis logging failed", error);
      }
    }

    if (!isVercel) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const csvPath = path.resolve(
          process.cwd(),
          "data/reconciliations_v1.csv",
        );
        const header =
          "ts,date,track,raceNo,query,topTitle,topUrl,winHit,placeHit,showHit,top3Hit\n";
        const exists = fs.existsSync(csvPath);
        const line =
          [
          Date.now(),
          date,
          JSON.stringify(track),
            raceNumber ?? "",
            JSON.stringify(queryUsed || ""),
            JSON.stringify(top?.title || ""),
            JSON.stringify(top?.link || ""),
          hits.winHit ? 1 : 0,
          hits.placeHit ? 1 : 0,
          hits.showHit ? 1 : 0,
          hits.top3Hit ? 1 : 0,
          ].join(",") + "\n";
        if (!exists) fs.writeFileSync(csvPath, header);
        fs.appendFileSync(csvPath, line);
      } catch (error) {
        console.warn(
          "Local CSV append failed (dev only):",
          error?.message || error,
        );
      }
    }

    return res.status(200).json({
      date,
      track,
      raceNo: raceNumber ?? null,
      query: queryUsed,
      count: 0,
      top,
      results, // Chart outcome { win, place, show }
      outcome, // Backward compatibility (same as results)
      predicted: predictedSafe, // Model picks
      hits,
      summary: summarySafe,
    });
  } catch (err) {
    console.error("[verify_race] error", {
      error: err?.message || String(err),
      stack: err?.stack,
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
    });

    // Always return 200 with structured error response
    return res.status(200).json({
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      error: "verify_race failed",
      details: err?.message || String(err) || "Unknown error occurred",
      step: "verify_race",
      results: { win: "", place: "", show: "" }, // Always include results as object
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false },
    });
  }
}
