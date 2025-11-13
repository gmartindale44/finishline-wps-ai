import { toROI } from "./dataset.js";

export const CONFIDENCE_BINS = [
  { label: "50-54", min: 50, max: 54 },
  { label: "55-59", min: 55, max: 59 },
  { label: "60-64", min: 60, max: 64 },
  { label: "65-69", min: 65, max: 69 },
  { label: "70-74", min: 70, max: 74 },
  { label: "75-79", min: 75, max: 79 },
  { label: "80-84", min: 80, max: 84 },
  { label: "85+", min: 85, max: Infinity },
];

function initBinStats() {
  const map = new Map();
  CONFIDENCE_BINS.forEach((bin) => {
    map.set(bin.label, {
      label: bin.label,
      count: 0,
      winHits: 0,
      top3Hits: 0,
      roiSum: 0,
      roiCount: 0,
      exoticTotal: 0,
      exoticHits: 0,
    });
  });
  return map;
}

function pickConfidenceBin(conf) {
  const pct = Number.isFinite(conf) ? conf : 0;
  for (const bin of CONFIDENCE_BINS) {
    if (pct >= bin.min && pct <= bin.max) return bin.label;
    if (bin.max === Infinity && pct >= bin.min) return bin.label;
  }
  return CONFIDENCE_BINS[0].label;
}

function isExoticStrategy(flag) {
  if (!flag) return false;
  const lower = flag.toLowerCase();
  return (
    lower.includes("exacta") ||
    lower.includes("trifecta") ||
    lower.includes("exa/try") ||
    lower.includes("exa") ||
    lower.includes("tri")
  );
}

function parseHitFlags(wagerResults = "") {
  const value = wagerResults.toLowerCase();
  return {
    winHit: value.includes("win"),
    placeHit: value.includes("place"),
    showHit: value.includes("show"),
  };
}

export function buildCalibrationMetrics(rows) {
  const binStats = initBinStats();

  for (const row of rows) {
    if (!row) continue;
    const confidence = Number.isFinite(row.confidence) ? row.confidence : 0;
    const roi = toROI(row);
    const bin = pickConfidenceBin(confidence);
    const stat = binStats.get(bin);
    stat.count += 1;

    const hits = parseHitFlags(row.wager_results);
    if (hits.winHit) stat.winHits += 1;
    if (hits.winHit || hits.placeHit || hits.showHit) stat.top3Hits += 1;

    if (Number.isFinite(roi)) {
      stat.roiSum += roi;
      stat.roiCount += 1;
    }

    if (isExoticStrategy(row.strategy_flag) || row.bet_type === "Trifecta") {
      stat.exoticTotal += 1;
      if (row.exotics_hit && row.exotics_hit.toLowerCase() !== "no") {
        stat.exoticHits += 1;
      }
    }
  }

  return Array.from(binStats.values()).map((stat) => ({
    bin: stat.label,
    count: stat.count,
    win_rate: stat.count ? Number((stat.winHits / stat.count).toFixed(3)) : 0,
    top3_rate: stat.count
      ? Number((stat.top3Hits / stat.count).toFixed(3))
      : 0,
    avg_roi_atb2: stat.roiCount
      ? Number((stat.roiSum / stat.roiCount).toFixed(2))
      : null,
    exotic_hit_rate: stat.exoticTotal
      ? Number((stat.exoticHits / stat.exoticTotal).toFixed(3))
      : null,
  }));
}

export function buildCalibrationPayload(rows) {
  const bin_metrics = buildCalibrationMetrics(rows);
  return {
    version: "v1",
    generated_at: new Date().toISOString(),
    bin_metrics,
    stake_curve: {
      50: 1,
      55: 1,
      60: 1,
      65: 1,
      70: 2,
      75: 2,
      80: 3,
      85: 3,
    },
    exotics_rules: {
      exacta_min_top3: 45,
      trifecta_min_top3: 55,
      min_conf_for_win_only: 80,
    },
    distance_mods: {
      "≤250y_maiden": {
        exotics_penalty: 0.05,
      },
    },
  };
}

export function confidenceToBinLabel(conf) {
  return pickConfidenceBin(conf);
}


