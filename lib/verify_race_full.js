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
function parseHRNRaceOutcome($, raceNo, track = "") {
  const outcome = {};
  const requestedRaceNo = String(raceNo || "").trim();
  if (!requestedRaceNo) return outcome;

  try {
    // HTML should already be cleaned before being passed to cheerio
    // But ensure scripts/styles are removed from the loaded document
    $("script, style, noscript").remove();

    // Build race heading patterns to match
    // Examples: "Race 1", "Race #1", "Del Mar Race 1", "Race 1 Results"
    const racePatterns = [
      new RegExp(`race\\s*#?\\s*${requestedRaceNo}\\b`, "i"),
      new RegExp(`${requestedRaceNo}\\s+results?`, "i"),
    ];

    // If track is provided, also try track-specific patterns
    if (track) {
      const trackLower = track.toLowerCase().replace(/[^a-z0-9]/g, "\\s*");
      racePatterns.push(
        new RegExp(`${trackLower}\\s+race\\s*#?\\s*${requestedRaceNo}\\b`, "i")
      );
    }

    // Step 1: Find the race heading (h1, h2, h3, h4, or strong heading-like elements)
    let raceHeading = null;
    const headingSelectors = "h1, h2, h3, h4, h5, strong, b, .race-title, .race-heading";

    $(headingSelectors).each((_, el) => {
      if (raceHeading) return false; // Already found, break
      
      const text = $(el).text().trim();
      if (!text) return;

      // Check if this heading matches any race pattern
      const matches = racePatterns.some((pattern) => pattern.test(text));
      if (matches) {
        raceHeading = $(el);
        return false; // Break the loop
      }
    });

    // If no heading found, try looking in divs with class names that suggest race sections
    if (!raceHeading) {
      $("div[class*='race'], div[class*='Race'], section[class*='race'], section[class*='Race']").each((_, el) => {
        if (raceHeading) return false;
        const text = $(el).text().trim();
        const matches = racePatterns.some((pattern) => pattern.test(text));
        if (matches) {
          raceHeading = $(el);
          return false;
        }
      });
    }

    if (!raceHeading || !raceHeading.length) {
      console.warn("[verify_race_full] HRN race heading not found", {
        raceNo: requestedRaceNo,
        track,
      });
      return outcome;
    }

    // Step 2: Find the FIRST results table AFTER the race heading
    // Ignore all tables BEFORE the heading (Power Picks, stats, comments)
    let resultsTable = null;

    // Helper to check if a table looks like a results table
    const isResultsTable = ($table) => {
      const headerRow = $table.find("tr").first();
      const headerCells = headerRow.find("th, td").toArray();
      if (headerCells.length === 0) return false;

      const headerTexts = headerCells.map((cell) =>
        $(cell).text().toLowerCase().trim()
      );

      // Look for runner/horse column and win/place/show/fin columns
      const hasRunner = headerTexts.some((h) => 
        h.includes("runner") || h.includes("horse") || h.includes("pgm")
      );
      const hasFin = headerTexts.some((h) => 
        h.includes("fin") || h === "#" || h === "pos" || h === "position"
      );
      const hasWin = headerTexts.some((h) => h.includes("win"));
      const hasPlace = headerTexts.some((h) => h.includes("place"));
      const hasShow = headerTexts.some((h) => h.includes("show"));

      // This looks like a results table if it has runner/horse or fin column
      return (hasRunner || hasFin) && (hasWin || hasPlace || hasShow || hasFin);
    };

    // Approach 1: Use nextAll to find tables after the heading
    raceHeading.nextAll().each((_, el) => {
      if (resultsTable) return false; // Already found

      const $el = $(el);
      if ($el.is("table") && isResultsTable($el)) {
        resultsTable = $el;
        return false; // Break
      }
    });

    // Approach 2: If nextAll didn't find it, look in the same container
    if (!resultsTable) {
      const container = raceHeading.closest("div, section, article");
      if (container.length) {
        let foundHeading = false;
        container.find("*").each((_, el) => {
          if (resultsTable) return false;
          
          // Check if we've reached the heading
          if (raceHeading.is(el) || raceHeading.find(el).length > 0) {
            foundHeading = true;
            return;
          }
          
          // If we've passed the heading, check for tables
          if (foundHeading && $(el).is("table")) {
            const $table = $(el);
            if (isResultsTable($table)) {
              resultsTable = $table;
              return false;
            }
          }
        });
      }
    }

    // Approach 3: Fallback - find first results table in document (less reliable)
    if (!resultsTable) {
      $("table").each((_, table) => {
        if (resultsTable) return false;
        const $table = $(table);
        if (isResultsTable($table)) {
          resultsTable = $table;
          return false;
        }
      });
    }

    if (!resultsTable || !resultsTable.length) {
      console.warn("[verify_race_full] HRN results table not found after race heading", {
        raceNo: requestedRaceNo,
        track,
      });
      return outcome;
    }

    // Step 3: Extract horse names from the results table
    // Find column indices
    const $resultsTable = $(resultsTable);
    const headerRow = $resultsTable.find("tr").first();
    const headerCells = headerRow.find("th, td").toArray();
    const headerTexts = headerCells.map((cell) =>
      $(cell).text().toLowerCase().trim()
    );

    // Find Fin/Position column
    let finIdx = headerTexts.findIndex((h) => 
      h.includes("fin") || h === "fin" || h === "#" || h === "pos" || h === "position"
    );
    if (finIdx === -1) finIdx = 0; // Default to first column

    // Find Horse/Runner column
    let horseIdx = headerTexts.findIndex((h) => 
      (h.includes("horse") || h.includes("runner") || h.includes("pgm")) &&
      !h.includes("jockey") && !h.includes("trainer")
    );
    if (horseIdx === -1) {
      // Try second column if first is position
      if (headerTexts.length > 1 && finIdx === 0) {
        horseIdx = 1;
      } else {
        horseIdx = finIdx + 1;
      }
    }

    // Extract first three finishers (Win, Place, Show)
    const rows = [];
    $resultsTable.find("tr").slice(1).each((_, row) => { // Skip header row
      const $row = $(row);
      const cells = $row.find("td, th").toArray();
      if (cells.length === 0) return;

      // Get fin position
      let finText = "";
      if (finIdx >= 0 && finIdx < cells.length) {
        finText = $(cells[finIdx]).text().trim();
      }

      // Get horse name
      let horseText = "";
      if (horseIdx >= 0 && horseIdx < cells.length) {
        const $cell = $(cells[horseIdx]);
        // Prefer link text (horse names are often in links)
        horseText = $cell.find("a").first().text().trim() || $cell.text().trim();
      }

      if (!finText || !horseText) return;

      // Skip header rows
      const finLower = finText.toLowerCase();
      const horseLower = horseText.toLowerCase();
      if (finLower === "fin" || finLower === "#" || horseLower === "horse" || horseLower === "runner") {
        return;
      }

      // Extract position number
      const finMatch = finText.match(/^(\d+)/);
      if (!finMatch) return;
      const fin = finMatch[1];

      // Clean horse name: remove program numbers, payouts, jockey names, speed figs
      let horse = horseText.replace(/\s+/g, " ").trim();
      // Remove leading numbers (program numbers)
      horse = horse.replace(/^\d+\s*/, "").trim();
      // Remove currency and payouts
      horse = horse.replace(/\$\d+\.\d+/g, "").replace(/\d+\.\d+/g, "").trim();
      // Remove speed figs: (131*), (97*), etc. - but keep the horse name
      horse = horse.replace(/\s*\(\d+\*?\)\s*$/g, "").trim();
      // Remove jockey names in parentheses (but not speed figs which we already removed)
      horse = horse.replace(/\s*\([^)]*\)\s*$/, "").trim();
      // Remove jockey patterns
      horse = horse.replace(/\s+[A-Z]\.\s+[A-Z][a-z]+\s*$/, "").trim();
      // Remove trailing numbers
      horse = horse.replace(/\s+\d+\.?\d*\s*$/, "").trim();
      // Remove $ or pure numbers/decimals at start
      horse = horse.replace(/^\$?\d+(\.\d+)?\s*/, "").trim();
      // Remove trailing asterisks (speed fig markers)
      horse = horse.replace(/\*+$/, "").trim();
      // Reject if contains stats/picks text
      if (/picks|stats|winning|percent|payout/i.test(horse)) {
        return;
      }

      // Validate before adding
      if (fin && horse && looksLikeHorseName(horse)) {
        rows.push({ fin, horse });
      }
    });

    // Get first three finishers - allow partial outcomes
    const winRow = rows.find((r) => r.fin === "1");
    const placeRow = rows.find((r) => r.fin === "2");
    const showRow = rows.find((r) => r.fin === "3");

    // Validate and set outcome - allow partial outcomes (at least Win is enough)
    if (winRow) {
      outcome.win = looksLikeHorseName(winRow.horse) ? winRow.horse.trim() : "";
    }
    if (placeRow) {
      outcome.place = looksLikeHorseName(placeRow.horse) ? placeRow.horse.trim() : "";
    }
    if (showRow) {
      outcome.show = looksLikeHorseName(showRow.horse) ? showRow.horse.trim() : "";
    }

    // Return outcome even if partial (at least one valid position)
    return outcome;
  } catch (error) {
    console.error("[verify_race_full] parseHRNRaceOutcome failed", {
      error: error?.message || String(error),
      stack: error?.stack,
      raceNo: requestedRaceNo,
      track,
    });
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
      // Extract track from URL if possible for better matching
      const trackMatch = url.match(/\/([^\/]+)\/\d{4}-\d{2}-\d{2}/);
      const trackFromUrl = trackMatch ? trackMatch[1].replace(/-/g, " ") : "";
      const hrnOutcome = parseHRNRaceOutcome($, String(raceNo), trackFromUrl);
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
    const hrnOutcome = parseHRNRaceOutcome($, context.raceNo, context.track);
    
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

/**
 * Score a CSE result for relevance
 * @param {Object} result - { title, link, snippet }
 * @param {string} targetDate - ISO date (YYYY-MM-DD)
 * @param {string} targetRaceNo - Race number
 * @param {string} targetTrack - Track name
 * @returns {number} Score (higher = better)
 */
function scoreCSEResult(result, targetDate, targetRaceNo, targetTrack) {
  let score = 0;
  const url = (result.link || "").toLowerCase();
  const title = (result.title || "").toLowerCase();
  const snippet = (result.snippet || "").toLowerCase();
  
  // Normalize host
  const isEquibase = url.includes("equibase.com");
  const isHRN = url.includes("horseracingnation.com") || url.includes("entries.horseracingnation.com");
  
  // Host scoring (updated per requirements)
  if (isEquibase) {
    score += 400; // Equibase direct result/chart URLs
    if (url.includes("chart") || url.includes("result")) score += 50;
  } else if (isHRN) {
    score += 300; // HRN entries-results pages (updated from 200)
    if (url.includes("/entries-results/") || url.includes("/entries/")) score += 50;
  }
  
  // Penalize homepages
  if (url.match(/equibase\.com\/?$/) || url.match(/horseracingnation\.com\/?$/)) {
    score -= 300;
  }
  
  // Race number matching
  if (targetRaceNo) {
    const raceNoStr = String(targetRaceNo).trim();
    const racePattern = new RegExp(`race\\s*#?\\s*${raceNoStr}\\b`, "i");
    if (racePattern.test(url) || racePattern.test(title)) {
      score += 50;
    }
  }
  
  // Date matching - use formatDateVariants for consistent date formats
  if (targetDate) {
    const dateVariants = formatDateVariants(targetDate);
    const allVariants = [
      dateVariants.iso,                    // 2025-11-22
      dateVariants.iso.replace(/-/g, ""),  // 20251122
      dateVariants.usNumeric,              // 11/22/2025
      dateVariants.humanShort.toLowerCase(), // nov 22 2025
      dateVariants.humanShort.toLowerCase().replace(/(\d+) (\d+) (\d+)/, "$1 $2, $3"), // nov 22, 2025
    ];
    
    // Check if URL/title/snippet contains any variant of the target date
    const hasDate = allVariants.some((variant) => 
      url.includes(variant.toLowerCase()) || 
      title.includes(variant.toLowerCase()) ||
      snippet.includes(variant.toLowerCase())
    );
    
    if (hasDate) {
      score += 70; // Strong boost for date match
    } else {
      // Penalize results that contain a different date (YYYY-MM-DD pattern in URL)
      const datePattern = /\/(\d{4}-\d{2}-\d{2})\//;
      const urlDateMatch = url.match(datePattern);
      if (urlDateMatch && urlDateMatch[1] !== dateVariants.iso) {
        score -= 50; // Penalize different date
      }
    }
  }
  
  // Track name matching
  if (targetTrack) {
    const trackLower = targetTrack.toLowerCase().replace(/[^a-z0-9]/g, "");
    const trackPattern = new RegExp(trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (trackPattern.test(url) || trackPattern.test(title)) {
      score += 40;
    }
  }
  
  // Penalize picks/tips/stats/news pages (updated per requirements)
  if (/power\s*picks?|picks?\s*(are|is)\s+winning|handicap|tips|stats|news/i.test(url) ||
      /power\s*picks?|picks?\s*(are|is)\s+winning|handicap|tips|stats|news/i.test(title)) {
    score -= 200; // Updated from -150
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
  const scoredResults = allResults.map((r) => ({
    ...r,
    score: scoreCSEResult(r, date, raceNo, track),
  }));
  
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
  
  function todayISO() {
    const now = new Date();
    const y = now.getFullYear();
    let m = String(now.getMonth() + 1);
    let d = String(now.getDate());
    if (m.length === 1) m = "0" + m;
    if (d.length === 1) d = "0" + d;
    return `${y}-${m}-${d}`;
  }
  
  // Treat context.date as the source of truth
  const targetDateIso = ensureIsoDate(context.date) || todayISO();
  
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

  try {
    if (!safeTrack || !safeDate) {
      return {
        ...defaultResponse,
        step: "verify_race_full_validation",
        error: "Missing required fields: track and date",
        summary: "Full verify race requires track and date.",
      };
    }

    // CSE SEARCH FIRST: Find Equibase and HRN links
    const searchResult = await searchRaceLinks(req, safeTrack, safeDate, safeRaceNo);
    const { query: cseQuery, orderedCandidates, bestOverall, googleUrl } = searchResult;

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

    // Helper to count valid positions in outcome
    const countValidPositions = (outcome) => {
      let count = 0;
      if (outcome.win && outcome.win.trim()) count++;
      if (outcome.place && outcome.place.trim()) count++;
      if (outcome.show && outcome.show.trim()) count++;
      return count;
    };

    // Try candidates in order until one succeeds
    let bestResult = null;
    let bestPositionCount = 0;

    for (const candidate of orderedCandidates) {
      if (!candidate || !candidate.link) continue;

      try {
        let parseResult = null;
        const link = candidate.link.toLowerCase();

        // Detect host and run correct parser
        if (link.includes("equibase.com")) {
          parseResult = await parseEquibaseOutcomeFromUrl(candidate.link, {
            track: safeTrack,
            date: safeDate,
            raceNo: safeRaceNo,
          });
        } else if (link.includes("horseracingnation.com") || link.includes("entries.horseracingnation.com")) {
          parseResult = await parseHRNOutcomeFromUrl(candidate.link, {
            track: safeTrack,
            date: safeDate,
            raceNo: safeRaceNo,
          });
        }

        if (parseResult && hasAnyOutcomePosition(parseResult)) {
          const positionCount = countValidPositions(parseResult);
          
          // If we get all 3 positions, stop immediately (preferred result)
          if (positionCount === 3) {
            bestResult = {
              outcome: {
                win: parseResult.win || "",
                place: parseResult.place || "",
                show: parseResult.show || "",
              },
              source: parseResult.source || candidate.source,
              link: parseResult.link || candidate.link,
              title: parseResult.title || candidate.title,
            };
            break; // Stop immediately - we have the best result
          }

          // Otherwise, keep track of the best partial result
          if (positionCount > bestPositionCount) {
            bestPositionCount = positionCount;
            bestResult = {
              outcome: {
                win: parseResult.win || "",
                place: parseResult.place || "",
                show: parseResult.show || "",
              },
              source: parseResult.source || candidate.source,
              link: parseResult.link || candidate.link,
              title: parseResult.title || candidate.title,
            };
          }
        }
      } catch (error) {
        console.error("[verify_race] Parse failed for candidate", {
          link: candidate.link,
          error: error?.message || String(error),
        });
        // Continue to next candidate
      }
    }

    // If we found a valid result, return it
    if (bestResult) {
      const outcome = bestResult.outcome;
      const predictedSafe = {
        win: (predicted?.win || "").trim(),
        place: (predicted?.place || "").trim(),
        show: (predicted?.show || "").trim(),
      };

      const hits = computeHits(outcome, predictedSafe);

      // Build summary
      const summaryLines = [];
      summaryLines.push(`Using date: ${safeDate}`);
      summaryLines.push(`Step: verify_race`);
      summaryLines.push(`Query: ${cseQuery}`);
      summaryLines.push(`Top Result: ${bestResult.title || "Chart"} -> ${bestResult.link}`);
      summaryLines.push(`Source: ${bestResult.source}`);

      const outcomeParts = [
        outcome.win || "-",
        outcome.place || "-",
        outcome.show || "-",
      ];
      summaryLines.push(`Outcome: ${outcomeParts.join(" / ")}`);

      const predictedParts = [
        predictedSafe.win || "-",
        predictedSafe.place || "-",
        predictedSafe.show || "-",
      ];
      summaryLines.push(`Predicted: ${predictedParts.join(" / ")}`);

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
        query: cseQuery,
        top: {
          title: bestResult.title || "Chart",
          link: bestResult.link,
        },
        outcome,
        predicted: predictedSafe,
        hits,
        summary,
        debug: {
          source: bestResult.source,
          googleUrl,
        },
      };
    }

    // Both Equibase and HRN failed - return fallback
    const bestLink = bestOverall?.link || null;
    const bestTitle = bestOverall?.title || "Google search";
    
    const predictedSafe = {
      win: (predicted?.win || "").trim(),
      place: (predicted?.place || "").trim(),
      show: (predicted?.show || "").trim(),
    };

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
      summary: `Using date: ${safeDate}\nStep: verify_race_full_fallback\nQuery: ${cseQuery}\nTop Result: ${bestLink ? `${bestTitle} -> ${bestLink}` : `Google search -> ${googleUrl}`}\nOutcome: (none)\nPredicted: ${predictedSafe.win || "-"} / ${predictedSafe.place || "-"} / ${predictedSafe.show || "-"}\nHits: (none)\nParser note: Full parser attempted Equibase and HRN but could not find valid Win/Place/Show horses. Falling back to Google-only stub.`,
      debug: {
        googleUrl,
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

