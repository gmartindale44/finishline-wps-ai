// lib/verify_race_full.js
// Full CSE + HRN + Equibase parsing pipeline for verify_race
// All environment variable reads and network calls are inside functions (no top-level execution)

import * as cheerio from "cheerio";
import {
  resolveEquibaseOutcome,
  parseEquibaseOutcomeFromUrl,
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
 * Parse ISO date string without timezone shifts
 * @param {string} dateStr - Expected format: "YYYY-MM-DD"
 * @returns {{ year: number; month: number; day: number } | null}
 */
function parseISODateString(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.trim().split("-");
  if (parts.length !== 3) return null;
  
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10); // 1-12
  const day = parseInt(parts[2], 10);   // 1-31
  
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  
  return { year, month, day };
}

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format date variants from ISO string (pure string operations, no Date objects)
 * @param {string} iso - ISO date string "YYYY-MM-DD"
 * @returns {{ iso: string; humanShort: string; usNumeric: string }}
 */
function formatDateVariants(iso) {
  // iso assumed to be YYYY-MM-DD
  const mNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return {
      iso,
      humanShort: iso,
      usNumeric: iso,
    };
  }
  const [, y, m, d] = match;
  const monthIndex = parseInt(m, 10) - 1;
  const humanShort = `${mNames[monthIndex]} ${parseInt(d, 10)} ${y}`;
  const usNumeric = `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`;
  return { iso, humanShort, usNumeric };
}

/**
 * Returns true if the page (url/title/snippet) clearly mentions the target date
 * in any of the expected string formats. Uses string checks only (no Date objects).
 * @param {Object} params
 * @param {string} params.text - Combined text from link + title + snippet
 * @param {string} params.targetIso - Target date in ISO format (YYYY-MM-DD)
 * @param {string[]} params.extraVariants - Additional date variant strings to check
 * @returns {boolean} - True if the page contains the target date, false otherwise
 */
function pageContainsTargetDate({ text, targetIso, extraVariants = [] }) {
  const haystack = (text || "").toLowerCase();
  if (!targetIso) return false;

  const trimmed = targetIso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // Not an ISO date; bail out and don't filter.
    return false;
  }

  const [yyyy, mm, dd] = trimmed.split("-");
  const m = parseInt(mm, 10);
  const d = parseInt(dd, 10);

  if (!yyyy || Number.isNaN(m) || Number.isNaN(d)) return false;

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthName = monthNames[m - 1] || "";
  const monthShort = monthName ? monthName.slice(0, 3) : "";

  const numericMonth = String(m);
  const numericDay = String(d);

  // Build a set of candidate date strings we expect to see.
  const needles = new Set([
    // ISO
    `${yyyy}-${mm}-${dd}`,
    // Numeric US forms
    `${mm}/${dd}/${yyyy}`,
    `${numericMonth}/${numericDay}/${yyyy}`,
    `${mm}-${dd}-${yyyy}`,
    // Short month forms
    monthShort && `${monthShort} ${numericDay} ${yyyy}`,
    monthShort && `${monthShort} ${numericDay}, ${yyyy}`,
    // Long month forms
    monthName && `${monthName} ${numericDay} ${yyyy}`,
    monthName && `${monthName} ${numericDay}, ${yyyy}`,
  ].filter(Boolean));

  // Add any existing variants (e.g., from formatDateVariants)
  if (Array.isArray(extraVariants)) {
    for (const v of extraVariants) {
      if (v && typeof v === "string") {
        needles.add(v.trim());
      }
    }
  }

  for (const raw of needles) {
    const needle = raw.toLowerCase();
    if (!needle) continue;
    if (haystack.includes(needle)) return true;
  }

  return false;
}

/**
 * Hard guard: if the URL itself contains an ISO date (YYYY-MM-DD) that does NOT
 * match the targetIso, we treat this as a wrong-date page and reject it.
 *
 * Example:
 *   targetIso = "2025-11-23"
 *   url       = ".../aqueduct/2025-01-24"
 * → urlHasWrongIsoDate(...) === true  → result should be discarded.
 * @param {string} url - URL to check
 * @param {string} targetIso - Target date in ISO format (YYYY-MM-DD)
 * @returns {boolean} - True if URL contains a different ISO date than target
 */
