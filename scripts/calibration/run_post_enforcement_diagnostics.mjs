#!/usr/bin/env node
/**
 * scripts/calibration/run_post_enforcement_diagnostics.mjs
 * 
 * Post-enforcement diagnostics with trend tracking and regression guardrails
 * 
 * Usage:
 *   node scripts/calibration/run_post_enforcement_diagnostics.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TREND_FILE = path.join(__dirname, "../../data/calibration/diagnostics_trend.json");
const REPORT_DIR = path.join(__dirname, "../../docs/diagnostics");
const CAL_REPORT_JSON = path.join(__dirname, "../../data/calibration/verify_v1_report.json");

// Regression thresholds
const REGRESSION_THRESHOLDS = {
  TOP3_HIT_DROP: 0.01, // 1.0pp drop triggers warning
  WIN_HIT_DROP: 0.01,  // 1.0pp drop for 2 consecutive runs triggers watch
  BRIER_SCORE_WORSEN: 0.01, // 0.01 increase in Brier score triggers watch
};

/**
 * Format percentage (0.2482 -> "24.82%")
 */
function formatPercent(value, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format percentage points delta (+0.0128 -> "+1.28pp")
 */
function formatDelta(newVal, oldVal) {
  if (newVal == null || oldVal == null || !Number.isFinite(newVal) || !Number.isFinite(oldVal)) {
    return "N/A";
  }
  const delta = newVal - oldVal;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(2)}pp`;
}

/**
 * Run Node script directly using spawn (for streaming output)
 */
function runNodeScript(relativeScriptPath) {
  return new Promise((resolve, reject) => {
    const absoluteScriptPath = path.resolve(process.cwd(), relativeScriptPath);
    const proc = spawn(process.execPath, [absoluteScriptPath], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn ${relativeScriptPath}: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${relativeScriptPath} exited with code ${code}`));
      }
    });
  });
}

/**
 * Get current git commit SHA (short)
 */
function getCurrentCommitSha() {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    return sha;
  } catch {
    return "unknown";
  }
}

/**
 * Get current git commit SHA (full)
 */
function getCurrentCommitShaFull() {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    return sha;
  } catch {
    return "unknown";
  }
}

/**
 * Load trend data or create empty structure
 */
async function loadTrendData() {
  try {
    const content = await fs.readFile(TREND_FILE, "utf8");
    return JSON.parse(content);
  } catch {
    return {
      runs: [],
      lastUpdated: null,
    };
  }
}

/**
 * Save trend data
 */
async function saveTrendData(trendData) {
  trendData.lastUpdated = new Date().toISOString();
  await fs.mkdir(path.dirname(TREND_FILE), { recursive: true });
  await fs.writeFile(TREND_FILE, JSON.stringify(trendData, null, 2), "utf8");
}

/**
 * Check if a run is a duplicate (same commitSha + sampleSize + close timestamp)
 */
function isDuplicateRun(newRun, existingRun) {
  const sameCommit = newRun.commitSha === existingRun.commitSha;
  const sameSampleSize = newRun.sampleSize === existingRun.sampleSize;
  
  if (!sameCommit || !sameSampleSize) {
    return false;
  }
  
  // Check if timestamps are within 1 hour (to catch multiple runs on same commit)
  const newTime = new Date(newRun.timestamp).getTime();
  const existingTime = new Date(existingRun.timestamp).getTime();
  const timeDiff = Math.abs(newTime - existingTime);
  const oneHour = 60 * 60 * 1000;
  
  return timeDiff < oneHour;
}

/**
 * Remove duplicate entries from trend data
 */
function dedupeTrendData(trendData) {
  const seen = new Map();
  const deduped = [];
  
  // Process in reverse order (keep most recent duplicates)
  for (let i = trendData.runs.length - 1; i >= 0; i--) {
    const run = trendData.runs[i];
    const key = `${run.commitSha}-${run.sampleSize}`;
    
    if (!seen.has(key)) {
      seen.set(key, true);
      deduped.unshift(run); // Add to front to preserve order
    } else {
      // Check if this is a true duplicate (close timestamp)
      const existing = deduped.find((r) => r.commitSha === run.commitSha && r.sampleSize === run.sampleSize);
      if (existing && isDuplicateRun(run, existing)) {
        // Skip this duplicate
        continue;
      }
      deduped.unshift(run);
    }
  }
  
  trendData.runs = deduped;
  return trendData;
}

