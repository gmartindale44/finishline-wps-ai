import fs from 'node:fs';
import path from 'node:path';
import { confidenceToBinLabel } from './calibration/calibrateCore.js';

export type Signals = {
  confidence?: number;
  top3Mass?: number;
  gap12?: number;
  gap23?: number;
};

export type GreenZoneSuggestion = 'WinOnly' | 'ATB' | 'ExactaBox' | 'TrifectaBox';
export type GreenZoneTier = 'Green' | 'Yellow' | 'Red';

export type GreenZoneScore = {
  score: number;
  tier: GreenZoneTier;
  suggested: GreenZoneSuggestion;
  note: string;
};

const isServer = typeof window === 'undefined';

type Cached<T> = T | null | undefined;

let cachedSignalWeights: Cached<any> = undefined;
let cachedClusterAdjustments: Cached<any> = undefined;
let cachedStrategyWeights: Cached<any> = undefined;
let cachedCalibrationSummary: Cached<any> = undefined;

function loadJsonIfExists(relativePath: string) {
  if (!isServer) return null;
  try {
    const full = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(full)) {
      return null;
    }
    const raw = fs.readFileSync(full, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[greenZone] Failed to load', relativePath, error);
    return null;
  }
}

function getSignalWeights() {
  if (cachedSignalWeights === undefined) {
    cachedSignalWeights = loadJsonIfExists('data/signal_weights_v1.json');
  }
  return cachedSignalWeights;
}

function getClusterAdjustments() {
  if (cachedClusterAdjustments === undefined) {
    cachedClusterAdjustments = loadJsonIfExists(
      'data/cluster_adjustments_v1.json'
    );
  }
  return cachedClusterAdjustments;
}

function getStrategyWeights() {
  if (cachedStrategyWeights === undefined) {
    cachedStrategyWeights = loadJsonIfExists(
      'data/strategy_weights_v1.json'
    );
  }
  return cachedStrategyWeights;
}

function loadCalibrationSummary() {
  if (!isServer) return null;
  if (cachedCalibrationSummary === undefined) {
    cachedCalibrationSummary = loadJsonIfExists('data/calibration_v1.json');
  }
  return cachedCalibrationSummary;
}

function blendWithSignalWeights(
  baseScore: number,
  signals: Signals
): number {
  const weights = getSignalWeights();
  if (
    !weights ||
    !Array.isArray(weights.weights) ||
    !Array.isArray(weights.feature_order)
  ) {
    return baseScore;
  }

  const featureMap: Record<string, number> = {
    confidence: signals.confidence ?? 0,
    top3_mass: signals.top3Mass ?? 0,
    gap_1_2: signals.gap12 ?? 0,
    gap_2_3: signals.gap23 ?? 0,
  };

  let linear = Number(weights.intercept || 0);
  for (let i = 0; i < weights.feature_order.length; i += 1) {
    const featureName = weights.feature_order[i];
    const val = featureMap[featureName] ?? 0;
    const w = weights.weights[i] ?? 0;
    linear += w * val;
  }

  const blended = baseScore * 0.7 + Math.max(-20, Math.min(20, linear)) * 0.3;
  return Math.max(0, Math.min(100, blended));
}

function applyClusterAdjustment(score: number, signals: Signals): number {
  const clusters = getClusterAdjustments();
  if (!clusters || !clusters.by_confidence_bin) return score;
  const binLabel = confidenceToBinLabel(signals.confidence ?? 0);
  const bin = clusters.by_confidence_bin[binLabel];
  if (!bin || bin.count < 3) return score;
  const adjustment = Math.max(-10, Math.min(10, (bin.avg_roi ?? 0) * 0.2));
  return Math.max(0, Math.min(100, score + adjustment));
}

function applyStrategyAdjustment(
  score: number,
  strategy: GreenZoneSuggestion
): number {
  const strategies = getStrategyWeights();
  if (!strategies || !strategies.by_strategy_flag) return score;
  const entry = strategies.by_strategy_flag[String(strategy)] || null;
  if (!entry || entry.count < 3) return score;
  const adjustment = Math.max(-8, Math.min(8, (entry.avg_roi ?? 0) * 0.15));
  return Math.max(0, Math.min(100, score + adjustment));
}

function applyBinRoiAdjustment(score: number, confidence: number): number {
  const summary = loadCalibrationSummary();
  if (
    !summary ||
    !Array.isArray(summary.bin_metrics) ||
    !Number.isFinite(confidence)
  ) {
    return score;
  }
  const binLabel = confidenceToBinLabel(confidence);
  const bin = summary.bin_metrics.find((entry: any) => entry.bin === binLabel);
  if (
    !bin ||
    !bin ||
    !Number.isFinite(bin.avg_roi_atb2) ||
    !Number.isFinite(bin.count) ||
    bin.count <= 0
  ) {
    return score;
  }
  const clamped = Math.max(-100, Math.min(100, Number(bin.avg_roi_atb2)));
  const delta = Number((clamped * 0.15).toFixed(2));
  return Math.max(0, Math.min(100, score + delta));
}

export function scoreGreenZone(signals: Signals): GreenZoneScore {
  const confidence = Math.max(0, Math.min(100, signals.confidence ?? 0));
  const top3Mass = Math.max(0, Math.min(100, signals.top3Mass ?? 0));
  const gap12 = Math.max(0, signals.gap12 ?? 0);
  const gap23 = Math.max(0, signals.gap23 ?? 0);

  const weighted = 0.45 * confidence + 0.35 * top3Mass + 8 * gap12 + 5 * gap23;
  let score = Math.round(Math.min(100, weighted));

  let suggested: GreenZoneSuggestion = 'ATB';
  if (confidence >= 78 && gap12 >= 2) suggested = 'WinOnly';
  else if (top3Mass >= 55 && gap12 + gap23 >= 3.5) suggested = 'TrifectaBox';
  else if (top3Mass >= 52) suggested = 'ExactaBox';

  if (isServer) {
    score = blendWithSignalWeights(score, {
      confidence,
      top3Mass,
      gap12,
      gap23,
    });
    score = applyClusterAdjustment(score, {
      confidence,
      top3Mass,
      gap12,
      gap23,
    });
    score = applyStrategyAdjustment(score, suggested);
    score = applyBinRoiAdjustment(score, confidence);
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  let tier: GreenZoneTier = 'Red';
  if (score >= 72) tier = 'Green';
  else if (score >= 58) tier = 'Yellow';

  const note = tier === 'Green'
    ? 'Strong edge: confidence/mass plus healthy gaps'
    : tier === 'Yellow'
      ? 'Decent edge; reduce stake or seek better price'
      : 'Skip unless overlay odds';

  return { score, tier, suggested, note };
}
