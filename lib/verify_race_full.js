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
export function getCanonicalRaceDate(rawDate) {
  // PATCH: If input is already ISO format, return IMMEDIATELY - NO REPROCESSING
  if (rawDate && typeof rawDate === "string") {
    const trimmed = rawDate.trim();
    // If already ISO format and matches regex: ^\d{4}-\d{2}-\d{2}$
    // RETURN IT AS-IS with NO changes
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      console.log('[getCanonicalRaceDate] Already ISO format - returning AS-IS:', trimmed);
      return trimmed; // STOP NORMALIZATION HERE
    }
  }
  
  // If rawDate is falsy, return today in YYYY-MM-DD (UTC, no timezone shifts)
  if (!rawDate || typeof rawDate !== "string" || !rawDate.trim()) {
    console.log('[getCanonicalRaceDate] rawDate is falsy, falling back to today');
    const now = new Date();
    // Use UTC methods to avoid timezone shifts
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const todayIso = `${year}-${month}-${day}`;
    console.log('[getCanonicalRaceDate] Today (UTC):', todayIso);
    return todayIso;
  }

  const trimmed = rawDate.trim();

  // Try MM/DD/YYYY format (common from UI)
  // DO NOT EVER apply timezone or JS Date() operations - only string parsing
  const mmddyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy;
    const monthPadded = month.padStart(2, "0");
    const dayPadded = day.padStart(2, "0");
    const converted = `${year}-${monthPadded}-${dayPadded}`;
    console.log('[getCanonicalRaceDate] Converted MM/DD/YYYY to ISO:', trimmed, '->', converted);
    return converted;
  }

  // If we can't parse it, return as-is (let downstream handle validation)
  // But log a warning
  console.warn("[getCanonicalRaceDate] Unrecognized date format, using as-is:", trimmed);
  return trimmed;
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
// HRN WPS parsing: use Win/Place/Show payout columns to classify rows.
//
// Rules (matches the HRN screenshots):
// - Row with Win + Place + Show payouts  -> WIN horse
// - Row with Place + Show (no Win)       -> PLACE horse
// - Row with Show only (no Win/Place)    -> SHOW horse
// If any of these are missing, we fall back by taking the next best row
// that has the corresponding payout.
function parseHRNRaceOutcome($, ctx = {}) {
  if (!$) {
    return {
      win: null,
      place: null,
      show: null,
    };
  }

  // Helper: normalize horse name, strip trailing speed fig "(107*)" etc.
  function normalizeHorseName(raw) {
    if (!raw) return "";
    return raw
      // strip trailing "(###*)" or "(###)"
      .replace(/\s*\(\d+[^)]*\)\s*$/u, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Helper: normalize payout cell, treating "-", "", "—" etc. as empty.
  function normalizePayout(raw) {
    if (!raw) return null;
    const t = String(raw).replace(/[$,\s]/g, "").trim();
    if (!t || t === "-" || t === "–" || t === "—") return null;
    // Not actually used numerically; just indicate "has a payout"
    return t;
  }

  // --- Identify the correct HRN Win/Place/Show table ---
  let wpsTable = null;

  $("table").each((i, tbl) => {
    const headers = $(tbl)
      .find("tr")
      .first()
      .text()
      .toLowerCase();

    // Must contain all payout headers
    const isWps =
      headers.includes("win") &&
      headers.includes("place") &&
      headers.includes("show");

    // Ignore runner/speed tables
    const isRunnerTable =
      headers.includes("speed") && !headers.includes("win");

    if (isWps && !isRunnerTable) {
      wpsTable = tbl;
    }
  });

  if (!wpsTable) {
    return {
      win: null,
      place: null,
      show: null,
    };
  }

  // 2) Determine column indices for Runner, Win, Place, Show.
  const headerCells = $(wpsTable).find("tr").first().find("th");
  let idxRunner = -1;
  let idxWin = -1;
  let idxPlace = -1;
  let idxShow = -1;

  headerCells.each((i, th) => {
    const txt = $(th).text().toLowerCase().trim();
    if (txt.includes("runner")) idxRunner = i;
    else if (txt === "win") idxWin = i;
    else if (txt === "place") idxPlace = i;
    else if (txt === "show") idxShow = i;
  });

  if (idxRunner === -1 || idxWin === -1 || idxPlace === -1 || idxShow === -1) {
    return {
      win: null,
      place: null,
      show: null,
    };
  }

  // 3) Walk body rows and classify by payout pattern.
  const rows = $(wpsTable).find("tr").slice(1); // skip header

  let winHorse = null;
  let placeHorse = null;
  let showHorse = null;

  // Keep a simple ordered list of rows that have any payout at all.
  // We'll use this ONLY as a last-resort fallback to pick the Show horse.
  const payoutRows = [];

  // Helper to clean payout text (same as normalizePayout but returns string for consistency)
  function cleanPayoutText(text) {
    if (!text) return "";
    const t = String(text).replace(/[$,\s]/g, "").trim();
    if (!t || t === "-" || t === "–" || t === "—") return "";
    return t;
  }

  rows.each((i, row) => {
    const $row = $(row);
    const $cells = $row.find("td");
    if ($cells.length < 4) return;

    const rawName = $cells.eq(idxRunner).text();
    const horseName = normalizeHorseName(rawName);
    if (!horseName) return;

    // Get raw payout text (before cleaning) for the "any payout" check
    const winRaw = idxWin >= 0 ? $cells.eq(idxWin).text().trim() : "";
    const placeRaw = idxPlace >= 0 ? $cells.eq(idxPlace).text().trim() : "";
    const showRaw = idxShow >= 0 ? $cells.eq(idxShow).text().trim() : "";

    // "any payout" check uses RAW text, not the cleaned/normalized versions.
    // We only care that *some* money is displayed in ANY of the three columns.
    const hasAnyPayout = [winRaw, placeRaw, showRaw].some((txt) => {
      if (!txt) return false;
      const trimmed = txt.trim();
      if (!trimmed || trimmed === "-") return false;
      // Strip out non-numeric chars and see if anything numeric is left.
      const numeric = trimmed.replace(/[^0-9.]/g, "");
      return numeric.length > 0;
    });

    if (hasAnyPayout) {
      payoutRows.push({ name: horseName });
    }

    const winText = cleanPayoutText(winRaw);
    const placeText = cleanPayoutText(placeRaw);
    const showText = cleanPayoutText(showRaw);

    const hasWin = !!winText;
    const hasPlace = !!placeText;
    const hasShow = !!showText;

    // 1) WIN = first horse with a Win payout
    if (!winHorse && hasWin) {
      winHorse = horseName;
    }

    // 2) PLACE = first horse with a Place payout that isn't the Win horse
    if (!placeHorse && hasPlace && horseName !== winHorse) {
      placeHorse = horseName;
    }
  });

  // AFTER winHorse and placeHorse have been determined,
  // scan ALL rows for show payout
  if (!showHorse) {
    rows.each((i, row) => {
      if (showHorse) return; // already found

      const cells = $(row).find("td");
      const horseRaw = cells.eq(idxRunner).text();
      const showTxt = cells.eq(idxShow).text().trim();

      if (!horseRaw) return;

      const horse = normalizeHorseName(horseRaw);

      // skip win/place horses
      if (horse === winHorse || horse === placeHorse) return;

      // NEW LOGIC:
      // If the Show column has ANY payout text (not "-" and not empty), this is the SHOW horse.
      if (showTxt && showTxt !== "-" && !isNaN(parseFloat(showTxt.replace(/[^0-9.]/g, "")))) {
        showHorse = horse;
      }
    });
  }

  // LAST-RESORT fallback for Show horse.
  // At this point winHorse and placeHorse have already been chosen.
  // If showHorse is still missing, pick the next horse (in payout row order)
  // that isn't win/place. This matches the HRN WPS layout where the three
  // payout rows are Win, Place, Show from top to bottom.
  if (!showHorse && payoutRows.length > 0) {
    for (const row of payoutRows) {
      if (row.name && row.name !== winHorse && row.name !== placeHorse) {
        showHorse = row.name;
        break;
      }
    }
  }

  // 🔥 FINAL: simple fallback based on reading order
  if (!showHorse) {
    const horsesInOrder = rows
      .map((_, row) => {
        const cells = $(row).find("td");
        const name = normalizeHorseName(cells.eq(idxRunner).text());
        return name || null;
      })
      .filter(Boolean);

    // Find the place horse index and take the very next horse
    const placeIndex = horsesInOrder.indexOf(placeHorse);
    if (placeIndex !== -1 && horsesInOrder[placeIndex + 1]) {
      const candidate = horsesInOrder[placeIndex + 1];

      // Avoid picking win/place again
      if (candidate !== winHorse && candidate !== placeHorse) {
        showHorse = candidate;
      }
    }
  }

  // If STILL nothing, try grabbing next available horse down from win
  if (!showHorse) {
    const horsesInOrder = rows
      .map((_, row) => {
        const cells = $(row).find("td");
        const name = normalizeHorseName(cells.eq(idxRunner).text());
        return name || null;
      })
      .filter(Boolean);

    const winIndex = horsesInOrder.indexOf(winHorse);
    if (winIndex !== -1) {
      for (let i = winIndex + 1; i < horsesInOrder.length; i++) {
        const candidate = horsesInOrder[i];
        if (candidate !== winHorse && candidate !== placeHorse) {
          showHorse = candidate;
          break;
        }
      }
    }
  }

  // --- FINAL ultra-simple reading-order fallback for SHOW ---
  if (!showHorse && (winHorse || placeHorse) && wpsTable && typeof idxRunner === "number") {
    const orderedHorses = [];

    // Rebuild ordered list of runner names from the same table
    const allRows = $(wpsTable).find("tr");
    allRows.slice(1).each((_, row) => {
      const cells = $(row).find("td");
      if (!cells.length) return;

      const runnerCell = cells.eq(idxRunner);
      if (!runnerCell || !runnerCell.length) return;

      const rawName = runnerCell.text().trim();
      const name = normalizeHorseName(rawName);
      if (!name) return;

      orderedHorses.push(name);
    });

    if (orderedHorses.length) {
      const lower = (s) => (s || "").toLowerCase();

      const winName = winHorse || null;
      const placeName = placeHorse || null;

      const placeIdx = placeName
        ? orderedHorses.findIndex((h) => lower(h) === lower(placeName))
        : -1;
      const winIdx = winName
        ? orderedHorses.findIndex((h) => lower(h) === lower(winName))
        : -1;

      // First preference: horse immediately after PLACE
      if (!showHorse && placeIdx !== -1 && placeIdx + 1 < orderedHorses.length) {
        const candidate = orderedHorses[placeIdx + 1];
        if (
          lower(candidate) !== lower(winName) &&
          lower(candidate) !== lower(placeName)
        ) {
          showHorse = candidate;
        }
      }

      // Second preference: first horse after WIN that isn't WIN or PLACE
      if (!showHorse && winIdx !== -1) {
        for (let i = winIdx + 1; i < orderedHorses.length; i++) {
          const candidate = orderedHorses[i];
          if (
            lower(candidate) !== lower(winName) &&
            lower(candidate) !== lower(placeName)
          ) {
            showHorse = candidate;
            break;
          }
        }
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
      const hrnOutcome = parseHRNRaceOutcome($, { raceNo: String(raceNo), track: trackFromUrl });
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
    const $ = cheerio.load(cleaned);
    const hrnOutcome = parseHRNRaceOutcome($, context);
    
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
  
  // Ensure ISO date format (handler should have already normalized, but defensive check)
  function ensureIsoDate(dateStr) {
    if (!dateStr) return "";
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // we assume handler already normalized; if not, we can fallback minimally:
    const mmdd = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (mmdd) {
      let [, m, d, y] = mmdd;
      if (m.length === 1) m = "0" + m;
      if (d.length === 1) d = "0" + d;
      return `${y}-${m}-${d}`;
    }
    return s;
  }
  
  // Treat context.date as the source of truth - it MUST be provided by handler
  if (!context.date) {
    throw new Error("runFullVerifyRace: context.date is required");
  }
  
  const targetDateIso = ensureIsoDate(context.date);
  
  // Assert format - if not ISO, log warning but continue
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateIso)) {
    console.warn("[VERIFY_RACE] Non-ISO date passed into full verify:", targetDateIso);
  }
  
  // Optional debug
  if (process.env.NODE_ENV !== "production") {
    console.log("[runFullVerifyRace] using date", { contextDate: context.date, targetDateIso });
  }
  
  // From here on, ALWAYS use targetDateIso for queries/URLs/summaries
  // This is the SINGLE source of truth for the race date
  // NEVER call new Date() or generate dates - only use targetDateIso
  const safeDate = targetDateIso;
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
    if (!safeTrack || !safeDate) {
      return {
        ...defaultResponse,
        step: "verify_race_full_validation",
        error: "Missing required fields: track and date",
        summary: "Full verify race requires track and date.",
      };
    }

    // === STEP 1: Use CSE to find HRN + Equibase candidate links ===
    const searchResult = await searchRaceLinks(req, safeTrack, safeDate, safeRaceNo);
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
          date: safeDate,
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
          date: safeDate,
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
          date: safeDate,
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
        date: safeDate,
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
          usingDate: safeDate,
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

    return {
      ...defaultResponse,
      step: "verify_race_full_fallback",
      query: cseQuery,
      top: bestLink ? {
        title: bestTitle,
        link: bestLink,
      } : {
        title: "Google search",
        link: googleUrl,
      },
      summary: `Using date: ${safeDate}\nStep: verify_race_full_fallback\nQuery: ${cseQuery}\nTop Result: ${bestLink ? `${bestTitle} -> ${bestLink}` : `Google search -> ${googleUrl}`}\nOutcome: (none)\nPredicted: ${predictedSafe.win || "-"} / ${predictedSafe.place || "-"} / ${predictedSafe.show || "-"}\nHits: (none)\n${parserNote}`,
      debug: {
        googleUrl,
        onlyEntriesPages,
        candidatesCount: allCandidates.length,
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

