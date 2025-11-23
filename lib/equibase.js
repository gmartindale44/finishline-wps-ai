// lib/equibase.js
// Equibase chart fetching and parsing utilities

import * as cheerio from "cheerio";

/**
 * Check if text looks like a valid horse name
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeHorseName(text) {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  if (t.length > 40) return false; // too long => probably junk
  if (/SCRIPT/i.test(t) || /HEAD TAGS/i.test(t) || /PUBFIG/i.test(t)) return false;
  if (/https?:\/\//i.test(t)) return false;
  if (/^[A-Z]\s*,\s*[a-z]/i.test(t)) return false; // Patterns like "A, splice" are JS code
  if (/function|prototype|call:|splice|push|pop|=>/i.test(t)) return false;
  if (/[{}()=>]/.test(t)) return false; // No JS code patterns
  if (/^\d+$/.test(t)) return false; // Pure numbers are not horse names
  return true;
}

/**
 * Map track name to Equibase track code
 * @param {string} trackName
 * @returns {string | null}
 */
export function getEquibaseTrackCode(trackName) {
  if (!trackName) return null;

  const normalized = String(trackName).trim();
  if (!normalized) return null;

  // Track name -> Equibase code mapping
  // Extend this as needed
  const trackMap = {
    "Finger Lakes": "FL",
    "Finger Lakes Gaming & Racetrack": "FL",
    "Churchill Downs": "CD",
    "Aqueduct": "AQU",
    "Aqueduct Racetrack": "AQU",
    "Belmont Park": "BEL",
    "Saratoga": "SAR",
    "Saratoga Race Course": "SAR",
    "Del Mar": "DMR",
    "Del Mar Thoroughbred Club": "DMR",
    "Santa Anita Park": "SA",
    "Gulfstream Park": "GP",
    "Keeneland": "KEE",
    "Keeneland Racecourse": "KEE",
    "Pimlico": "PIM",
    "Pimlico Race Course": "PIM",
    "Monmouth Park": "MTH",
    "Woodbine": "WO",
    "Woodbine Racetrack": "WO",
    "Mahoning Valley": "MVR",
    "Mahoning Valley Race Course": "MVR",
    "Thistledown": "TDN",
    "Laurel Park": "LRL",
    "Parx Racing": "PRX",
    "Penn National": "PEN",
    "Mountaineer": "MNR",
    "Mountaineer Park": "MNR",
    "Charles Town": "CT",
    "Charles Town Races": "CT",
    "Tampa Bay Downs": "TAM",
    "Oaklawn Park": "OP",
    "Fair Grounds": "FG",
    "Golden Gate Fields": "GG",
    "Turf Paradise": "TP",
    "Remington Park": "RP",
    "Sam Houston Race Park": "HOU",
    "Lone Star Park": "LS",
    "Emerald Downs": "EMD",
    "Canterbury Park": "CBY",
    "Prairie Meadows": "PM",
    "Evangeline Downs": "EVD",
    "Delta Downs": "DD",
    "Louisiana Downs": "LAD",
    "Sunland Park": "SUN",
    "Zia Park": "ZIA",
    "Ruidoso Downs": "RUI",
    "Will Rogers Downs": "WRD",
    "Colonial Downs": "COL",
    "Kentucky Downs": "KD",
    "Ellis Park": "EP",
    "Belterra Park": "BEL",
    "Horseshoe Indianapolis": "IND",
    "Indiana Grand": "IND",
    "Hawthorne Race Course": "HAW",
    "Arlington International Racecourse": "AP",
    "Arlington Park (closed)": "AP",
    "Fonner Park": "FP",
    "Arapahoe Park": "ARP",
    "Assiniboia Downs": "ASD",
    "Fort Erie Racetrack": "FE",
    "Northfield Park": "NFD",
    "Buffalo Raceway": "BUF",
    "Yavapai Downs": "YAV",
    "Umatilla County Fair Track": "UMT",
    "El Paso Downs": "EPD",
    "Los Alamitos (TB)": "LRC",
    "Los Alamitos Race Course": "LRC",
    "Pleasanton": "PLE",
  };

  // Direct lookup (case-insensitive)
  const lower = normalized.toLowerCase();
  for (const [key, code] of Object.entries(trackMap)) {
    if (key.toLowerCase() === lower) {
      return code;
    }
  }

  // Partial match fallback (e.g., "Finger Lakes Gaming" -> "FL")
  for (const [key, code] of Object.entries(trackMap)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return code;
    }
  }

  return null;
}

