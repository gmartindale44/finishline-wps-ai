import fs from "node:fs";
import path from "node:path";

const DEFAULT_THRESHOLDS = {
  version: 1,
  strategyName: "v1_shadow_only_default",
  win: { minConfidence: 0.62, maxFieldSize: 12 },
  place: { minConfidence: 0.55, maxFieldSize: 14 },
  show: { minConfidence: 0.50, maxFieldSize: 16 },
  global: {
    minOddsFloor: 1.2,
    maxOddsCeiling: 8.0,
    enableLongshotFilter: true,
  },
};

/**
 * Load calibration thresholds from config/calibration_thresholds.json.
 * - Never throws: on error, returns DEFAULT_THRESHOLDS.
 * - Safe for serverless / Vercel: uses relative path from project root.
 */
export function loadCalibrationThresholds() {
  try {
    const configPath = path.join(
      process.cwd(),
      "config",
      "calibration_thresholds.json"
    );
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      console.warn(
        "[calibrationThresholds] Parsed config is not an object, using defaults"
      );
      return DEFAULT_THRESHOLDS;
    }

    return {
      ...DEFAULT_THRESHOLDS,
      ...parsed,
      win: { ...DEFAULT_THRESHOLDS.win, ...(parsed.win || {}) },
      place: { ...DEFAULT_THRESHOLDS.place, ...(parsed.place || {}) },
      show: { ...DEFAULT_THRESHOLDS.show, ...(parsed.show || {}) },
      global: { ...DEFAULT_THRESHOLDS.global, ...(parsed.global || {}) },
    };
  } catch (err) {
    console.warn(
      "[calibrationThresholds] Failed to load config, using defaults:",
      err?.message || String(err)
    );
    return DEFAULT_THRESHOLDS;
  }
}
