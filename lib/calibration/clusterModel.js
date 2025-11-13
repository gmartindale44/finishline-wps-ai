import { CONFIDENCE_BINS, confidenceToBinLabel } from "./calibrateCore.js";
import { toROI } from "./dataset.js";

/**
 * @param {import("./dataset.js").FinishLineRow[]} rows
 */
export function computeClusterAdjustments(rows) {
  const bins = {};
  for (const row of rows) {
    const binLabel = confidenceToBinLabel(row.confidence);
    if (!bins[binLabel]) {
      bins[binLabel] = { count: 0, sum: 0 };
    }
    bins[binLabel].count += 1;
    bins[binLabel].sum += toROI(row);
  }

  const by_confidence_bin = {};
  CONFIDENCE_BINS.forEach((bin) => {
    const stat = bins[bin.label] || { count: 0, sum: 0 };
    by_confidence_bin[bin.label] = {
      count: stat.count,
      avg_roi: stat.count ? Number((stat.sum / stat.count).toFixed(2)) : 0,
    };
  });

  return {
    version: "v1",
    generated_at: new Date().toISOString(),
    by_confidence_bin,
  };
}

/**
 * @param {import("./dataset.js").FinishLineRow[]} rows
 */
export function computeStrategyWeights(rows) {
  const strategies = {};
  for (const row of rows) {
    const key = row.strategy_flag || row.bet_type || "UNKNOWN";
    if (!strategies[key]) {
      strategies[key] = { count: 0, sum: 0 };
    }
    strategies[key].count += 1;
    strategies[key].sum += toROI(row);
  }

  const by_strategy_flag = {};
  Object.entries(strategies).forEach(([key, stat]) => {
    by_strategy_flag[key] = {
      count: stat.count,
      avg_roi: stat.count ? Number((stat.sum / stat.count).toFixed(2)) : 0,
    };
  });

  return {
    version: "v1",
    generated_at: new Date().toISOString(),
    by_strategy_flag,
  };
}