/**
 * Convert ISO date (YYYY-MM-DD) to MM/DD/YYYY for Equibase
 * @param {string} dateISO
 * @returns {string}
 */
function dateISOToEquibase(dateISO) {
  if (!dateISO) return "";
  const parts = String(dateISO).trim().split("-");
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  return `${month}/${day}/${year}`;
}

/**
 * Build Equibase chart URL from track, date, and race number
 * @param {{ track: string; date: string (YYYY-MM-DD); raceNo: string | number }} opts
 * @returns {string | null} Equibase chart URL or null if track/date/race cannot be encoded
 */
export function buildEquibaseChartUrl({ track, date, raceNo }) {
  try {
    const code = getEquibaseTrackCode(track);
    if (!code) {
      return null;
    }

    const raceDate = dateISOToEquibase(date);
    if (!raceDate) {
      return null;
    }

    const raceNoStr = String(raceNo || "").trim();
    if (!raceNoStr) {
      return null;
    }

    const url = `https://www.equibase.com/premium/chartEmb.cfm?track=${code}&raceDate=${raceDate}&raceNo=${raceNoStr}&cy=USA`;
    return url;
  } catch (err) {
    console.error("[equibase] buildEquibaseChartUrl error", err);
    return null;
  }
}

/**
 * Fetch Equibase chart HTML from a URL
 * @param {string} url - Equibase chart URL
 * @returns {Promise<string | null>} HTML content or null on error
 */
export async function fetchEquibaseChartHtml(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  try {
    // Use AbortController for timeout (AbortSignal.timeout may not be available in all Node versions)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error(`[equibase] fetchEquibaseChartHtml failed: HTTP ${res.status} ${res.statusText}`);
      return null;
    }

    return await res.text();
  } catch (err) {
    console.error("[equibase] fetchEquibaseChartHtml error", {
      url,
      error: err?.message || String(err),
    });
    return null;
  }
}

/**
 * Parse Equibase chart HTML to extract Win/Place/Show horses
 * @param {string} html
 * @returns {{ win: string; place: string; show: string } | null} Outcome object with all three positions, or null if parsing fails
 */
