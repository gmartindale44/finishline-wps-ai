// lib/verify_race_full.js
// Full CSE + HRN + Equibase parsing pipeline for verify_race
// All environment variable reads and network calls are inside functions (no top-level execution)

import * as cheerio from "cheerio";
import {
  resolveEquibaseOutcome,
} from "./equibase.js";

/**
 * Clean HTML by removing scripts, styles, and comments
 * @param {string} html
 * @returns {string}
 */
function cleanHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Normalize horse name for comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  return (name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Check if text looks like a valid horse name
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeHorseName(text) {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  if (t.length < 2) return false; // too short
  if (t.length > 40) return false; // too long => probably junk
  
  // Reject script/code patterns
  if (/script/i.test(t) || /THIS SCRIPT/i.test(t) || /HEAD TAGS/i.test(t) || /PUBFIG/i.test(t)) return false;
  if (/function\s*\(/i.test(t) || /var\s+\w+/i.test(t)) return false;
  if (/https?:\/\//i.test(t) || /@/.test(t)) return false;
  if (/[{}<>]/.test(t)) return false; // No braces or angle brackets
  
  // Reject jockey name patterns: "A. Maldonado", "J. Smith", etc.
  if (/^[A-Z]\.\s+[A-Za-z'-]+$/.test(t)) return false;
  
  // Reject JS code patterns
  if (/^[A-Z]\s*,\s*[a-z]/i.test(t)) return false; // Patterns like "A, splice" are JS code
  if (/function|prototype|call:|splice|push|pop|=>/i.test(t)) return false;
  if (/[{}()=>]/.test(t)) return false; // No JS code patterns
  
  // Reject stats/picks text patterns (e.g., "picks are winning 16.0", "Place picks are winning")
  if (/picks?\s+(are|is)\s+(winning|win)/i.test(t)) return false;
  if (/\b(picks?|stats?|percent|%|winning|payouts?)\b/i.test(t) && /\d+\.?\d*/.test(t)) return false;
  if (/^\d+\.\d+\s*$/.test(t)) return false; // Pure decimal numbers like "16.0"
  
  // Reject pure numbers
  if (/^\d+$/.test(t)) return false;
  
  // Must contain at least one letter
  if (!/[A-Za-z]/.test(t)) return false;
  
  return true;
}

/**
 * Validate that an outcome object has at least one valid horse name
 * @param {{ win?: string; place?: string; show?: string } | null | undefined} outcome
 * @returns {boolean}
 */
export function isValidOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return false;
  const { win, place, show } = outcome;
  return looksLikeHorseName(win) || looksLikeHorseName(place) || looksLikeHorseName(show);
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

      // Get runner text - prefer link text if available (horse names are often in links)
      let runnerText = "";
      if (runnerIdx > -1 && runnerIdx < $cells.length) {
        const $cell = $cells.eq(runnerIdx);
        runnerText = $cell.find("a").first().text().trim() || norm($cell.text());
      }
      if (!runnerText) return;

      // Skip header-ish rows
      if (/runner\s*\(speed\)/i.test(runnerText)) return;

      const winText = winIdx > -1 ? norm($cells.eq(winIdx).text()) : "";
      const placeText = placeIdx > -1 ? norm($cells.eq(placeIdx).text()) : "";
      const showText = showIdx > -1 ? norm($cells.eq(showIdx).text()) : "";

      // If no payouts at all, ignore the row
      if (!winText && !placeText && !showText) return;

      // Normalize runner name: strip footnote markers, jockey names, payouts
      let runnerName = runnerText.replace(/\s*\([^)]*\)\s*$/, "").trim();
      // Remove currency symbols and payout amounts
      runnerName = runnerName.replace(/\$\d+\.\d+/g, "").replace(/\d+\.\d+/g, "").trim();
      // Remove jockey names (pattern: "A. Maldonado", "J. Smith")
      runnerName = runnerName.replace(/\s+[A-Z]\.\s+[A-Z][a-z]+\s*$/, "").trim();
      // Remove any remaining numbers at the end
      runnerName = runnerName.replace(/\s+\d+\.?\d*\s*$/, "").trim();
      // Validate before adding to runners
      if (!looksLikeHorseName(runnerName)) return;
      runnerName = (runnerName || "").replace(/\s+/g, " ").trim();

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

    // Final validation - ensure all names are valid
    const result = {
      win: looksLikeHorseName(winHorse) ? winHorse.trim() : "",
      place: looksLikeHorseName(placeHorse) ? placeHorse.trim() : "",
      show: looksLikeHorseName(showHorse) ? showHorse.trim() : "",
    };
    
    return result;
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
    // HTML should already be cleaned before being passed to cheerio
    // But ensure scripts/styles are removed from the loaded document
    $("script, style, noscript").remove();

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
    // Also try to find race sections by looking for headings/anchors with race number
    let target = runnerTables.find((t) => t.raceNo === requestedRaceNo);
    
    // If no match by inferred race, try finding by race section headings
    if (!target) {
      // Look for headings/anchors that mention the race number
      const racePattern = new RegExp(`race\\s*#?\\s*${requestedRaceNo}\\b`, "i");
      $("h1, h2, h3, h4, a, div").each((_, el) => {
        const text = $(el).text();
        if (racePattern.test(text)) {
          // Find the nearest table after this element
          let nextTable = $(el).nextAll("table").first();
          if (!nextTable.length) {
            // Try parent container
            const container = $(el).closest("div, section, article");
            nextTable = container.find("table").first();
          }
          if (nextTable.length) {
            const $table = nextTable;
            const headerRow = $table.find("tr").first();
            const headerCells = headerRow.find("th, td").toArray();
            if (headerCells.length) {
              const headerTexts = headerCells.map((cell) =>
                $(cell).text().toLowerCase().trim()
              );
              const runnerIdx = headerTexts.findIndex(
                (h) => h.includes("runner") || h.includes("horse")
              );
              const winIdx = headerTexts.findIndex((h) => h.includes("win"));
              const placeIdx = headerTexts.findIndex((h) => h.includes("place"));
              const showIdx = headerTexts.findIndex((h) => h.includes("show"));
              if (runnerIdx !== -1 && winIdx !== -1 && placeIdx !== -1 && showIdx !== -1) {
                target = {
                  table: $table,
                  runnerIdx,
                  winIdx,
                  placeIdx,
                  showIdx,
                  raceNo: requestedRaceNo,
                };
                return false; // break
              }
            }
          }
        }
      });
    }
    
    // Fallback to first table if still no match
    if (!target && runnerTables.length > 0) {
      target = runnerTables[0];
    }
    
    if (!target) {
      return outcome;
    }

    const { table: $runnerTable, runnerIdx, winIdx, placeIdx, showIdx } =
      target;

    const extracted = extractOutcomeFromRunnerTable($, $runnerTable, {
      runnerIdx,
      winIdx,
      placeIdx,
      showIdx,
    });

    // Validate all extracted names before returning
    outcome.win = looksLikeHorseName(extracted.win) ? extracted.win.trim() : "";
    outcome.place = looksLikeHorseName(extracted.place) ? extracted.place.trim() : "";
    outcome.show = looksLikeHorseName(extracted.show) ? extracted.show.trim() : "";
    
    // Only return if at least one is valid
    if (!isValidOutcome(outcome)) {
      return {};
    }
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
    // Clean HTML before parsing
    const cleaned = cleanHtml(html);
    const $ = cheerio.load(cleaned);
    const isHRN = /horseracingnation\.com/i.test(url);

    // For HRN pages, use race-specific parsing
    if (isHRN && raceNo) {
      const hrnOutcome = parseHRNRaceOutcome($, String(raceNo));
      if (isValidOutcome(hrnOutcome)) {
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

      let name = $(cells[1]).text().trim();
      // Clean name: remove jockeys, payouts, etc.
      name = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
      name = name.replace(/\$\d+\.\d+/g, "").replace(/\d+\.\d+/g, "").trim();
      name = name.replace(/\s+[A-Z]\.\s+[A-Z][a-z]+\s*$/, "").trim();
      name = name.replace(/\s+\d+\.?\d*\s*$/, "").trim();
      
      // Validate before adding
      if (!looksLikeHorseName(name)) return;
      name = (name || "").replace(/\s+/g, " ").trim();

      rows.push({ pos, name });
    });

    const byPos = new Map();
    rows.forEach(({ pos, name }) => {
      if (!byPos.has(pos)) {
        byPos.set(pos, name);
      }
    });

    // Validate before setting outcome
    if (byPos.get(1) && looksLikeHorseName(byPos.get(1))) outcome.win = byPos.get(1);
    if (byPos.get(2) && looksLikeHorseName(byPos.get(2))) outcome.place = byPos.get(2);
    if (byPos.get(3) && looksLikeHorseName(byPos.get(3))) outcome.show = byPos.get(3);

    // Text-based heuristics fallback (only if no valid outcome yet)
    if (!isValidOutcome(outcome)) {
      const winMatch = cleaned.match(/Win[:\s]+([A-Za-z0-9' .\-]+)/i);
      const placeMatch = cleaned.match(/Place[:\s]+([A-Za-z0-9' .\-]+)/i);
      const showMatch = cleaned.match(/Show[:\s]+([A-Za-z0-9' .\-]+)/i);

      if (winMatch && looksLikeHorseName(winMatch[1])) {
        outcome.win = normalizeHorseName(winMatch[1]);
      }
      if (placeMatch && looksLikeHorseName(placeMatch[1])) {
        outcome.place = normalizeHorseName(placeMatch[1]);
      }
      if (showMatch && looksLikeHorseName(showMatch[1])) {
        outcome.show = normalizeHorseName(showMatch[1]);
      }
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
    const cleaned = cleanHtml(html);

    // Verify page contains the correct race number before parsing
    if (ctx.raceNo) {
      const raceNoStr = String(ctx.raceNo).trim();
      const trackLower = (ctx.track || "").toLowerCase();

      const hasRaceNo = new RegExp(
        `Race\\s*#?\\s*${raceNoStr}\\b`,
        "i"
      ).test(cleaned);

      const hasTrack = trackLower
        ? new RegExp(
            trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i"
          ).test(cleaned)
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

    const outcome = parseOutcomeFromHtml(cleaned, url, ctx.raceNo);
    // Only return if outcome is valid
    if (!isValidOutcome(outcome)) {
      return {};
    }
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
 * Pick best result: prefer Equibase first, then HRN entries/results pages
 * Filters by date and race number to ensure we get the correct race
 * @param {Array} results - Search results from CSE
 * @param {string} targetDate - ISO date (YYYY-MM-DD) to match
 * @param {string} targetRaceNo - Race number to match
 * @param {string} targetTrack - Track name (normalized) for additional validation
 */
function pickBestResult(results, targetDate = "", targetRaceNo = "", targetTrack = "") {
  try {
    if (!Array.isArray(results) || results.length === 0) return null;

    // Normalize target date for URL matching (YYYY-MM-DD, YYYYMMDD, MM/DD/YYYY)
    const dateVariants = [];
    if (targetDate) {
      const dateStr = targetDate.trim();
      // ISO format: 2025-11-22
      dateVariants.push(dateStr);
      // Compact: 20251122
      dateVariants.push(dateStr.replace(/-/g, ""));
      // US format: 11/22/2025
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        dateVariants.push(`${parts[1]}/${parts[2]}/${parts[0]}`);
      }
    }

    // Normalize track name for matching
    const trackLower = (targetTrack || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Score function: higher score = better match
    const scoreResult = (r) => {
      let score = 0;
      const url = (r.link || "").toLowerCase();
      const title = (r.title || "").toLowerCase();
      const snippet = (r.snippet || "").toLowerCase();

      // Date matching: boost if URL/title contains target date
      if (targetDate && dateVariants.length > 0) {
        const hasDate = dateVariants.some((variant) => 
          url.includes(variant.toLowerCase()) || title.includes(variant.toLowerCase())
        );
        if (hasDate) {
          score += 100; // Strong boost for date match
        } else {
          score -= 50; // Penalize if date doesn't match
        }
      }

      // Race number matching: boost if URL/title contains race number
      if (targetRaceNo) {
        const raceNoStr = String(targetRaceNo).trim();
        const racePattern = new RegExp(`race\\s*#?\\s*${raceNoStr}\\b`, "i");
        if (racePattern.test(url) || racePattern.test(title)) {
          score += 50; // Boost for race number match
        } else {
          score -= 25; // Penalize if race number doesn't match
        }
      }

      // Track matching: boost if URL/title contains track name
      if (trackLower) {
        const trackPattern = new RegExp(trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        if (trackPattern.test(url) || trackPattern.test(title)) {
          score += 30;
        }
      }

      // Penalize stats/picks pages
      if (/power\s*picks?|stats?|picks?\s*(are|is)\s+winning/i.test(url) || 
          /power\s*picks?|stats?|picks?\s*(are|is)\s+winning/i.test(title)) {
        score -= 100; // Strong penalty for stats pages
      }

      return score;
    };

    // 1) Prefer Equibase chart pages FIRST (with date/race filtering)
    const equibaseCharts = results.filter((r) => {
      const url = (r.link || "").toLowerCase();
      return url.includes("equibase.com") && url.includes("chart");
    });

    if (equibaseCharts.length > 0) {
      // Score and sort Equibase results
      const scored = equibaseCharts.map((r) => ({ result: r, score: scoreResult(r) }));
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      // Only return if score is positive (date/race matches) or if it's the only option
      if (best.score > 0 || equibaseCharts.length === 1) {
        return best.result;
      }
    }

    // 2) Fall back to HorseracingNation entries/results pages (with date/race filtering)
    const hrnPages = results.filter((r) => {
      const url = (r.link || "").toLowerCase();
      return (
        url.includes("horseracingnation.com") &&
        (url.includes("/entries-results/") ||
          url.includes("/entries/") ||
          url.includes("/entries-results-"))
      );
    });

    if (hrnPages.length > 0) {
      // Score and sort HRN results
      const scored = hrnPages.map((r) => ({ result: r, score: scoreResult(r) }));
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      // Only return if score is positive (date/race matches) or if it's the only option
      if (best.score > 0 || hrnPages.length === 1) {
        return best.result;
      }
    }

    // 3) Finally, score all results and return the best one
    const allScored = results.map((r) => ({ result: r, score: scoreResult(r) }));
    allScored.sort((a, b) => b.score - a.score);
    return allScored[0]?.result || results[0];
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

      if (equibaseResult && equibaseResult.outcome && isValidOutcome(equibaseResult.outcome)) {
        // Equibase succeeded - compute hits and return immediately
        const outcome = equibaseResult.outcome;
        const equibaseUrl = equibaseResult.url;

        // Normalize names for comparison
        const norm = (s) => normalizeHorseName(s || "");
        const predictedSafe = {
          win: (predicted?.win || "").trim(),
          place: (predicted?.place || "").trim(),
          show: (predicted?.show || "").trim(),
        };

        const pWin = norm(predictedSafe.win);
        const pPlace = norm(predictedSafe.place);
        const pShow = norm(predictedSafe.show);
        const oWin = norm(outcome.win);
        const oPlace = norm(outcome.place);
        const oShow = norm(outcome.show);

        // Compute hits with normalized names
        const winHit = !!pWin && !!oWin && pWin === oWin;
        const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
        const showHit = !!pShow && !!oShow && pShow === oShow;
        
        // Top3Hit: any predicted horse is in the top 3 outcome positions
        const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
        const top3Hit = [pWin, pPlace, pShow]
          .filter(Boolean)
          .some(name => top3Set.has(name));

        const hits = {
          winHit,
          placeHit,
          showHit,
          top3Hit,
        };

        // Build summary
        const summaryLines = [];
        summaryLines.push(`Using date: ${safeDate}`);
        summaryLines.push(`Step: verify_race`);
        summaryLines.push(`Query: Equibase chart: ${safeTrack} ${safeDate} Race ${safeRaceNo}`);
        summaryLines.push(`Top Result: Equibase chart -> ${equibaseUrl}`);

        const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(
          Boolean
        );
        if (outcomeParts.length) {
          summaryLines.push(`Outcome: ${outcomeParts.join(" / ")}`);
        } else {
          summaryLines.push("Outcome: (none)");
        }

        const predictedParts = [predictedSafe.win, predictedSafe.place, predictedSafe.show].filter(
          Boolean
        );
        if (predictedParts.length) {
          summaryLines.push(`Predicted: ${predictedParts.join(" / ")}`);
        } else {
          summaryLines.push("Predicted: (none)");
        }

        const hitParts = [];
        if (hits.winHit) hitParts.push("winHit");
        if (hits.placeHit) hitParts.push("placeHit");
        if (hits.showHit) hitParts.push("showHit");
        if (hits.top3Hit) hitParts.push("top3Hit");
        
        summaryLines.push(`Hits: ${hitParts.length ? hitParts.join(", ") : "(none)"}`);

        const summary = summaryLines.filter(Boolean).join("\n");

        return {
          ok: true,
          step: "verify_race",
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
            googleUrl: buildGoogleSearchUrl(`Equibase chart: ${safeTrack} ${safeDate} Race ${safeRaceNo}`),
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

    // Pick best result (filter by date and race number)
    const top = pickBestResult(results, safeDate, safeRaceNo, safeTrack);

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

    // Parse outcome from the top result - try Equibase first, then HRN
    let parsedOutcome = { win: "", place: "", show: "" };
    const link = (top.link || "").toLowerCase();

    try {
      // Try Equibase first if URL is Equibase
      if (link.includes("equibase.com")) {
        try {
          const equibaseResult = await resolveEquibaseOutcome({
            track: safeTrack,
            date: safeDate,
            raceNo: safeRaceNo,
          });
          if (equibaseResult && equibaseResult.outcome && isValidOutcome(equibaseResult.outcome)) {
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
      
      // If Equibase didn't work, try HRN
      if (!isValidOutcome(parsedOutcome) && link.includes("horseracingnation.com")) {
        const parsed = await extractOutcomeFromResultPage(top.link, {
          track: safeTrack,
          date: safeDate,
          raceNo: safeRaceNo,
        });

        if (parsed && isValidOutcome(parsed)) {
          parsedOutcome = {
            win: parsed.win || "",
            place: parsed.place || "",
            show: parsed.show || "",
          };
        }
      }
    } catch (err) {
      console.error("[verify_race_full] parser error", {
        link: top.link,
        error: err?.message,
      });
      // Continue with empty outcome - don't throw
    }

    // Build clean outcome - only use if valid
    const outcome = isValidOutcome(parsedOutcome)
      ? parsedOutcome
      : { win: "", place: "", show: "" };

    const predictedSafe = {
      win: (predicted?.win || "").trim(),
      place: (predicted?.place || "").trim(),
      show: (predicted?.show || "").trim(),
    };

    // Normalize names for comparison
    const norm = (s) => normalizeHorseName(s || "");
    const pWin = norm(predictedSafe.win);
    const pPlace = norm(predictedSafe.place);
    const pShow = norm(predictedSafe.show);
    const oWin = norm(outcome.win);
    const oPlace = norm(outcome.place);
    const oShow = norm(outcome.show);

    // Compute hits with normalized names
    const winHit = !!pWin && !!oWin && pWin === oWin;
    const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
    const showHit = !!pShow && !!oShow && pShow === oShow;
    
    // Top3Hit: any predicted horse is in the top 3 outcome positions
    const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
    const top3Hit = [pWin, pPlace, pShow]
      .filter(Boolean)
      .some(name => top3Set.has(name));

    const hits = {
      winHit,
      placeHit,
      showHit,
      top3Hit,
    };

    // Build summary
    const summaryLines = [];
    summaryLines.push(`Using date: ${safeDate}`);
    summaryLines.push(`Step: verify_race`);
    summaryLines.push(`Query: ${queryUsed || ""}`);

    if (top && top.link) {
      summaryLines.push(`Top Result: ${top.title || "Chart"} -> ${top.link}`);
    }

    const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(
      Boolean
    );
    if (outcomeParts.length) {
      summaryLines.push(`Outcome: ${outcomeParts.join(" / ")}`);
    } else {
      summaryLines.push("Outcome: (none)");
    }

    const predictedParts = [predictedSafe.win, predictedSafe.place, predictedSafe.show].filter(
      Boolean
    );
    if (predictedParts.length) {
      summaryLines.push(`Predicted: ${predictedParts.join(" / ")}`);
    } else {
      summaryLines.push("Predicted: (none)");
    }

    const hitParts = [];
    if (hits.winHit) hitParts.push("winHit");
    if (hits.placeHit) hitParts.push("placeHit");
    if (hits.showHit) hitParts.push("showHit");
    if (hits.top3Hit) hitParts.push("top3Hit");
    
    summaryLines.push(`Hits: ${hitParts.length ? hitParts.join(", ") : "(none)"}`);

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
        source: link.includes("equibase.com") ? "equibase" : link.includes("horseracingnation.com") ? "hrn" : "other",
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

