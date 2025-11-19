// lib/equibase.js
// Equibase chart fetching and parsing utilities

import * as cheerio from "cheerio";

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
 * Fetch Equibase chart HTML
 * @param {{ track: string; dateISO: string; raceNo: string | number }} params
 * @returns {Promise<string>}
 */
export async function fetchEquibaseChartHtml({ track, dateISO, raceNo }) {
  const code = getEquibaseTrackCode(track);
  if (!code) {
    throw new Error(`Unknown Equibase track code for ${track}`);
  }

  const raceDate = dateISOToEquibase(dateISO);
  if (!raceDate) {
    throw new Error(`Invalid date format: ${dateISO} (expected YYYY-MM-DD)`);
  }

  const raceNoStr = String(raceNo || "").trim();
  if (!raceNoStr) {
    throw new Error(`Race number is required`);
  }

  const url = `https://www.equibase.com/premium/chartEmb.cfm?track=${code}&raceDate=${raceDate}&raceNo=${raceNoStr}&cy=USA`;

  console.log("[equibase] track", track, "code", code, "date", dateISO, "raceNo", raceNoStr, "url", url);

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
    throw new Error(`Equibase fetch failed: HTTP ${res.status} ${res.statusText}`);
  }

  return await res.text();
}

/**
 * Parse Equibase chart HTML to extract Win/Place/Show horses
 * @param {string} html
 * @returns {{ win: string; place: string; show: string }}
 */
export function parseEquibaseOutcome(html) {
  const outcome = { win: "", place: "", show: "" };

  if (!html) return outcome;

  try {
    const $ = cheerio.load(html);

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
      // Clean horse name: remove program numbers, extra spaces
      let horse = horseText.replace(/\s+/g, " ").trim();
      // Remove leading numbers (program numbers)
      horse = horse.replace(/^\d+\s*/, "").trim();

      if (fin && horse && horse.length > 0) {
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

    outcome.win = winRow.horse;
    outcome.place = placeRow.horse;
    outcome.show = showRow.horse;

    return outcome;
  } catch (error) {
    console.error("[equibase] parseEquibaseOutcome failed", {
      error: error?.message || String(error),
      stack: error?.stack,
    });
    // Return empty outcome on parse failure
    return outcome;
  }
}