export function parseEquibaseOutcome(html) {
  if (!html || typeof html !== "string") {
    return null;
  }

  const outcome = { win: "", place: "", show: "" };

  try {
    const $ = cheerio.load(html);

    // Remove all script and style tags before parsing
    $("script, style").remove();

    // Find the race result table
    // Look for a table with headers containing "Fin" and "Horse" or "Horse Name"
    let resultTable = null;

    $("table").each((_, el) => {
      const $table = $(el);
      const headerRow = $table.find("tr").first();
      const headers = headerRow
        .find("th, td")
        .map((_, th) => $(th).text().trim().toLowerCase())
        .get();

      const hasFin = headers.some((h) => h.includes("fin"));
      const hasHorse = headers.some((h) => h.includes("horse"));

      if (hasFin && hasHorse && !resultTable) {
        resultTable = $table;
      }
    });

    if (!resultTable) {
      throw new Error("Equibase result table not found");
    }

    // Find column indices
    const headerRow = resultTable.find("tr").first();
    const headerCells = headerRow.find("th, td").toArray();
    const headerTexts = headerCells.map((cell) =>
      $(cell).text().trim().toLowerCase()
    );

    let finIdx = headerTexts.findIndex(
      (h) => h.includes("fin") || h === "fin" || h === "#"
    );
    let horseIdx = headerTexts.findIndex(
      (h) =>
        h.includes("horse") ||
        h.includes("horse name") ||
        h.includes("program") ||
        h.includes("pgm")
    );

    // If horseIdx not found, try second column as fallback
    if (horseIdx === -1 && headerTexts.length > 1) {
      // Often horse name is in second column
      const secondCol = headerTexts[1];
      if (secondCol && !secondCol.match(/^\d+$/)) {
        // Not a pure number, likely horse name
        horseIdx = 1;
      }
    }

    // If finIdx not found, try first column
    if (finIdx === -1 && headerTexts.length > 0) {
      finIdx = 0;
    }

    if (finIdx === -1) {
      throw new Error("Equibase table missing Fin column");
    }
    if (horseIdx === -1) {
      throw new Error("Equibase table missing Horse column");
    }

    // Collect rows with Fin and Horse
    const rows = [];
    resultTable.find("tr").each((_, row) => {
      const $row = $(row);
      const cells = $row.find("td, th").toArray();

      if (cells.length === 0) return;

      // Try to find Fin and Horse columns dynamically if indices are -1
      let finText = "";
      let horseText = "";

      if (finIdx >= 0 && finIdx < cells.length) {
        finText = $(cells[finIdx]).text().trim();
      } else if (cells.length > 0) {
        // Try first column
        finText = $(cells[0]).text().trim();
      }

      if (horseIdx >= 0 && horseIdx < cells.length) {
        horseText = $(cells[horseIdx]).text().trim();
      } else if (cells.length > 1) {
        // Try second column
        horseText = $(cells[1]).text().trim();
      }

      // Skip header rows or empty rows
      if (!finText || !horseText) return;
      const finLower = finText.toLowerCase();
      const horseLower = horseText.toLowerCase();
      if (
        finLower === "fin" ||
        finLower === "#" ||
        horseLower === "horse" ||
        horseLower === "program" ||
        horseLower === "pgm" ||
        horseLower === "horse name"
      ) {
        return;
      }

      // Normalize Fin: strip whitespace, extract number
      const finMatch = finText.match(/^(\d+)/);
      if (!finMatch) return;

      const fin = finMatch[1];
      // Clean horse name: remove program numbers, extra spaces, jockey names, payouts
      let horse = horseText.replace(/\s+/g, " ").trim();
      // Remove leading numbers (program numbers)
      horse = horse.replace(/^\d+\s*/, "").trim();
      // Remove currency symbols and payout amounts (e.g., "$12.40", "12.40")
      horse = horse.replace(/\$\d+\.\d+/g, "").replace(/\d+\.\d+/g, "").trim();
      // Remove jockey names (pattern: "Horse Name" or "Horse Name (Jockey)" or "Horse Name Jockey")
      // Jockey names often appear after the horse name, sometimes in parentheses
      horse = horse.replace(/\s*\([^)]*\)\s*$/, "").trim();
      // Remove common jockey patterns (e.g., "A. Maldonado", "J. Smith")
      horse = horse.replace(/\s+[A-Z]\.\s+[A-Z][a-z]+\s*$/, "").trim();
      // Remove any remaining numbers at the end
      horse = horse.replace(/\s+\d+\.?\d*\s*$/, "").trim();

      // Validate horse name before adding
      if (fin && horse && looksLikeHorseName(horse)) {
        rows.push({ fin, horse });
      }
    });

    // Find Fin 1, 2, 3
    const winRow = rows.find((r) => r.fin === "1");
    const placeRow = rows.find((r) => r.fin === "2");
    const showRow = rows.find((r) => r.fin === "3");

    if (!winRow || !placeRow || !showRow) {
      const missing = [];
      if (!winRow) missing.push("Fin 1");
      if (!placeRow) missing.push("Fin 2");
      if (!showRow) missing.push("Fin 3");
      throw new Error(`Missing ${missing.join("/")} rows in Equibase table`);
    }

    // Validate and set outcome
    outcome.win = looksLikeHorseName(winRow.horse) ? winRow.horse.trim() : "";
    outcome.place = looksLikeHorseName(placeRow.horse) ? placeRow.horse.trim() : "";
    outcome.show = looksLikeHorseName(showRow.horse) ? showRow.horse.trim() : "";

    // Only return non-null if all three positions are valid
    if (outcome.win && outcome.place && outcome.show) {
      return outcome;
    }

    return null;
  } catch (error) {
    console.error("[equibase] parseEquibaseOutcome failed", {
      error: error?.message || String(error),
      stack: error?.stack,
    });
    // Return null on parse failure
    return null;
  }
}

/**
 * High-level helper: resolve Equibase outcome from context
 * Builds URL, fetches HTML, and parses outcome
 * @param {{ track: string; date: string (YYYY-MM-DD); raceNo: string | number }} context
 * @returns {Promise<{ url: string; outcome: { win: string; place: string; show: string } } | null>}
 *   Returns { url, outcome } on success, or null if anything fails
 */
export async function resolveEquibaseOutcome(context) {
  try {
    const { track, date, raceNo } = context || {};
    
    if (!track || !date || !raceNo) {
      return null;
    }

    const url = buildEquibaseChartUrl({ track, date, raceNo });
    if (!url) {
      return null;
    }

    const html = await fetchEquibaseChartHtml(url);
    if (!html) {
      return null;
    }

    const outcome = parseEquibaseOutcome(html);
    if (!outcome) {
      return null;
    }

    return { url, outcome };
  } catch (err) {
    console.error("[equibase] resolveEquibaseOutcome error", {
      context,
      error: err?.message || String(err),
    });
    return null;
  }
}