function urlHasWrongIsoDate(url, targetIso) {
  if (!url || !targetIso) return false;
  const lowerUrl = url.toLowerCase();
  const isoRegex = /(\d{4})-(\d{2})-(\d{2})/g;
  let match;
  while ((match = isoRegex.exec(lowerUrl)) !== null) {
    const iso = match[0];
    // If the URL advertises a concrete ISO date and it doesn't match our target,
    // this is almost certainly the wrong day (e.g. January vs November).
    if (iso !== targetIso.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Get canonical race date from user input
 * Converts various date formats to YYYY-MM-DD without timezone shifts
 * @param {string} rawDate - Date string from user (can be YYYY-MM-DD, MM/DD/YYYY, etc.)
 * @returns {string} - Canonical date in YYYY-MM-DD format, or today's date if rawDate is missing/empty
 */
/**
 * Get canonical race date from user input
 * PATCH: If input is already ISO "YYYY-MM-DD", return it IMMEDIATELY with NO REPROCESSING
 * @param {string} rawDate - Date string from user (can be YYYY-MM-DD, MM/DD/YYYY, etc.)
 * @returns {string} - Canonical date in YYYY-MM-DD format, or today's date if rawDate is missing/empty
 */
// Pure string formatter: converts context date to ISO YYYY-MM-DD
// MUST NOT call new Date() or do any timezone conversion
function toIsoDateFromContext(ctx) {
  if (!ctx) return null;
  // Prefer ctx.date, then ctx.raceDate, then ctx.canonicalDate
  const raw = ctx.date ?? ctx.raceDate ?? ctx.canonicalDate ?? null;
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Normalize horse name for comparison
 * Strips speed figs like (131*), punctuation, multiple spaces
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  if (!name) return "";
  let normalized = String(name).toLowerCase();
  // Strip trailing speed figs: (131*), (123), etc.
  normalized = normalized.replace(/\s*\(\d+\*?\)\s*$/g, "").trim();
  // Strip trailing asterisks used for speed figs
  normalized = normalized.replace(/\*+$/g, "").trim();
  // Normalize spaces (multiple spaces to single)
  normalized = normalized.replace(/\s+/g, " ").trim();
  // Remove extra punctuation but keep apostrophes and dashes
  normalized = normalized.replace(/[^\w\s'-]/g, "").trim();
  return normalized;
}

/**
 * Check if text looks like a valid horse name
 * Valid horse = 2-40 chars, letters/spaces/dashes/apostrophes only
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeHorseName(text) {
  if (!text) return false;
  let t = text.trim();
  if (!t) return false;
  
  // Strip speed figs before validation: (131*), (97*), etc.
  t = t.replace(/\s*\(\d+\*?\)\s*$/g, "").trim();
  if (!t) return false;
  
  // Length check: 2-40 chars
  if (t.length < 2) return false;
  if (t.length > 40) return false;
  
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
  
  // Reject stats/picks text patterns
  if (/picks?\s+(are|is)\s+(winning|win)/i.test(t)) return false;
  if (/\b(picks?|stats?|percent|%|winning|payouts?)\b/i.test(t) && /\d+\.?\d*/.test(t)) return false;
  if (/^\d+\.\d+\s*$/.test(t)) return false; // Pure decimal numbers like "16.0"
  
  // Reject pure numbers
  if (/^\d+$/.test(t)) return false;
  
  // Must contain at least one letter
  if (!/[A-Za-z]/.test(t)) return false;
  
  // Valid horse = letters/spaces/dashes/apostrophes only (after cleaning)
  // Allow: letters, spaces, dashes, apostrophes
  const validPattern = /^[A-Za-z\s'-]+$/;
  if (!validPattern.test(t)) return false;
  
  return true;
}

/**
 * Validate that an outcome object has at least one valid horse name
 * Allows partial outcomes (e.g., only Win is valid)
 * @param {{ win?: string; place?: string; show?: string } | null | undefined} outcome
 * @returns {boolean}
 */
export function isValidOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return false;
  const { win, place, show } = outcome;
  return looksLikeHorseName(win) || looksLikeHorseName(place) || looksLikeHorseName(show);
}

/**
 * Check if outcome has at least one valid position (alias for isValidOutcome for clarity)
 * @param {{ win?: string; place?: string; show?: string } | null | undefined} outcome
 * @returns {boolean}
 */
function hasAnyOutcomePosition(outcome) {
  return isValidOutcome(outcome);
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
 * NEW ALGORITHM: Find race heading, then first results table after it
 * @param {cheerio.CheerioAPI} $
 * @param {string} raceNo
 * @param {string} track - Track name for additional validation
 * @returns {{ win?: string; place?: string; show?: string }}
 */

// --- HRN WPS parsing helpers -------------------------------------------------

function norm(txt) {
  return (txt || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
}

function stripSpeedFigures(name) {
  // "Laugh Like Lucy (96*)" -> "Laugh Like Lucy"
  return (name || "").replace(/\s*\(\d+\*?\)\s*$/, "").trim();
}

function normText(txt) {
  return String(txt || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isWpsTable($, table) {
  const $table = $(table);
  const headerText = normText($table.find("tr").first().text());
  return (
    headerText.includes("runner") &&
    headerText.includes("win") &&
    headerText.includes("place") &&
    headerText.includes("show")
  );
}

function extractRaceNo(text) {
  const t = normText(text);
  const m = t.match(/race\s*#?\s*(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

// Find all WPS tables and annotate them with the race number
// from the nearest heading above them.
function findAnnotatedWpsTables($) {
  const out = [];
  $("table").each((_, table) => {
    if (!isWpsTable($, table)) return;

    const $table = $(table);
    const $heading = $table
      .prevAll("h1,h2,h3,h4,h5,h6,strong,b,p,div")
      .filter((_, el) => /race/i.test($(el).text()))
      .first();

    let raceNo = null;
    if ($heading.length) {
      raceNo = extractRaceNo($heading.text());
    }

    out.push({ table: $table, raceNo });
  });
  return out;
}

function chooseWpsTableForRace($, ctx) {
  const annotated = findAnnotatedWpsTables($);
  if (!annotated.length) return null;

  const raw =
    ctx?.race ??
    ctx?.raceNo ??
    ctx?.raceNumber ??
    (ctx?.query && (ctx.query.race || ctx.query.raceNo));
  const requestedRaceNo = raw != null ? parseInt(String(raw), 10) : null;

  // Try exact match first
  if (requestedRaceNo && Number.isFinite(requestedRaceNo)) {
    const exact = annotated.find((t) => t.raceNo === requestedRaceNo);
    if (exact) return exact.table;
  }

  // If no exact match but some tables have race numbers, pick the closest one
  if (requestedRaceNo && Number.isFinite(requestedRaceNo)) {
    let best = null;
    let bestDelta = Infinity;
    for (const t of annotated) {
      if (t.raceNo == null) continue;
      const delta = Math.abs(t.raceNo - requestedRaceNo);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = t;
      }
    }
    if (best) return best.table;
  }

  // Fallback: no race numbers at all, just use the first WPS table
  return annotated[0].table;
}

export function parseHRNRaceOutcome(html, ctx) {
  const $ = cheerio.load(html);

  const wpsTable = chooseWpsTableForRace($, ctx || {});
  if (!wpsTable || !wpsTable.length) {
    return { win: "", place: "", show: "" };
  }

  // NOTE: from this point down, DO NOT change any of the existing
  // row parsing logic. It already correctly extracts win/place/show.
  const rows = wpsTable.find("tr").slice(1);
  const horses = [];

  rows.each((_, row) => {
    const $cells = $(row).find("td");
    if (!$cells.length) return;

    const rawName = $cells.first().text();
    const name = stripSpeedFigures(rawName);
    if (!name) return;

    horses.push(name);
  });

  const win = horses[0] || "";
  const place = horses[1] || "";
  const show = horses[2] || "";

  return { win, place, show };
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
      // Extract track from URL if possible for better matching
      const trackMatch = url.match(/\/([^\/]+)\/\d{4}-\d{2}-\d{2}/);
      const trackFromUrl = trackMatch ? trackMatch[1].replace(/-/g, " ") : "";
      const hrnOutcome = parseHRNRaceOutcome(cleaned, {
        track: trackFromUrl,
        trackName: trackFromUrl,
        race: raceNo,
        raceNo: raceNo,
      });
      if (isValidOutcome(hrnOutcome) && hrnOutcome.win && hrnOutcome.place && hrnOutcome.show) {
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
 * Parse HRN outcome from a URL
 * @param {string} url - HRN results page URL
 * @param {{ track: string; date: string; raceNo: string | number }} context
 * @returns {Promise<{ win?: string; place?: string; show?: string; source: "hrn"; link: string; title?: string } | null>}
 */
export async function parseHRNOutcomeFromUrl(url, context) {
  try {
    if (!url || typeof url !== "string") {
      return null;
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    });

    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    const cleaned = cleanHtml(html);

    // Verify page contains the correct race number before parsing
    if (context.raceNo) {
      const raceNoStr = String(context.raceNo).trim();
      const trackLower = (context.track || "").toLowerCase();

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
        console.warn("[verify_race_full] HRN page validation failed", {
          url,
          raceNo: context.raceNo,
          track: context.track,
          hasRaceNo,
          hasTrack,
        });
        return null;
      }
    }

    // Use new HRN parsing algorithm
    const hrnOutcome = parseHRNRaceOutcome(cleaned, context);
    
    // Allow partial outcomes - at least one valid position
    if (!hasAnyOutcomePosition(hrnOutcome)) {
      return null;
    }

    return {
      win: hrnOutcome.win || "",
      place: hrnOutcome.place || "",
      show: hrnOutcome.show || "",
      source: "hrn",
      link: url,
      title: "HRN results",
    };
  } catch (error) {
    console.error("[verify_race_full] parseHRNOutcomeFromUrl failed", {
      url,
      context,
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Extract outcome from result page using cheerio (legacy function, kept for compatibility)
 * @param {string} url
 * @param {{ track: string; date: string; raceNo?: string | null }} ctx
 * @returns {Promise<{ win?: string; place?: string; show?: string }>}
 */
async function extractOutcomeFromResultPage(url, ctx) {
  const result = await parseHRNOutcomeFromUrl(url, ctx);
  if (!result) {
    return {};
  }
  return {
    win: result.win,
    place: result.place,
    show: result.show,
  };
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
 * Build multiple CSE queries for a race
 * Uses pure string formatting - no Date objects
 * @param {string} track
 * @param {string} date - ISO date (YYYY-MM-DD) - canonical race date
 * @param {string} raceNo
 * @returns {string[]} Array of query strings
 */
/**
 * Build multiple CSE queries for a race
 * STRICT: Uses ONLY the canonical date parameter - never generates dates
 * @param {string} track
 * @param {string} date - ISO date (YYYY-MM-DD) - MUST be canonical race date
 * @param {string} raceNo
 * @returns {string[]} Array of query strings
 */
function buildCSEQueries(track, date, raceNo) {
  // Validate date is ISO format - STRICT check
  const dateTrimmed = (date || "").trim();
  if (!dateTrimmed || !/^\d{4}-\d{2}-\d{2}$/.test(dateTrimmed)) {
    console.error("[buildCSEQueries] Invalid date format, expected YYYY-MM-DD:", date);
    return [];
  }
  
  console.log("[buildCSEQueries] Building queries with canonical date:", dateTrimmed);
  
  const queries = [];
  const racePart = raceNo ? ` Race ${raceNo}` : "";
  
  // Use formatDateVariants to get all date formats from canonical ISO date
  // This function uses ONLY pure string operations - no Date objects
  const dateVariants = formatDateVariants(dateTrimmed);
  
  // Validate dateVariants were generated correctly
  if (!dateVariants.iso || dateVariants.iso !== dateTrimmed) {
    console.error("[buildCSEQueries] formatDateVariants failed, date:", dateTrimmed, "variants:", dateVariants);
    return [];
  }
  
  console.log("[buildCSEQueries] Date variants:", dateVariants);
  
  const siteBias = "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";
  
  // Query variations using ONLY the canonical date and its variants
  // NEVER use new Date() or today's date here
  queries.push(`${track}${racePart} ${dateVariants.humanShort} results Win Place Show order ${siteBias}`);
  // Add comma variant: "Nov 22, 2025" (with comma after day)
  const humanShortComma = dateVariants.humanShort.replace(/(\w+) (\d+) (\d+)/, "$1 $2, $3");
  queries.push(`${track}${racePart} ${humanShortComma} results Win Place Show ${siteBias}`);
  queries.push(`${track}${racePart} ${dateVariants.usNumeric} results Win Place Show ${siteBias}`);
  queries.push(`${track}${racePart} ${dateVariants.iso} results Win Place Show order ${siteBias}`);
  queries.push(`${track}${racePart} ${dateVariants.iso} result chart official ${siteBias}`);
  queries.push(`${track} ${dateVariants.iso} race ${raceNo} results equibase`);
  queries.push(`${track} ${dateVariants.iso} race ${raceNo} results horseracingnation`);
  
  return queries.filter(Boolean);
}

// ---------------------------------------------------------------------------
// NEW SCORING LOGIC — HRN primary, Equibase backup, hard-ban entries
// ---------------------------------------------------------------------------

function scoreCSEResult(result, opts = {}) {
  const {
    host = "",
    dateVariants = [],
    targetRaceNo,
    targetTrackNormalized,
    targetDateIso,
  } = opts;

  const link = (result.link || "").trim();
  const title = (result.title || "").trim();
  const snippet = (result.snippet || "").trim();

  const linkLower = link.toLowerCase();
  const titleLower = title.toLowerCase();
  const snippetLower = snippet.toLowerCase();

  // --- NEW: strict URL date guard -----------------------------------------
  // If the URL contains an ISO date that does NOT equal the target date,
  // we hard-reject this candidate immediately. This prevents
  // "aqueduct/.../2025-01-24" from winning when the user asked for 2025-11-23.
  if (targetDateIso && urlHasWrongIsoDate(linkLower, targetDateIso)) {
    return -9000;
  }

  // 🔥 HARD BAN entries pages
  if (linkLower.includes("/entries/") || titleLower.includes("entries for")) {
    return -9999;
  }

  // 🔥 HARD BOOST HRN results pages
  if (linkLower.includes("horseracingnation.com/entries-results") ||
      linkLower.includes("horseracingnation.com/results") ||
      titleLower.includes("results")) {
    return 1500;  // HRN MUST WIN
  }

  let score = 0;

  const isHRN = host.includes("horseracingnation.com");
  const isEquibase = host.includes("equibase.com");

  // ---- Host preference: HRN is primary, Equibase is backup ----
  if (isHRN) {
    score += 1200; // HRN must always win if a results page exists
  } else if (isEquibase) {
    score += 400;
  }

  // ---- Strong boost for results/chart pages ----
  // strong boost for real results pages
  if (linkLower.includes("/results/") || linkLower.includes("race-results") || linkLower.includes("/chart/")) {
    score += 600;
  }

  if (titleLower.includes("results") || snippetLower.includes("results")) {
    score += 200;
  }

  // Date relevance: require that the page actually reference the target date
  if (targetDateIso) {
    const hasTargetDate = pageContainsTargetDate({
      text: `${link} ${title} ${snippet}`,
      targetIso: targetDateIso,
      extraVariants: dateVariants,
    });
    if (!hasTargetDate) {
      // Large penalty for pages that don't mention the target date at all.
      score -= 5000;
    } else {
      score += 80;
    }
  }

  // ---- Track match ----
  if (targetTrackNormalized) {
    const trackNeedle = targetTrackNormalized.toLowerCase();
    if (
      titleLower.includes(trackNeedle) ||
      snippetLower.includes(trackNeedle) ||
      linkLower.includes(trackNeedle.replace(/\s+/g, "-"))
    ) {
      score += 60;
    }
  }

  // ---- Race number match ----
  if (targetRaceNo != null) {
    const raceNeedles = [
      `race ${targetRaceNo}`,
      `r${targetRaceNo}`,
      `race-${targetRaceNo}`,
    ];
    if (
      raceNeedles.some(
        (needle) => titleLower.includes(needle) || snippetLower.includes(needle)
      )
    ) {
      score += 60;
    }
  }

  // ---- Junk penalties (picks/analysis/etc.) ----
  const junkPatterns = [
    "picks",
    "handicapping",
    "analysis",
    "preview",
    "tips",
    "free picks",
    "odds comparison",
    "probabilities",
    "statistical analysis",
  ];
  if (
    junkPatterns.some(
      (p) => titleLower.includes(p) || snippetLower.includes(p)
    )
  ) {
    score -= 200;
  }

  return score;
}

/**
 * Search for Equibase and HRN links using CSE
 * Returns ordered candidates list for priority parsing
 * @param {Object} req - Request object (for CSE bridge)
 * @param {string} track
 * @param {string} date - ISO date (YYYY-MM-DD)
 * @param {string} raceNo
 * @returns {Promise<{ query: string; equibaseCandidates: Array; hrnCandidates: Array; orderedCandidates: Array; bestOverall?: { title, link, score }; googleUrl: string }>}
 */
async function searchRaceLinks(req, track, date, raceNo) {
  const queries = buildCSEQueries(track, date, raceNo);
  let allResults = [];
  let queryUsed = queries[0] || "";
  
  // Try each query until we get results
  for (const query of queries) {
    try {
      const items = await runSearch(req, query);
      if (items.length > 0) {
        allResults = items;
        queryUsed = query;
        break;
      }
    } catch (error) {
      console.error("[verify_race_full] CSE query failed", { query, error: error?.message });
    }
  }
  
  // Score and filter results
  // Build date variants for scoring
  const dateVariantsObj = formatDateVariants(date);
  const dateVariants = [
    dateVariantsObj.iso,                    // 2025-11-22
    dateVariantsObj.iso.replace(/-/g, ""),  // 20251122
    dateVariantsObj.usNumeric,              // 11/22/2025
    dateVariantsObj.humanShort.toLowerCase(), // nov 22 2025
    dateVariantsObj.humanShort.toLowerCase().replace(/(\d+) (\d+) (\d+)/, "$1 $2, $3"), // nov 22, 2025
  ];
  
  //------------------------------------------------------------------
  // HARD DATE FILTER (CRITICAL FIX)
  // Reject any CSE result that does NOT contain the target date
  //------------------------------------------------------------------
  const strictFilteredResults = allResults.filter(r => {
    const link = (r.link || "").toLowerCase();
    const title = (r.title || "").toLowerCase();
    const snippet = (r.snippet || "").toLowerCase();

    // quick ISO check
    if (link.includes(date.toLowerCase())) return true;

    // match any date variant anywhere
    return dateVariants.some(v => {
      const vLower = v.toLowerCase();
      return (
        link.includes(vLower) ||
        title.includes(vLower) ||
        snippet.includes(vLower)
      );
    });
  });

  // If nothing passes strict date filter, return empty results
  if (strictFilteredResults.length === 0) {
    const googleUrl = buildGoogleSearchUrl(queryUsed);
    return {
      query: queryUsed,
      equibaseCandidates: [],
      hrnCandidates: [],
      orderedCandidates: [],
      bestOverall: undefined,
      googleUrl,
    };
  }

  //------------------------------------------------------------------
  // CONTINUE WITH SCORING USING FILTERED RESULTS ONLY
  //------------------------------------------------------------------
  
  // Normalize track name for matching
  const targetTrackNormalized = track ? track.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  
  const scoredResults = strictFilteredResults.map((r) => {
    // Extract host from URL
    let host = "";
    try {
      const urlObj = new URL(r.link);
      host = urlObj.hostname;
    } catch {
      // If URL parsing fails, try to extract host manually
      const match = r.link.match(/https?:\/\/([^\/]+)/);
      if (match) host = match[1];
    }
    
    return {
      ...r,
      score: scoreCSEResult(r, {
        host,
        dateVariants,
        targetRaceNo: raceNo,
        targetTrackNormalized,
        targetDateIso: date, // NEW: pass canonical date for hard date gate
      }),
    };
  });
  
  // Separate Equibase and HRN candidates
  const equibaseCandidates = scoredResults
    .filter((r) => r.link.toLowerCase().includes("equibase.com"))
    .sort((a, b) => b.score - a.score)
    .map((r) => ({
      title: r.title,
      link: r.link,
      score: r.score,
      source: "equibase",
    }));
  
  const hrnCandidates = scoredResults
    .filter((r) => {
      const link = r.link.toLowerCase();
      return link.includes("horseracingnation.com") || link.includes("entries.horseracingnation.com");
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => ({
      title: r.title,
      link: r.link,
      score: r.score,
      source: "hrn",
    }));
  
  // Build ordered list: bestEquibase, bestHRN, secondBestEquibase, secondBestHRN, etc.
  const orderedCandidates = [];
  const maxCandidates = Math.max(equibaseCandidates.length, hrnCandidates.length);
  
  for (let i = 0; i < maxCandidates; i++) {
    if (i < equibaseCandidates.length) {
      orderedCandidates.push(equibaseCandidates[i]);
    }
    if (i < hrnCandidates.length) {
      orderedCandidates.push(hrnCandidates[i]);
    }
  }
  
  // 🔥 DEBUG LOG
  console.log("[ORDERED CSE RESULTS]", orderedCandidates.map(o => ({ url: o.link, score: o.score })));
  
  // Best overall (highest score across all)
  const bestOverall = scoredResults.length > 0
    ? scoredResults.sort((a, b) => b.score - a.score)[0]
    : undefined;
  
  const googleUrl = buildGoogleSearchUrl(queryUsed);
  
  return {
    query: queryUsed,
    equibaseCandidates,
    hrnCandidates,
    orderedCandidates,
    bestOverall: bestOverall ? {
      title: bestOverall.title,
      link: bestOverall.link,
      score: bestOverall.score,
    } : undefined,
    googleUrl,
  };
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
  
  // Extract and validate canonical date from context - pure string formatting only
  const canonicalDateIso = toIsoDateFromContext(context);
  
  if (!canonicalDateIso) {
    return {
      ok: false,
      step: "verify_race",
      error: "Missing or invalid race date in context",
      summary: "Race date is required but was not provided or is invalid.",
      outcome: { win: "", place: "", show: "" },
    };
  }
  
  const safeRaceNo = raceNo ? String(raceNo).trim() : "";

  // Build default response structure
  const defaultResponse = {
    ok: false,
    step: "verify_race_full_error",
    date: canonicalDateIso,
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

  // Helper to compute hits from outcome and predicted
  const computeHits = (outcome, predictedSafe) => {
    const norm = (s) => normalizeHorseName(s || "");
    const pWin = norm(predictedSafe.win);
    const pPlace = norm(predictedSafe.place);
    const pShow = norm(predictedSafe.show);
    const oWin = norm(outcome.win);
    const oPlace = norm(outcome.place);
    const oShow = norm(outcome.show);

    const winHit = !!pWin && !!oWin && pWin === oWin;
    const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
    const showHit = !!pShow && !!oShow && pShow === oShow;
    
    const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
    const top3Hit = [pWin, pPlace, pShow]
      .filter(Boolean)
      .some(name => top3Set.has(name));

    return { winHit, placeHit, showHit, top3Hit };
  };

  // Helper to build summary
  const buildSummary = ({ usingDate, step, source, outcome, predicted, hits, topLink, track, raceNo, query }) => {
    const lines = [];
    lines.push(`Using date: ${usingDate}`);
    lines.push(`Step: ${step}`);
    if (query) lines.push(`Query: ${query}`);
    lines.push(`Top Result: ${source === "equibase-direct" ? "Equibase chart" : "Chart"} -> ${topLink}`);
    if (source) lines.push(`Source: ${source}`);
    
    const outcomeParts = [
      outcome.win || "-",
      outcome.place || "-",
      outcome.show || "-",
    ];
    lines.push(`Outcome: ${outcomeParts.join(" / ")}`);
    
    const predictedParts = [
      predicted.win || "-",
      predicted.place || "-",
      predicted.show || "-",
    ];
    lines.push(`Predicted: ${predictedParts.join(" / ")}`);
    
    const hitParts = [];
    if (hits.winHit) hitParts.push("winHit");
    if (hits.placeHit) hitParts.push("placeHit");
    if (hits.showHit) hitParts.push("showHit");
    if (hits.top3Hit) hitParts.push("top3Hit");
    lines.push(`Hits: ${hitParts.length ? hitParts.join(", ") : "(none)"}`);
    
    return lines.filter(Boolean).join("\n");
  };

  try {
    if (!safeTrack || !canonicalDateIso) {
      return {
        ...defaultResponse,
        step: "verify_race_full_validation",
        error: "Missing required fields: track and date",
        summary: "Full verify race requires track and date.",
      };
    }

    // === STEP 1: Use CSE to find HRN + Equibase candidate links ===
    const searchResult = await searchRaceLinks(req, safeTrack, canonicalDateIso, safeRaceNo);
    const { query: cseQuery, equibaseCandidates, hrnCandidates, bestOverall, googleUrl } = searchResult;
    
    // Get best candidates (already sorted by score)
    const hrnTop = hrnCandidates.length > 0 ? hrnCandidates[0] : null;
    const equibaseTop = equibaseCandidates.length > 0 ? equibaseCandidates[0] : null;
    
    // Check if CSE only found entries pages (no results pages)
    const allCandidates = [...hrnCandidates, ...equibaseCandidates];
    const hasResultsPages = allCandidates.some(c => {
      const link = (c.link || "").toLowerCase();
      const title = (c.title || "").toLowerCase();
      return link.includes("/results/") || 
             link.includes("race-results") || 
             link.includes("/chart/") ||
             title.includes("results") ||
             title.includes("chart");
    });
    
    const onlyEntriesPages = !hasResultsPages && allCandidates.length > 0;

    // === STEP 2: Try HRN first (primary source) ===
    let bestResult = null;
    
    if (hrnTop && hrnTop.link) {
      try {
        const parseResult = await parseHRNOutcomeFromUrl(hrnTop.link, {
          track: safeTrack,
          trackName: safeTrack,
          date: canonicalDateIso,
          race: safeRaceNo,
          raceNo: safeRaceNo,
        });

        if (parseResult && isValidOutcome(parseResult)) {
          bestResult = {
            outcome: {
              win: parseResult.win || "",
              place: parseResult.place || "",
              show: parseResult.show || "",
            },
            source: "hrn",
            link: parseResult.link || hrnTop.link,
            title: parseResult.title || hrnTop.title,
          };
        }
      } catch (error) {
        console.error("[verify_race] HRN parse failed", {
          link: hrnTop.link,
          error: error?.message || String(error),
        });
      }
    }

    // === STEP 3: If HRN failed, try Equibase as backup ===
    if (!bestResult && equibaseTop && equibaseTop.link) {
      try {
        const parseResult = await parseEquibaseOutcomeFromUrl(equibaseTop.link, {
          track: safeTrack,
          date: canonicalDateIso,
          raceNo: safeRaceNo,
        });

        if (parseResult && isValidOutcome(parseResult)) {
          bestResult = {
            outcome: {
              win: parseResult.win || "",
              place: parseResult.place || "",
              show: parseResult.show || "",
            },
            source: "equibase",
            link: parseResult.link || equibaseTop.link,
            title: parseResult.title || equibaseTop.title,
          };
        }
      } catch (error) {
        console.error("[verify_race] Equibase parse failed", {
          link: equibaseTop.link,
          error: error?.message || String(error),
        });
      }
    }

    // === STEP 4: Last resort - try Equibase direct if CSE failed ===
    if (!bestResult && safeRaceNo) {
      try {
        const equibaseDirect = await resolveEquibaseOutcome({
          track: safeTrack,
          date: canonicalDateIso,
          raceNo: safeRaceNo,
        });

        if (equibaseDirect && equibaseDirect.outcome && isValidOutcome(equibaseDirect.outcome)) {
          bestResult = {
            outcome: equibaseDirect.outcome,
            source: "equibase-direct",
            link: equibaseDirect.url,
            title: "Equibase chart",
          };
        }
      } catch (error) {
        console.error("[verify_race] Equibase direct failed", {
          error: error?.message || String(error),
        });
      }
    }

    // If we found a valid result, return it
    if (bestResult) {
      const rawOutcome = bestResult.outcome || {};
      
      // Normalize outcome: handle empty strings and apply fallback swap
      // Convert empty strings to null for consistency
      const normalizedOutcome = {
        win: (rawOutcome.win && String(rawOutcome.win).trim()) || null,
        place: (rawOutcome.place && String(rawOutcome.place).trim()) || null,
        show: (rawOutcome.show && String(rawOutcome.show).trim()) || null,
      };

      // Fallback swap: if we got only place/show but no win,
      // treat place as win and show as place, and drop show.
      if (!normalizedOutcome.win && normalizedOutcome.place) {
        normalizedOutcome.win = normalizedOutcome.place;
        normalizedOutcome.place = normalizedOutcome.show || null;
        normalizedOutcome.show = null;
      }

      const outcome = normalizedOutcome;
      const predictedSafe = {
        win: (predicted?.win || "").trim(),
        place: (predicted?.place || "").trim(),
        show: (predicted?.show || "").trim(),
      };

      const hits = computeHits(outcome, predictedSafe);
      
      // Determine source label (hrn, equibase, or equibase-direct)
      const sourceLabel = bestResult.source || "unknown";

      return {
        ok: true,
        step: "verify_race",
        date: canonicalDateIso,
        track: safeTrack,
        raceNo: safeRaceNo,
        query: bestResult.source === "equibase-direct" ? "" : cseQuery,
        top: {
          title: bestResult.title || "Chart",
          link: bestResult.link,
        },
        outcome,
        predicted: predictedSafe,
        hits,
        summary: buildSummary({
          usingDate: canonicalDateIso,
          step: "verify_race",
          source: sourceLabel,
          outcome,
          predicted: predictedSafe,
          hits,
          topLink: bestResult.link,
          track: safeTrack,
          raceNo: safeRaceNo,
          query: bestResult.source === "equibase-direct" ? "" : cseQuery,
        }),
        debug: {
          source: sourceLabel,
          googleUrl,
        },
      };
    }

    // Both Equibase and HRN failed - return fallback with clear explanation
    // Use canonical date directly - no mutation

    const bestLink = bestOverall?.link || null;
    const bestTitle = bestOverall?.title || "Google search";
    
    const predictedSafe = {
      win: (predicted?.win || "").trim(),
      place: (predicted?.place || "").trim(),
      show: (predicted?.show || "").trim(),
    };

    // Determine why parsing failed
    let parserNote = "";
    if (onlyEntriesPages) {
      parserNote = "Parser note: Only entries pages were found for this race date (no Equibase/HRN results charts yet). This usually means the race has not been fully resulted. Falling back to Google-only stub.";
    } else if (allCandidates.length > 0) {
      parserNote = "Parser note: HRN/Equibase chart was fetched but Win/Place/Show horses could not be reliably parsed. Falling back to Google-only stub.";
    } else {
      parserNote = "Parser note: No HRN/Equibase results pages found for this race date. Falling back to Google-only stub.";
    }

    // Ensure the query uses the canonical date - rebuild if necessary
    // The cseQuery should already use canonicalDateIso, but double-check it contains the correct date
    let finalQuery = cseQuery;
    if (canonicalDateIso && !cseQuery.includes(canonicalDateIso)) {
      // Rebuild query with canonical date to ensure consistency
      const dateVariants = formatDateVariants(canonicalDateIso);
      const racePart = safeRaceNo ? ` Race ${safeRaceNo}` : "";
      const siteBias = "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";
      finalQuery = `${safeTrack}${racePart} ${dateVariants.humanShort} results Win Place Show order ${siteBias}`;
    }

    return {
      ...defaultResponse,
      step: "verify_race_full_fallback",
      query: finalQuery,
      date: canonicalDateIso, // Ensure response.date uses canonical date
      top: bestLink ? {
        title: bestTitle,
        link: bestLink,
      } : {
        title: "Google search",
        link: googleUrl,
      },
      summary: `Using date: ${canonicalDateIso}\nStep: verify_race_full_fallback\nQuery: ${finalQuery}\nTop Result: ${bestLink ? `${bestTitle} -> ${bestLink}` : `Google search -> ${googleUrl}`}\nOutcome: (none)\nPredicted: ${predictedSafe.win || "-"} / ${predictedSafe.place || "-"} / ${predictedSafe.show || "-"}\nHits: (none)\n${parserNote}`,
      debug: {
        googleUrl,
        onlyEntriesPages,
        candidatesCount: allCandidates.length,
        canonicalDateIso: canonicalDateIso,
      },
    };
  } catch (err) {
    console.error("[verify_race_full] runFullVerifyRace error", {
      error: err?.message || String(err),
      stack: err?.stack,
      track: safeTrack,
      date: canonicalDateIso,
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


