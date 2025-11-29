import fs from "node:fs";
import path from "node:path";
import { loadCalibrationThresholds } from "../lib/calibrationThresholds.js";

const CSV_PATH = path.join(process.cwd(), "data", "finishline_tests_v1.csv");
const OUTPUT_PATH = path.join(
  process.cwd(),
  "data",
  "shadow_calibration_report_v1.md"
);
const JSON_OUTPUT_PATH = path.join(
  process.cwd(),
  "data",
  "shadow_snapshot_v1.json"
);

const LEGACY_HEADERS = [
  "Test_ID",
  "Track",
  "Race_No",
  "Surface",
  "Distance",
  "Confidence",
  "Top_3_Mass",
  "AI_Picks",
  "Strategy",
  "Result",
  "ROI_Percent",
  "WinRate",
  "Notes",
];

/**
 * Parse a CSV line handling quoted fields
 */
function parseCsvLine(line, expectedSize) {
  const result = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  while (result.length < expectedSize) result.push("");
  return result.map((cell) => cell.trim());
}

/**
 * Load and parse the CSV file
 */
function loadCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `CSV not found at ${CSV_PATH}. Please ensure data/finishline_tests_v1.csv exists.`
    );
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8").replace(/\r\n/g, "\n");
  const lines = raw.trim().split("\n");

  if (lines.length === 0) {
    throw new Error("CSV file is empty");
  }

  const headerLine = lines[0];
  const header = headerLine ? headerLine.split(",").map((h) => h.trim()) : [];

  // Only process rows that match the legacy schema
  const legacyHeaderStr = LEGACY_HEADERS.join(",");
  const actualHeaderStr = header.join(",");

  if (actualHeaderStr !== legacyHeaderStr) {
    console.warn(
      `[shadow-calibration] Header mismatch. Expected legacy schema, but found different headers.`
    );
    console.warn(`[shadow-calibration] Will attempt to process rows that match legacy format.`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = parseCsvLine(line, LEGACY_HEADERS.length);
    const row = {};
    LEGACY_HEADERS.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });

    // Only include rows that have the legacy structure (have Test_ID and Confidence)
    if (row.Test_ID && row.Confidence) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Normalize confidence to 0-1 range
 */
function normalizeConfidence(conf) {
  if (!conf || conf === "") return null;
  const num = Number(conf);
  if (!Number.isFinite(num)) return null;
  // If confidence is > 1, assume it's 0-100 scale, convert to 0-1
  if (num > 1) return num / 100;
  return num;
}

/**
 * Parse ROI percentage value (handles "+42", "-100", etc.)
 */