/**
 * Load previous calibration report from trend data (preferred) or fallback to markdown reports
 */
async function loadPreviousReport(currentCommitSha) {
  try {
    // Primary: Use trend data to get the previous run (second-to-last entry)
    const trendData = await loadTrendData();
    
    // If we have at least 2 runs, use the second-to-last as baseline
    if (trendData.runs.length >= 2) {
      const prevRun = trendData.runs[trendData.runs.length - 2]; // Second-to-last entry
      
      // Try to load the actual report from git using the previous run's commit SHA
      if (prevRun.commitSha && prevRun.commitSha !== "unknown" && prevRun.commitSha !== currentCommitSha) {
        try {
          const content = execSync(
            `git show ${prevRun.commitSha}:data/calibration/verify_v1_report.json`,
            { encoding: "utf8" }
          );
          const report = JSON.parse(content);
          // Store the baseline commit SHA for debugging
          report._baselineCommitSha = prevRun.commitSha;
          report._baselineSource = "trend_data";
          return report;
        } catch {}
      }
      
      // If git load fails, reconstruct metrics from trend data (less ideal but works)
      return {
        meta: {
          generatedAt: prevRun.timestamp,
          totalRows: prevRun.sampleSize,
        },
        global: {
          top3HitRate: prevRun.top3HitRate,
          winHitRate: prevRun.winHitRate,
          placeHitRate: prevRun.placeHitRate,
          showHitRate: prevRun.showHitRate,
          anyHitRate: prevRun.anyHitRate,
          exactTrifectaRate: prevRun.trifectaRate,
        },
        predmeta: {
          coverage: {
            coverageRate: prevRun.predmetaCoverage,
          },
        },
        _baselineCommitSha: prevRun.commitSha,
        _baselineSource: "trend_data",
      };
    }
    
    // Fallback: Load from previous markdown report in docs/diagnostics/
    if (trendData.runs.length < 2) {
      try {
        const reportFiles = await fs.readdir(REPORT_DIR);
        const mdFiles = reportFiles
          .filter((f) => f.startsWith("CAL_DIAG_") && f.endsWith(".md"))
          .sort()
          .reverse(); // Most recent first
        
        // Skip the most recent one (might be the current one being generated)
        // Try to find one with a different commit SHA or different date
        for (let i = 0; i < mdFiles.length; i++) {
          const mdFile = mdFiles[i];
          const mdPath = path.join(REPORT_DIR, mdFile);
          const content = await fs.readFile(mdPath, "utf8");
          
          // Extract commit SHA from the report
          const commitMatch = content.match(/Commit.*?`([a-f0-9]{40})`/);
          if (commitMatch && commitMatch[1] !== currentCommitSha) {
            // Try to load the corresponding JSON report from git
            const reportCommit = commitMatch[1];
            try {
              const jsonContent = execSync(
                `git show ${reportCommit}:data/calibration/verify_v1_report.json`,
                { encoding: "utf8" }
              );
              const report = JSON.parse(jsonContent);
              report._baselineCommitSha = reportCommit;
              report._baselineSource = "markdown_report";
              return report;
            } catch {}
          }
        }
      } catch {}
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check regression guardrails
 */
function checkRegressionGuardrails(newMetrics, prevMetrics, trendData) {
  const warnings = [];
  const watches = [];

  if (!prevMetrics || !newMetrics) {
    return { warnings, watches };
  }

  const newTop3 = newMetrics.global?.top3HitRate || 0;
  const prevTop3 = prevMetrics.global?.top3HitRate || 0;
  const top3Delta = newTop3 - prevTop3;

  if (top3Delta <= -REGRESSION_THRESHOLDS.TOP3_HIT_DROP) {
    warnings.push({
      type: "REGRESSION_WARNING",
      metric: "Top 3 Hit Rate",
      current: formatPercent(newTop3),
      previous: formatPercent(prevTop3),
      delta: formatDelta(newTop3, prevTop3),
      threshold: "-1.0pp",
    });
  }

  const newWin = newMetrics.global?.winHitRate || 0;
  const prevWin = prevMetrics.global?.winHitRate || 0;
  const winDelta = newWin - prevWin;

  // Check if win hit dropped by >= 1.0pp for 2 consecutive runs
  if (winDelta <= -REGRESSION_THRESHOLDS.WIN_HIT_DROP && trendData.runs.length >= 1) {
    const lastRun = trendData.runs[trendData.runs.length - 1];
    if (lastRun.winHitRate != null) {
      const lastWinDelta = newWin - lastRun.winHitRate;
      if (lastWinDelta <= -REGRESSION_THRESHOLDS.WIN_HIT_DROP) {
        watches.push({
          type: "WATCH",
          metric: "Win Hit Rate",
          current: formatPercent(newWin),
          previous: formatPercent(prevWin),
          delta: formatDelta(newWin, prevWin),
          threshold: "-1.0pp for 2 consecutive runs",
        });
      }
    }
  }

  // Check Brier score degradation
  const newBrier = newMetrics.predmeta?.brierScore?.brierScore;
  const prevBrier = prevMetrics?.predmeta?.brierScore?.brierScore;
  if (newBrier != null && prevBrier != null && Number.isFinite(newBrier) && Number.isFinite(prevBrier)) {
    const brierDelta = newBrier - prevBrier;
    if (brierDelta >= REGRESSION_THRESHOLDS.BRIER_SCORE_WORSEN) {
      watches.push({
        type: "WATCH",
        metric: "Brier Score",
        current: newBrier.toFixed(4),
        previous: prevBrier.toFixed(4),
        delta: `+${brierDelta.toFixed(4)}`,
        threshold: "+0.01 increase",
      });
    }
  }

  return { warnings, watches };
}

/**
 * Generate markdown report
 */
async function generateReport(newMetrics, prevMetrics, trendData, warnings, watches, commitSha) {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const shortSha = commitSha.substring(0, 8);

  const newGlobal = newMetrics.global || {};
  const prevGlobal = prevMetrics?.global || {};
  const newPredmeta = newMetrics.predmeta?.coverage || {};
  const prevPredmeta = prevMetrics?.predmeta?.coverage || {};

  const lines = [];

  // Header
  lines.push(`# Post-Enforcement Diagnostics Report`);
  lines.push("");
  lines.push(`**Generated:** ${now.toISOString()}`);
  lines.push(`**Commit:** \`${commitSha}\` (short: \`${shortSha}\`)`);
  lines.push(`**Report Type:** Post-Enforcement Trend Monitoring`);
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  if (warnings.length > 0) {
    lines.push("⚠️ **REGRESSION WARNINGS DETECTED** - See details below.");
    lines.push("");
  }
  if (watches.length > 0) {
    lines.push("👀 **WATCH CONDITIONS ACTIVE** - See details below.");
    lines.push("");
  }
  if (warnings.length === 0 && watches.length === 0) {
    lines.push("✅ **No regression warnings or watch conditions detected.**");
    lines.push("");
  }
  lines.push(`**Current Metrics:**`);
  lines.push(`- Top 3 Hit Rate: ${formatPercent(newGlobal.top3HitRate)}`);
  lines.push(`- Win Hit Rate: ${formatPercent(newGlobal.winHitRate)}`);
  lines.push(`- Predmeta Coverage: ${formatPercent(newPredmeta.coverageRate)}`);
  lines.push("");

  // Regression Warnings
  if (warnings.length > 0) {
    lines.push("## ⚠️ Regression Warnings");
    lines.push("");
    warnings.forEach((w) => {
      lines.push(`### ${w.type}: ${w.metric}`);
      lines.push("");
      lines.push(`- **Current:** ${w.current}`);
      lines.push(`- **Previous:** ${w.previous}`);
      lines.push(`- **Delta:** ${w.delta}`);
      lines.push(`- **Threshold:** ${w.threshold}`);
      lines.push("");
    });
  }

  // Watch Conditions
  if (watches.length > 0) {
    lines.push("## 👀 Watch Conditions");
    lines.push("");
    watches.forEach((w) => {
      lines.push(`### ${w.type}: ${w.metric}`);
      lines.push("");
      lines.push(`- **Current:** ${w.current}`);
      lines.push(`- **Previous:** ${w.previous}`);
      lines.push(`- **Delta:** ${w.delta}`);
      lines.push(`- **Threshold:** ${w.threshold}`);
      lines.push("");
    });
  }

  // Metrics Comparison
  lines.push("## Metrics Comparison");
  lines.push("");
  if (prevMetrics) {
    lines.push("### Global Metrics");
    lines.push("");
    lines.push("| Metric | Previous | Current | Delta | Status |");
    lines.push("|--------|----------|---------|-------|--------|");
    
    const metrics = [
      { name: "Top 3 Hit Rate", key: "top3HitRate" },
      { name: "Win Hit Rate", key: "winHitRate" },
      { name: "Place Hit Rate", key: "placeHitRate" },
      { name: "Show Hit Rate", key: "showHitRate" },
      { name: "Any Hit Rate", key: "anyHitRate" },
      { name: "Exact Trifecta Rate", key: "exactTrifectaRate" },
    ];

    metrics.forEach((m) => {
      const prev = prevGlobal[m.key] || 0;
      const curr = newGlobal[m.key] || 0;
      const delta = formatDelta(curr, prev);
      const status = curr > prev ? "⬆️ Improved" : curr < prev ? "⬇️ Decreased" : "➡️ Unchanged";
      lines.push(`| **${m.name}** | ${formatPercent(prev)} | ${formatPercent(curr)} | ${delta} | ${status} |`);
    });

    lines.push("");
    lines.push("### Predmeta Coverage");
    lines.push("");
    lines.push("| Metric | Previous | Current | Delta |");
    lines.push("|--------|----------|---------|-------|");
    lines.push(`| **Coverage Rate** | ${formatPercent(prevPredmeta.coverageRate)} | ${formatPercent(newPredmeta.coverageRate)} | ${formatDelta(newPredmeta.coverageRate, prevPredmeta.coverageRate)} |`);
    lines.push("");
  } else {
    lines.push("**Note:** No previous baseline available for comparison.");
    lines.push("");
  }

  // Trend Table (Last 5 Runs)
  if (trendData.runs.length > 0) {
    lines.push("## Trend History (Last 5 Runs)");
    lines.push("");
    const recentRuns = trendData.runs.slice(-5);
    lines.push("| Date | Commit | Top 3 | Win | Place | Show | Coverage |");
    lines.push("|------|--------|-------|-----|-------|------|----------|");
    
    recentRuns.forEach((run, idx) => {
      const date = new Date(run.timestamp).toISOString().split("T")[0];
      const shortCommit = run.commitSha.substring(0, 8);
      const top3 = formatPercent(run.top3HitRate);
      const win = formatPercent(run.winHitRate);
      const place = formatPercent(run.placeHitRate);
      const show = formatPercent(run.showHitRate);
      const coverage = formatPercent(run.predmetaCoverage);
      
      lines.push(`| ${date} | \`${shortCommit}\` | ${top3} | ${win} | ${place} | ${show} | ${coverage} |`);
    });

    lines.push("");
    
    // Deltas from previous run
    if (recentRuns.length >= 2) {
      lines.push("### Deltas (vs Previous Run)");
      lines.push("");
      const lastRun = recentRuns[recentRuns.length - 1];
      const prevRun = recentRuns[recentRuns.length - 2];
      
      lines.push(`- **Top 3 Hit Rate:** ${formatDelta(lastRun.top3HitRate, prevRun.top3HitRate)}`);
      lines.push(`- **Win Hit Rate:** ${formatDelta(lastRun.winHitRate, prevRun.winHitRate)}`);
      lines.push(`- **Place Hit Rate:** ${formatDelta(lastRun.placeHitRate, prevRun.placeHitRate)}`);
      lines.push(`- **Show Hit Rate:** ${formatDelta(lastRun.showHitRate, prevRun.showHitRate)}`);
      lines.push(`- **Predmeta Coverage:** ${formatDelta(lastRun.predmetaCoverage, prevRun.predmetaCoverage)}`);
      lines.push("");
    }
  }

  // Artifact Details
  lines.push("## Artifact Details");
  lines.push("");
  lines.push("### Current Run");
  lines.push("");
  lines.push(`- **Generated At:** ${newMetrics.meta?.generatedAt || "N/A"}`);
  lines.push(`- **Commit:** \`${commitSha}\``);
  lines.push(`- **Sample Size:** ${newMetrics.meta?.totalRows || 0} rows`);
  lines.push(`- **Source:** Production Redis verify logs`);
  lines.push("");
  
  if (prevMetrics) {
    const baselineSha = prevMetrics._baselineCommitSha || "unknown";
    const baselineSource = prevMetrics._baselineSource || "unknown";
    lines.push("### Previous Run (Baseline)");
    lines.push("");
    lines.push(`- **Generated At:** ${prevMetrics.meta?.generatedAt || "N/A"}`);
    lines.push(`- **Sample Size:** ${prevMetrics.meta?.totalRows || 0} rows`);
    lines.push(`- **Baseline commit used:** \`${baselineSha}\` (source: ${baselineSource})`);
    lines.push("");
  }

  // New Metrics Section
  if (newMetrics.predmeta?.brierScore?.brierScore != null) {
    lines.push("## Calibration Metrics");
    lines.push("");
    lines.push("### Brier Score");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Brier Score | ${newMetrics.predmeta.brierScore.brierScore.toFixed(4)} |`);
    lines.push(`| Rows with Probability | ${newMetrics.predmeta.brierScore.rowsWithProbability.toLocaleString()} |`);
    lines.push("");
    
    if (prevMetrics?.predmeta?.brierScore?.brierScore != null) {
      const prevBrier = prevMetrics.predmeta.brierScore.brierScore;
      const currBrier = newMetrics.predmeta.brierScore.brierScore;
      const delta = currBrier - prevBrier;
      const sign = delta >= 0 ? "+" : "";
      lines.push(`**Delta vs Previous:** ${sign}${delta.toFixed(4)}`);
      lines.push("");
    }
  }
  
  if (newMetrics.predmeta?.confidenceCalibration && Object.keys(newMetrics.predmeta.confidenceCalibration).length > 0) {
    lines.push("### Confidence Bucket Calibration");
    lines.push("");
    lines.push("| Confidence | Races | Expected | Observed | Error |");
    lines.push("|------------|-------|----------|----------|-------|");
    const calEntries = Object.entries(newMetrics.predmeta.confidenceCalibration).sort((a, b) => {
      const aMin = parseInt(a[0].split('-')[0] || a[0].replace('+', ''));
      const bMin = parseInt(b[0].split('-')[0] || b[0].replace('+', ''));
      return aMin - bMin;
    });
    for (const [bucket, stats] of calEntries) {
      const errorSign = stats.calibrationError >= 0 ? "+" : "";
      lines.push(`| ${bucket}% | ${stats.races.toLocaleString()} | ${formatPercent(stats.expectedWinRate)} | ${formatPercent(stats.observedWinRate)} | ${errorSign}${formatPercent(stats.calibrationError)} |`);
    }
    lines.push("");
  }

  // Regression Guardrails
  lines.push("## Regression Guardrails");
  lines.push("");
  lines.push("**Active Thresholds:**");
  lines.push(`- Top 3 Hit Rate drop ≥ ${(REGRESSION_THRESHOLDS.TOP3_HIT_DROP * 100).toFixed(1)}pp → REGRESSION WARNING`);
  lines.push(`- Win Hit Rate drop ≥ ${(REGRESSION_THRESHOLDS.WIN_HIT_DROP * 100).toFixed(1)}pp for 2 consecutive runs → WATCH`);
  lines.push(`- Brier Score increase ≥ ${REGRESSION_THRESHOLDS.BRIER_SCORE_WORSEN.toFixed(2)} → WATCH`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Main function
 */
async function main() {
  try {
    console.log("📊 Post-Enforcement Diagnostics");
    console.log("");

    // Step 1: Run calibration pipeline
    console.log("Step 1: Exporting verify logs from Redis...");
    try {
      await runNodeScript("scripts/calibration/export_verify_redis_to_csv.mjs");
    } catch (err) {
      console.error("❌ Export failed:", err.message);
      process.exit(1);
    }

    console.log("\nStep 2: Building calibration sample...");
    try {
      await runNodeScript("scripts/calibration/build_calibration_sample_from_verify_csv.mjs");
    } catch (err) {
      console.error("❌ Sample build failed:", err.message);
      process.exit(1);
    }

    console.log("\nStep 3: Running calibration...");
    try {
      await runNodeScript("scripts/calibration/run_calibrate_verify_v1.mjs");
    } catch (err) {
      console.error("❌ Calibration failed:", err.message);
      process.exit(1);
    }

    // Step 2: Load reports
    console.log("\nStep 4: Loading calibration reports...");
    const newMetrics = JSON.parse(await fs.readFile(CAL_REPORT_JSON, "utf8"));
    const commitSha = getCurrentCommitShaFull();
    const prevMetrics = await loadPreviousReport(commitSha);

    // Step 3: Get commit info (already have commitSha from Step 4)
    const shortSha = getCurrentCommitSha();

    // Step 4: Load and update trend data
    console.log("Step 5: Updating trend data...");
    const trendData = await loadTrendData();
    
    // Dedupe existing trend data
    dedupeTrendData(trendData);

    const newRun = {
      timestamp: new Date().toISOString(),
      commitSha: commitSha,
      sampleSize: newMetrics.meta?.totalRows || 0,
      top3HitRate: newMetrics.global?.top3HitRate || 0,
      winHitRate: newMetrics.global?.winHitRate || 0,
      placeHitRate: newMetrics.global?.placeHitRate || 0,
      showHitRate: newMetrics.global?.showHitRate || 0,
      anyHitRate: newMetrics.global?.anyHitRate || 0,
      trifectaRate: newMetrics.global?.exactTrifectaRate || 0,
      predmetaCoverage: newMetrics.predmeta?.coverage?.coverageRate || 0,
    };

    // Check for duplicate before adding
    const isDuplicate = trendData.runs.some((run) => isDuplicateRun(newRun, run));
    if (!isDuplicate) {
      trendData.runs.push(newRun);
    } else {
      console.log("⚠️  Duplicate run detected (same commit + sampleSize + close timestamp), skipping...");
    }
    
    await saveTrendData(trendData);

    // Step 5: Check regression guardrails
    console.log("Step 6: Checking regression guardrails...");
    const { warnings, watches } = checkRegressionGuardrails(newMetrics, prevMetrics, trendData);

    if (warnings.length > 0) {
      console.log("⚠️  REGRESSION WARNINGS:");
      warnings.forEach((w) => {
        console.log(`   - ${w.metric}: ${w.delta} (threshold: ${w.threshold})`);
      });
    }

    if (watches.length > 0) {
      console.log("👀 WATCH CONDITIONS:");
      watches.forEach((w) => {
        console.log(`   - ${w.metric}: ${w.delta} (threshold: ${w.threshold})`);
      });
    }

    if (warnings.length === 0 && watches.length === 0) {
      console.log("✅ No regression warnings or watch conditions");
    }

    // Step 6: Generate markdown report
    console.log("\nStep 7: Generating markdown report...");
    const report = await generateReport(
      newMetrics,
      prevMetrics,
      trendData,
      warnings,
      watches,
      commitSha
    );

    const dateStr = new Date().toISOString().split("T")[0];
    const reportFilename = `CAL_DIAG_${dateStr}_${shortSha}.md`;
    const reportPath = path.join(REPORT_DIR, reportFilename);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(reportPath, report, "utf8");

    console.log(`✅ Report generated: ${reportPath}`);
    console.log(`✅ Trend data updated: ${TREND_FILE}`);
    console.log("");

    // Summary
    console.log("📊 Summary:");
    console.log(`   Top 3 Hit Rate: ${formatPercent(newRun.top3HitRate)}`);
    console.log(`   Win Hit Rate: ${formatPercent(newRun.winHitRate)}`);
    console.log(`   Predmeta Coverage: ${formatPercent(newRun.predmetaCoverage)}`);
    if (warnings.length > 0) {
      console.log(`   ⚠️  ${warnings.length} regression warning(s)`);
    }
    if (watches.length > 0) {
      console.log(`   👀 ${watches.length} watch condition(s)`);
    }
    console.log("");

  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
