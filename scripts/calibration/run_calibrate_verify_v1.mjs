#!/usr/bin/env node
/**
 * scripts/calibration/run_calibrate_verify_v1.mjs
 * 
 * Run v1 calibration on verify CSV data and generate reports.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "url";
import { computeVerifyMetricsV1 } from "../../lib/calibration/verify_metrics_v1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_PATH = path.join(__dirname, "../../data/finishline_tests_calibration_v1.csv");
const OUTPUT_DIR = path.join(__dirname, "../../data/calibration");
const JSON_OUTPUT = path.join(OUTPUT_DIR, "verify_v1_report.json");
const MD_OUTPUT = path.join(OUTPUT_DIR, "verify_v1_report.md");

/**
 * CSV parser that handles commas inside quoted values
 */
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((cell) => cell.trim());
}

/**
 * Load and parse CSV file
 */
async function loadCalibrationCsv(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error("CSV file is empty");
  }

  // Parse header
  const header = parseCsvLine(lines[0]);
  const fieldMap = {
    track: header.indexOf("track"),
    date: header.indexOf("date"),
    raceNo: header.indexOf("raceNo"),
    strategyName: header.indexOf("strategyName"),
    version: header.indexOf("version"),
    predWin: header.indexOf("predWin"),
    predPlace: header.indexOf("predPlace"),
    predShow: header.indexOf("predShow"),
    outWin: header.indexOf("outWin"),
    outPlace: header.indexOf("outPlace"),
    outShow: header.indexOf("outShow"),
    winHit: header.indexOf("winHit"),
    placeHit: header.indexOf("placeHit"),
    showHit: header.indexOf("showHit"),
    top3Hit: header.indexOf("top3Hit"),
    // Optional predmeta fields (indexOf returns -1 if not found, safe to use)
    confidence_pct: header.indexOf("confidence_pct"),
    t3m_pct: header.indexOf("t3m_pct"),
    top3_list: header.indexOf("top3_list"),
  };

  // Validate required fields (predmeta fields are optional)
  const requiredFields = ['track', 'date', 'raceNo', 'strategyName', 'version', 'predWin', 'predPlace', 'predShow', 'outWin', 'outPlace', 'outShow', 'winHit', 'placeHit', 'showHit', 'top3Hit'];
  for (const field of requiredFields) {
    if (fieldMap[field] === -1) {
      throw new Error(`Missing required field in CSV: ${field}`);
    }
  }

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const columns = parseCsvLine(line);
    if (columns.length < header.length) {
      continue; // Skip incomplete rows
    }

    // Helper to safely parse optional numeric field
    const parseOptionalNumber = (idx) => {
      if (idx === -1 || idx >= columns.length) return null;
      const val = columns[idx]?.trim();
      if (!val) return null;
      const num = Number(val);
      return Number.isFinite(num) ? num : null;
    };

    // Helper to safely parse optional JSON array field
    const parseOptionalArray = (idx) => {
      if (idx === -1 || idx >= columns.length) return null;
      const val = columns[idx]?.trim();
      if (!val) return null;
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    };

    rows.push({
      track: columns[fieldMap.track] || "",
      date: columns[fieldMap.date] || "",
      raceNo: columns[fieldMap.raceNo] || "",
      strategyName: columns[fieldMap.strategyName] || "",
      version: columns[fieldMap.version] || "",
      predWin: columns[fieldMap.predWin] || "",
      predPlace: columns[fieldMap.predPlace] || "",
      predShow: columns[fieldMap.predShow] || "",
      outWin: columns[fieldMap.outWin] || "",
      outPlace: columns[fieldMap.outPlace] || "",
      outShow: columns[fieldMap.outShow] || "",
      winHit: columns[fieldMap.winHit] || "false",
      placeHit: columns[fieldMap.placeHit] || "false",
      showHit: columns[fieldMap.showHit] || "false",
      top3Hit: columns[fieldMap.top3Hit] || "false",
      // Optional predmeta fields (null if column missing or invalid)
      confidence_pct: parseOptionalNumber(fieldMap.confidence_pct),
      t3m_pct: parseOptionalNumber(fieldMap.t3m_pct),
      top3_list: parseOptionalArray(fieldMap.top3_list),
    });
  }

  return rows;
}

/**
 * Format percentage for display
 */