function parseROI(roiStr) {
  if (!roiStr || roiStr === "") return null;
  const cleaned = String(roiStr).replace(/[^0-9+\-.]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Determine if a row would be allowed for a given leg (shadow decision)
 */
function wouldAllowLeg(row, leg, thresholds) {
  const conf = normalizeConfidence(row.Confidence);
  if (conf === null) return false;

  const legThresholds = thresholds[leg];
  if (!legThresholds) return false;

  // Check confidence threshold
  if (conf < legThresholds.minConfidence) return false;

  // Check field size if available (not in current CSV, so skip)
  // fieldSize would be checked here if present: (fieldSize <= legThresholds.maxFieldSize || fieldSize === null)

  return true;
}

/**
 * Determine hit status for each leg based on WinRate
 */
function getHitStatus(row) {
  const winRate = (row.WinRate || "").trim();
  
  // Skip rows without valid outcome
  if (!winRate || winRate === "Pending" || winRate === "Live" || winRate === "Test") {
    return { winHit: null, placeHit: null, showHit: null };
  }

  const winHit = winRate === "Win";
  const placeHit = winRate === "Win" || winRate === "Place";
  const showHit = winRate === "Win" || winRate === "Place" || winRate === "Show";

  return { winHit, placeHit, showHit };
}

/**
 * Compute statistics for a leg
 */
function computeLegStats(rows, leg, thresholds) {
  const stats = {
    totalRows: 0,
    shadowYes: 0,
    shadowYesHits: 0,
    totalHits: 0,
    shadowYesROI: [],
    totalROI: [],
  };

  for (const row of rows) {
    const hitStatus = getHitStatus(row);
    // Access hit value based on leg: winHit, placeHit, or showHit
    let hitValue;
    if (leg === "win") hitValue = hitStatus.winHit;
    else if (leg === "place") hitValue = hitStatus.placeHit;
    else if (leg === "show") hitValue = hitStatus.showHit;
    else continue; // Unknown leg

    // Skip rows without valid outcome for this leg
    if (hitValue === null) continue;

    stats.totalRows += 1;
    if (hitValue) stats.totalHits += 1;

    // Check if shadow would allow this leg
    const allowed = wouldAllowLeg(row, leg, thresholds);
    if (allowed) {
      stats.shadowYes += 1;
      if (hitValue) stats.shadowYesHits += 1;

      // Collect ROI if available
      const roi = parseROI(row.ROI_Percent);
      if (roi !== null) {
        stats.shadowYesROI.push(roi);
      }
    }

    // Collect ROI for all rows (for baseline)
    const roi = parseROI(row.ROI_Percent);
    if (roi !== null) {
      stats.totalROI.push(roi);
    }
  }

  return stats;
}

/**
 * Format percentage
 */
function formatPercent(num, denom) {
  if (denom === 0) return "0%";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

/**
 * Format average
 */
function formatAvg(values) {
  if (values.length === 0) return "N/A";
  const sum = values.reduce((a, b) => a + b, 0);
  return `${(sum / values.length).toFixed(1)}%`;
}

/**
 * Calculate average ROI from array
 */
function calculateAvgROI(values) {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Number((sum / values.length).toFixed(3));
}

/**
 * Generate interpretation notes for a leg
 */
function generateNotes(stats, legName) {
  const notes = [];
  
  // Sample size assessment
  if (stats.shadowYes < 30) {
    notes.push("Sample size small, treat with caution");
  } else if (stats.shadowYes < 50) {
    notes.push("Sample size moderate");
  } else {
    notes.push("Sample size looks adequate");
  }
  
  // Hit rate improvement assessment
  const hitRateShadow = stats.shadowYes > 0 
    ? (stats.shadowYesHits / stats.shadowYes) * 100 
    : 0;
  const hitRateOverall = stats.totalRows > 0 
    ? (stats.totalHits / stats.totalRows) * 100 
    : 0;
  const delta = hitRateShadow - hitRateOverall;
  
  if (delta > 5) {
    notes.push(`Shadow YES improves hit-rate vs overall by ${delta.toFixed(1)}%`);
  } else if (delta < -5) {
    notes.push(`Shadow YES underperforms overall by ${Math.abs(delta).toFixed(1)}%`);
  } else {
    notes.push(`Shadow YES hit-rate similar to overall (${delta > 0 ? '+' : ''}${delta.toFixed(1)}%)`);
  }
  
  return notes.join(". ");
}

/**
 * Generate markdown report
 */
function generateReport(thresholds, winStats, placeStats, showStats) {
  const timestamp = new Date().toISOString();
  const strategy = thresholds.strategyName || "v1_shadow_only";
  const version = thresholds.version || 1;
  
  // Calculate total rows (use max across legs as they should be similar)
  const totalRows = Math.max(winStats.totalRows, placeStats.totalRows, showStats.totalRows);

  let report = `# Shadow Calibration Report (v1)

Generated: ${timestamp}

## Thresholds

- Strategy: ${strategy}
- Version: ${version}
- Win: minConf ${thresholds.win.minConfidence}, maxFieldSize ${thresholds.win.maxFieldSize}
- Place: minConf ${thresholds.place.minConfidence}, maxFieldSize ${thresholds.place.maxFieldSize}
- Show: minConf ${thresholds.show.minConfidence}, maxFieldSize ${thresholds.show.maxFieldSize}

## Global summary

- Total rows with outcome: ${totalRows}
- Legs: Win / Place / Show

## Win leg

- Total rows with outcome: ${winStats.totalRows}
- Shadow YES rows: ${winStats.shadowYes}
- Hit rate (shadow YES): ${formatPercent(winStats.shadowYesHits, winStats.shadowYes)} (${winStats.shadowYesHits} / ${winStats.shadowYes})
- Hit rate (overall): ${formatPercent(winStats.totalHits, winStats.totalRows)} (${winStats.totalHits} / ${winStats.totalRows})
`;

  if (winStats.shadowYesROI.length > 0) {
    report += `- Avg ROI (shadow YES): ${formatAvg(winStats.shadowYesROI)}
- Avg ROI (overall): ${formatAvg(winStats.totalROI)}
`;
  } else {
    report += `- Avg ROI: Not available in dataset
`;
  }
  
  report += `- Notes: ${generateNotes(winStats, "win")}

## Place leg

- Total rows with outcome: ${placeStats.totalRows}
- Shadow YES rows: ${placeStats.shadowYes}
- Hit rate (shadow YES): ${formatPercent(placeStats.shadowYesHits, placeStats.shadowYes)} (${placeStats.shadowYesHits} / ${placeStats.shadowYes})
- Hit rate (overall): ${formatPercent(placeStats.totalHits, placeStats.totalRows)} (${placeStats.totalHits} / ${placeStats.totalRows})
`;

  if (placeStats.shadowYesROI.length > 0) {
    report += `- Avg ROI (shadow YES): ${formatAvg(placeStats.shadowYesROI)}
- Avg ROI (overall): ${formatAvg(placeStats.totalROI)}
`;
  } else {
    report += `- Avg ROI: Not available in dataset
`;
  }
  
  report += `- Notes: ${generateNotes(placeStats, "place")}

## Show leg

- Total rows with outcome: ${showStats.totalRows}
- Shadow YES rows: ${showStats.shadowYes}
- Hit rate (shadow YES): ${formatPercent(showStats.shadowYesHits, showStats.shadowYes)} (${showStats.shadowYesHits} / ${showStats.shadowYes})
- Hit rate (overall): ${formatPercent(showStats.totalHits, showStats.totalRows)} (${showStats.totalHits} / ${showStats.totalRows})
`;

  if (showStats.shadowYesROI.length > 0) {
    report += `- Avg ROI (shadow YES): ${formatAvg(showStats.shadowYesROI)}
- Avg ROI (overall): ${formatAvg(showStats.totalROI)}
`;
  } else {
    report += `- Avg ROI: Not available in dataset
`;
  }
  
  report += `- Notes: ${generateNotes(showStats, "show")}
`;

  return report;
}

/**
 * Generate JSON snapshot
 */
function generateJsonSnapshot(thresholds, winStats, placeStats, showStats) {
  const timestamp = new Date().toISOString();
  const strategy = thresholds.strategyName || "v1_shadow_only";
  const version = thresholds.version || 1;
  
  const totalRows = Math.max(winStats.totalRows, placeStats.totalRows, showStats.totalRows);
  
  const snapshot = {
    strategyName: strategy,
    version: version,
    generatedAt: timestamp,
    rows: {
      total: totalRows
    },
    legs: {
      win: {
        rows: winStats.totalRows,
        shadow_yes: winStats.shadowYes,
        hits_shadow: winStats.shadowYesHits,
        hits_overall: winStats.totalHits,
        hit_rate_shadow: winStats.shadowYes > 0 
          ? Number(((winStats.shadowYesHits / winStats.shadowYes) * 100 / 100).toFixed(3))
          : 0,
        hit_rate_overall: winStats.totalRows > 0
          ? Number(((winStats.totalHits / winStats.totalRows) * 100 / 100).toFixed(3))
          : 0,
        roi_shadow: calculateAvgROI(winStats.shadowYesROI),
        roi_overall: calculateAvgROI(winStats.totalROI)
      },
      place: {
        rows: placeStats.totalRows,
        shadow_yes: placeStats.shadowYes,
        hits_shadow: placeStats.shadowYesHits,
        hits_overall: placeStats.totalHits,
        hit_rate_shadow: placeStats.shadowYes > 0
          ? Number(((placeStats.shadowYesHits / placeStats.shadowYes) * 100 / 100).toFixed(3))
          : 0,
        hit_rate_overall: placeStats.totalRows > 0
          ? Number(((placeStats.totalHits / placeStats.totalRows) * 100 / 100).toFixed(3))
          : 0,
        roi_shadow: calculateAvgROI(placeStats.shadowYesROI),
        roi_overall: calculateAvgROI(placeStats.totalROI)
      },
      show: {
        rows: showStats.totalRows,
        shadow_yes: showStats.shadowYes,
        hits_shadow: showStats.shadowYesHits,
        hits_overall: showStats.totalHits,
        hit_rate_shadow: showStats.shadowYes > 0
          ? Number(((showStats.shadowYesHits / showStats.shadowYes) * 100 / 100).toFixed(3))
          : 0,
        hit_rate_overall: showStats.totalRows > 0
          ? Number(((showStats.totalHits / showStats.totalRows) * 100 / 100).toFixed(3))
          : 0,
        roi_shadow: calculateAvgROI(showStats.shadowYesROI),
        roi_overall: calculateAvgROI(showStats.totalROI)
      }
    }
  };
  
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Main function
 */
function main() {
  try {
    // Force output to stdout/stderr
    process.stdout.write("[shadow-calibration] Loading calibration thresholds...\n");
    const thresholds = loadCalibrationThresholds();
    process.stdout.write(
      `[shadow-calibration] Loaded thresholds: ${thresholds.strategyName} v${thresholds.version}\n`
    );

    process.stdout.write("[shadow-calibration] Loading CSV data...\n");
    const rows = loadCsv();
    process.stdout.write(`[shadow-calibration] Loaded ${rows.length} rows from CSV\n`);

    process.stdout.write("[shadow-calibration] Computing statistics...\n");
    const winStats = computeLegStats(rows, "win", thresholds);
    const placeStats = computeLegStats(rows, "place", thresholds);
    const showStats = computeLegStats(rows, "show", thresholds);

    process.stdout.write("[shadow-calibration] Generating report...\n");
    const report = generateReport(thresholds, winStats, placeStats, showStats);
    const jsonSnapshot = generateJsonSnapshot(thresholds, winStats, placeStats, showStats);

    process.stdout.write(`[shadow-calibration] Writing report to ${OUTPUT_PATH}\n`);
    fs.writeFileSync(OUTPUT_PATH, report, "utf8");
    
    process.stdout.write(`[shadow-calibration] Writing JSON snapshot to ${JSON_OUTPUT_PATH}\n`);
    fs.writeFileSync(JSON_OUTPUT_PATH, jsonSnapshot, "utf8");

    process.stdout.write("[shadow-calibration] ✓ Report and snapshot generated successfully!\n");
    process.stdout.write(`[shadow-calibration] Output: ${OUTPUT_PATH}\n`);
    process.stdout.write(`[shadow-calibration] JSON: ${JSON_OUTPUT_PATH}\n`);
  } catch (err) {
    process.stderr.write(`[shadow-calibration] Fatal error: ${err?.message || err}\n`);
    if (err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
  }
}

main();

