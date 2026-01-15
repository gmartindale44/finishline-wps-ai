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
 * Get npm command path (cross-platform)
 */
function getNpmCommand() {
  if (process.platform === "win32") {
    try {
      // Find npm.cmd in PATH
      const npmPath = execSync("where npm.cmd", { encoding: "utf8" }).trim().split("\n")[0];
      if (npmPath) return npmPath;
    } catch {}
    // Fallback to npm.cmd (will be resolved by PATH via spawn)
    return "npm.cmd";
  }
  return "npm";
}

/**
 * Run npm script using spawn (for streaming output)
 */
function runNpmScript(scriptName) {
  return new Promise((resolve, reject) => {
    // On Windows, use npm.cmd to avoid shell requirement and deprecation warning
    // On Unix-like systems, use npm directly
    const npmCmd = getNpmCommand();
    const proc = spawn(npmCmd, ["run", scriptName], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn ${scriptName}: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptName} exited with code ${code}`));
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
 * Load previous calibration report (from git or file)
 */
async function loadPreviousReport() {
  try {
    // Try to get previous commit that had a calibration report
    let prevCommit = null;
    try {
      const log = execSync(
        'git log --oneline --all -n 20 --format="%H" -- data/calibration/verify_v1_report.json',
        { encoding: "utf8" }
      ).trim();
      const commits = log.split("\n").filter(Boolean);
      if (commits.length > 1) {
        prevCommit = commits[1]; // Second most recent
      }
    } catch {}

    if (prevCommit) {
      try {
        const content = execSync(`git show ${prevCommit}:data/calibration/verify_v1_report.json`, {
          encoding: "utf8",
        });
        return JSON.parse(content);
      } catch {}
    }

    // Fallback: try to load from trend data (last run)
    const trendData = await loadTrendData();
    if (trendData.runs.length > 0) {
      const lastRun = trendData.runs[trendData.runs.length - 1];
      // Try to load from git using the commit SHA
      if (lastRun.commitSha && lastRun.commitSha !== "unknown") {
        try {
          const content = execSync(
            `git show ${lastRun.commitSha}:data/calibration/verify_v1_report.json`,
            { encoding: "utf8" }
          );
          return JSON.parse(content);
        } catch {}
      }
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
    lines.push("### Previous Run");
    lines.push("");
    lines.push(`- **Generated At:** ${prevMetrics.meta?.generatedAt || "N/A"}`);
    lines.push(`- **Sample Size:** ${prevMetrics.meta?.totalRows || 0} rows`);
    lines.push("");
  }

  // Regression Guardrails
  lines.push("## Regression Guardrails");
  lines.push("");
  lines.push("**Active Thresholds:**");
  lines.push(`- Top 3 Hit Rate drop ≥ ${(REGRESSION_THRESHOLDS.TOP3_HIT_DROP * 100).toFixed(1)}pp → REGRESSION WARNING`);
  lines.push(`- Win Hit Rate drop ≥ ${(REGRESSION_THRESHOLDS.WIN_HIT_DROP * 100).toFixed(1)}pp for 2 consecutive runs → WATCH`);
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
      await runNpmScript("export:verify-redis");
    } catch (err) {
      console.error("❌ Export failed:", err.message);
      process.exit(1);
    }

    console.log("\nStep 2: Building calibration sample...");
    try {
      await runNpmScript("build:calibration-sample");
    } catch (err) {
      console.error("❌ Sample build failed:", err.message);
      process.exit(1);
    }

    console.log("\nStep 3: Running calibration...");
    try {
      await runNpmScript("calibrate:verify-v1");
    } catch (err) {
      console.error("❌ Calibration failed:", err.message);
      process.exit(1);
    }

    // Step 2: Load reports
    console.log("\nStep 4: Loading calibration reports...");
    const newMetrics = JSON.parse(await fs.readFile(CAL_REPORT_JSON, "utf8"));
    const prevMetrics = await loadPreviousReport();

    // Step 3: Get commit info
    const commitSha = getCurrentCommitShaFull();
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