function formatPercent(value, decimals = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(metrics) {
  const { meta, global, byTrack, byStrategy } = metrics;
  const generatedDate = new Date(meta.generatedAt).toLocaleString();

  let md = `# Verify V1 Calibration Report\n\n`;
  md += `**Generated:** ${generatedDate}\n`;
  md += `**Source:** ${meta.source}\n`;
  md += `**Total Rows:** ${meta.totalRows.toLocaleString()}\n`;
  md += `**Filtered Rows:** ${meta.filteredRows.toLocaleString()}\n\n`;

  // Global metrics table
  md += `## Global Metrics\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Races | ${global.races.toLocaleString()} |\n`;
  md += `| Win Hit Rate | ${formatPercent(global.winHitRate)} |\n`;
  md += `| Place Hit Rate | ${formatPercent(global.placeHitRate)} |\n`;
  md += `| Show Hit Rate | ${formatPercent(global.showHitRate)} |\n`;
  md += `| Top 3 Hit Rate | ${formatPercent(global.top3HitRate)} |\n`;
  md += `| Any Hit Rate | ${formatPercent(global.anyHitRate)} |\n`;
  md += `| Exact Trifecta Rate | ${formatPercent(global.exactTrifectaRate)} |\n`;
  md += `| Partial Order Top 3 Rate | ${formatPercent(global.partialOrderTop3Rate)} |\n\n`;

  // Predmeta metrics section (if coverage > 0)
  const { predmeta } = metrics;
  if (predmeta && predmeta.coverage && predmeta.coverage.coverageRate > 0) {
    md += `## Predmeta Metrics\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Predmeta Coverage | ${formatPercent(predmeta.coverage.coverageRate)} |\n`;
    md += `| Rows with Confidence | ${predmeta.coverage.rowsWithConfidence.toLocaleString()} |\n`;
    md += `| Rows with T3M | ${predmeta.coverage.rowsWithT3m.toLocaleString()} |\n`;
    md += `| Rows with Both | ${predmeta.coverage.rowsWithBoth.toLocaleString()} |\n\n`;

    // Accuracy by confidence bucket
    const confBuckets = Object.entries(predmeta.accuracyByConfidenceBucket || {});
    if (confBuckets.length > 0) {
      md += `### Accuracy by Confidence Bucket\n\n`;
      md += `| Confidence | Races | Win Hit Rate | Top 3 Hit Rate |\n`;
      md += `|------------|-------|--------------|----------------|\n`;
      for (const [bucket, stats] of confBuckets.sort((a, b) => {
        const aMin = parseInt(a[0].split('-')[0] || a[0].replace('+', ''));
        const bMin = parseInt(b[0].split('-')[0] || b[0].replace('+', ''));
        return aMin - bMin;
      })) {
        md += `| ${bucket}% | ${stats.races.toLocaleString()} | ${formatPercent(stats.winHitRate)} | ${formatPercent(stats.top3HitRate)} |\n`;
      }
      md += `\n`;
    }

    // Accuracy by T3M bucket
    const t3mBuckets = Object.entries(predmeta.accuracyByT3mBucket || {});
    if (t3mBuckets.length > 0) {
      md += `### Accuracy by T3M Bucket\n\n`;
      md += `| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |\n`;
      md += `|-------|-------|--------------|----------------|\n`;
      for (const [bucket, stats] of t3mBuckets.sort((a, b) => {
        const aMin = parseInt(a[0].split('-')[0] || a[0].replace('+', ''));
        const bMin = parseInt(b[0].split('-')[0] || b[0].replace('+', ''));
        return aMin - bMin;
      })) {
        md += `| ${bucket}% | ${stats.races.toLocaleString()} | ${formatPercent(stats.winHitRate)} | ${formatPercent(stats.top3HitRate)} |\n`;
      }
      md += `\n`;
    }
    
    // Brier Score
    if (predmeta.brierScore && predmeta.brierScore.brierScore != null) {
      md += `### Brier Score (Win Probability Calibration)\n\n`;
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      md += `| Brier Score | ${predmeta.brierScore.brierScore.toFixed(4)} |\n`;
      md += `| Rows with Probability | ${predmeta.brierScore.rowsWithProbability.toLocaleString()} |\n`;
      md += `| Total Rows | ${predmeta.brierScore.totalRows.toLocaleString()} |\n`;
      md += `\n`;
      md += `*Lower is better (0 = perfect calibration, 1 = worst)*\n\n`;
    }
    
    // Confidence Calibration Table
    const confCalibration = Object.entries(predmeta.confidenceCalibration || {});
    if (confCalibration.length > 0) {
      md += `### Confidence Bucket Calibration\n\n`;
      md += `| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |\n`;
      md += `|------------|-------|-------------------|-------------------|-------------------|\n`;
      for (const [bucket, stats] of confCalibration.sort((a, b) => {
        const aMin = parseInt(a[0].split('-')[0] || a[0].replace('+', ''));
        const bMin = parseInt(b[0].split('-')[0] || b[0].replace('+', ''));
        return aMin - bMin;
      })) {
        const errorSign = stats.calibrationError >= 0 ? "+" : "";
        md += `| ${bucket}% | ${stats.races.toLocaleString()} | ${formatPercent(stats.expectedWinRate)} | ${formatPercent(stats.observedWinRate)} | ${errorSign}${formatPercent(stats.calibrationError)} |\n`;
      }
      md += `\n`;
    }
  }

  // Top tracks
  const trackEntries = Object.entries(byTrack)
    .sort((a, b) => b[1].races - a[1].races)
    .slice(0, 10);

  if (trackEntries.length > 0) {
    md += `## Top 10 Tracks (by Race Count)\n\n`;
    md += `| Track | Races | Win Hit Rate | Top 3 Hit Rate |\n`;
    md += `|-------|-------|--------------|----------------|\n`;
    for (const [track, stats] of trackEntries) {
      md += `| ${track} | ${stats.races.toLocaleString()} | ${formatPercent(
        stats.winHitRate
      )} | ${formatPercent(stats.top3HitRate)} |\n`;
    }
    md += `\n`;
  }

  // Strategy summary
  const strategyEntries = Object.entries(byStrategy);
  if (strategyEntries.length > 0) {
    md += `## Strategy Summary\n\n`;
    md += `| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |\n`;
    md += `|----------|-------|--------------|----------------|\n`;
    for (const [strategy, stats] of strategyEntries.sort(
      (a, b) => b[1].races - a[1].races
    )) {
      md += `| ${strategy} | ${stats.races.toLocaleString()} | ${formatPercent(
        stats.winHitRate
      )} | ${formatPercent(stats.top3HitRate)} |\n`;
    }
    md += `\n`;
  }

  // Notes
  md += `## Notes\n\n`;
  md += `This report is based on ${meta.filteredRows.toLocaleString()} races with predictions from Redis verify logs.\n`;
  if (meta.totalRows < 1000) {
    md += `⚠️ **Warning:** Low sample size (${meta.totalRows} rows). Metrics may be less reliable.\n`;
  }
  if (!byTrack["Parx Racing"]) {
    md += `⚠️ **Note:** Parx Racing not in top tracks (may be below minimum sample size threshold).\n`;
  }

  return md;
}

async function main() {
  console.log("📊 Running Verify V1 Calibration...\n");

  try {
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Load CSV
    console.log(`📥 Loading CSV from ${path.basename(CSV_PATH)}...`);
    const rows = await loadCalibrationCsv(CSV_PATH);
    console.log(`✅ Loaded ${rows.length} rows\n`);

    // Compute metrics
    console.log("🔢 Computing metrics...");
    const metrics = computeVerifyMetricsV1(rows, {
      source: "finishline_tests_calibration_v1.csv",
      totalRows: rows.length,
      filteredRows: rows.length,
    });

    // Write JSON report
    console.log(`📝 Writing JSON report to ${path.basename(JSON_OUTPUT)}...`);
    await fs.writeFile(
      JSON_OUTPUT,
      JSON.stringify(metrics, null, 2),
      "utf8"
    );

    // Write Markdown report
    console.log(`📝 Writing Markdown report to ${path.basename(MD_OUTPUT)}...`);
    const mdReport = generateMarkdownReport(metrics);
    await fs.writeFile(MD_OUTPUT, mdReport, "utf8");

    // Console summary
    console.log("\n✅ Calibration complete!\n");
    console.log("[calibrate:verify-v1] Summary:");
    console.log(`  rows=${metrics.meta.totalRows}`);
    console.log(`  predictions=${rows.length}`);
    console.log(`  winHitRate=${formatPercent(metrics.global.winHitRate)}`);
    console.log(`  placeHitRate=${formatPercent(metrics.global.placeHitRate)}`);
    console.log(`  showHitRate=${formatPercent(metrics.global.showHitRate)}`);
    console.log(`  top3HitRate=${formatPercent(metrics.global.top3HitRate)}`);
    console.log(`  anyHitRate=${formatPercent(metrics.global.anyHitRate)}`);
    console.log(`  exactTrifectaRate=${formatPercent(
      metrics.global.exactTrifectaRate
    )}`);
    console.log(`  tracks=${Object.keys(metrics.byTrack).length}`);
    console.log(`  strategies=${Object.keys(metrics.byStrategy).length}`);
    console.log(`\n  Reports written:`);
    console.log(`    - ${JSON_OUTPUT}`);
    console.log(`    - ${MD_OUTPUT}\n`);
  } catch (error) {
    console.error("❌ Calibration failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

