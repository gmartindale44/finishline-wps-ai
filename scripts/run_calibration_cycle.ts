import fs from "node:fs";
import path from "node:path";
import { loadMergedDataset } from "../lib/calibration/dataset.js";
import { buildCalibrationPayload } from "../lib/calibration/calibrateCore.js";
import { computeSignalWeights } from "../lib/calibration/signalModel.js";
import {
  computeClusterAdjustments,
  computeStrategyWeights,
} from "../lib/calibration/clusterModel.js";

async function loadRedisMeta() {
  try {
    const { redisKeys } = await import("../lib/redis.js");
    const predKeys = await redisKeys("fl:pred:*");
    const reconcileKeys = await redisKeys("fl:cse:reconcile:*");
    return {
      ok: true,
      predictions: predKeys.length,
      reconciled: reconcileKeys.length,
      unresolved: Math.max(predKeys.length - reconcileKeys.length, 0),
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      predictions: 0,
      reconciled: 0,
      unresolved: 0,
    };
  }
}

function writeJson(relativePath, data) {
  const fullPath = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`[calibration] Wrote ${relativePath}`);
}

function printSummaryTable(calibrationPayload, meta, redisMeta, signal) {
  console.log("\n=== Calibration Summary ===");
  console.table(
    calibrationPayload.bin_metrics.map((bin) => ({
      bin: bin.bin,
      count: bin.count,
      avg_roi: bin.avg_roi_atb2,
      win_rate: bin.win_rate,
      top3_rate: bin.top3_rate,
    }))
  );

  console.log("\nDataset Stats:");
  console.log(
    `  Rows processed: ${meta.rowsProcessed}, skipped rows: ${meta.skippedRows}`
  );
  if (meta.suppressedWarnings) {
    console.log(`  Suppressed warnings: ${meta.suppressedWarnings}`);
  }

  console.log("\nRedis Snapshot:");
  if (redisMeta.ok) {
    console.log(
      `  Prediction keys: ${redisMeta.predictions}, reconciled: ${redisMeta.reconciled}, unresolved (approx): ${redisMeta.unresolved}`
    );
  } else {
    console.log(`  Redis unavailable (${redisMeta.error})`);
  }

  if (signal) {
    console.log("\nSignal Weights:");
    console.table(
      signal.feature_order.map((feature, idx) => ({
        feature,
        weight: signal.weights[idx],
      }))
    );
    console.log(
      `  Intercept: ${signal.intercept} (fallback=${signal.fallback ? "yes" : "no"}; samples=${signal.sample_size})`
    );
  } else {
    console.log("\nSignal Weights: not enough data to compute.");
  }
}

async function main() {
  const datasetResult = loadMergedDataset({ silent: true });
  console.log(
    `[calibration] dataset main_rows=${datasetResult.sourceCounts.main_rows} historical_rows=${datasetResult.sourceCounts.historical_rows} merged_rows=${datasetResult.sourceCounts.merged_rows} deduped=${datasetResult.sourceCounts.deduped}`
  );
  const rows = datasetResult.rows;
  const skippedRows =
    (datasetResult.meta?.main?.skipped ?? 0) +
    (datasetResult.meta?.historical?.skipped ?? 0);
  const suppressedWarnings =
    (datasetResult.meta?.main?.suppressedWarnings ?? 0) +
    (datasetResult.meta?.historical?.suppressedWarnings ?? 0);

  const calibrationPayload = buildCalibrationPayload(rows);
  const signalWeights = computeSignalWeights(rows);
  const clusters = computeClusterAdjustments(rows);
  const strategies = computeStrategyWeights(rows);

  writeJson("data/calibration_v1.json", calibrationPayload);
  if (signalWeights) {
    writeJson("data/signal_weights_v1.json", signalWeights);
  }
  writeJson("data/cluster_adjustments_v1.json", clusters);
  writeJson("data/strategy_weights_v1.json", strategies);

  const redisMeta = await loadRedisMeta();

  printSummaryTable(
    calibrationPayload,
    {
      rowsProcessed: rows.length,
      skippedRows,
      suppressedWarnings,
    },
    redisMeta,
    signalWeights
  );

  console.log("\n[calibration] cycle complete");
}

main().catch((err) => {
  console.error("[run_calibration_cycle] Failed:", err?.message || err);
  process.exit(1);
});
