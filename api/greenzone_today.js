// api/greenzone_today.js
import fs from "node:fs/promises";
import path from "node:path";

export const config = {
  runtime: "nodejs",
};

let cachedSnapshot = null;

/**
 * Load the shadow calibration snapshot from disk (with simple in-memory cache).
 */
async function loadShadowSnapshot() {
  if (cachedSnapshot) return cachedSnapshot;

  try {
    const snapshotPath = path.join(
      process.cwd(),
      "data",
      "shadow_snapshot_v1.json"
    );
    const raw = await fs.readFile(snapshotPath, "utf8");
    const json = JSON.parse(raw);
    cachedSnapshot = json;
    return json;
  } catch (err) {
    console.error("[greenzone_today] Failed to load shadow snapshot", err);
    return null;
  }
}

/**
 * Try to pull race metadata from a flexible payload shape.
 */
function extractRaceMeta(body) {
  if (!body || typeof body !== "object") {
    return { track: null, raceNo: null, date: null };
  }

  const track =
    body.track ??
    body.Track ??
    body.raceTrack ??
    body?.race?.track ??
    body?.context?.track ??
    null;

  const raceNo =
    body.raceNo ??
    body.race_no ??
    body.raceNumber ??
    body?.race?.raceNo ??
    body?.context?.raceNo ??
    null;

  const date =
    body.date ??
    body.raceDate ??
    body?.race?.date ??
    body?.context?.date ??
    null;

  return { track, raceNo, date };
}

/**
 * Format a decimal (0–1) as a percent string like "46.4%".
 */
function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Hybrid GreenZone suggestion logic (Option C).
 *
 * Uses three kinds of signals:
 * 1. Strong Accuracy Edge
 * 2. Strong ROI Edge
 * 3. Consistent Advantage Across All Legs
 */
function generateSuggestions(stats) {
  if (!stats || !stats.legs) return [];

  const legs = stats.legs || {};
  const legNames = ["win", "place", "show"];

  const MIN_ROWS_STRONG_EDGE = 25; // for per-leg edges
  const MIN_ROWS_GLOBAL = 50; // for “across all legs” signal
  const DELTA_HIT_STRONG = 0.07; // +7% hit-rate edge
  const DELTA_ROI_STRONG = 0.05; // +5% ROI edge

  const suggestions = [];
  const legsWithGlobalAdvantage = [];

  for (const legName of legNames) {
    const leg = legs[legName];
    if (!leg || typeof leg !== "object") continue;

    const rows = leg.rows ?? leg.total_rows ?? 0;
    const hitShadow = leg.hit_rate_shadow;
    const hitOverall = leg.hit_rate_overall;
    const roiShadow = leg.roi_shadow;
    const roiOverall = leg.roi_overall;

    const hasHitRates =
      typeof hitShadow === "number" && typeof hitOverall === "number";
    const hasRoi =
      typeof roiShadow === "number" && typeof roiOverall === "number";

    // Track legs that have any advantage for the global “all legs” rule.
    if (
      rows >= MIN_ROWS_GLOBAL &&
      hasHitRates &&
      hitShadow > hitOverall
    ) {
      legsWithGlobalAdvantage.push(legName);
    }

    // --- 1. Strong Accuracy Edge ---
    if (rows >= MIN_ROWS_STRONG_EDGE && hasHitRates) {
      const deltaHit = hitShadow - hitOverall;

      if (deltaHit >= DELTA_HIT_STRONG) {
        const label = legName[0].toUpperCase() + legName.slice(1);
        suggestions.push(
          `[${label}] Shadow hit-rate edge +${formatPercent(
            deltaHit
          )} (${formatPercent(hitShadow)} vs ${formatPercent(
            hitOverall
          )}) over ${rows} rows — potential GreenZone accuracy edge.`
        );
      }
    }

    // --- 2. Strong ROI Edge ---
    if (hasRoi) {
      const deltaRoi = roiShadow - roiOverall;
      if (deltaRoi >= DELTA_ROI_STRONG) {
        const label = legName[0].toUpperCase() + legName.slice(1);
        suggestions.push(
          `[${label}] Shadow ROI advantage +${formatPercent(
            deltaRoi
          )} (${formatPercent(roiShadow)} vs ${formatPercent(
            roiOverall
          )}) — favorable profitability trend.`
        );
      }
    }
  }

  // --- 3. Consistent Advantage Across All Legs ---
  if (legsWithGlobalAdvantage.length === legNames.length) {
    suggestions.push(
      "Overall: Shadow strategy outperforms across Win / Place / Show with solid samples (≥ 50 rows each). This is a strong GreenZone environment."
    );
  }

  // If no meaningful edges, keep suggestions empty so the UI
  // can show the existing “Not enough data yet…” fallback.
  return suggestions;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      status: 405,
      error: "Method not allowed. Use POST.",
      race: { track: null, raceNo: null, date: null },
      shadowDecision: null,
      stats: null,
      suggestions: [],
    });
  }

  try {
    const body = req.body || {};
    const race = extractRaceMeta(body);
    const shadowDecision = body.shadowDecision ?? null;

    const snapshot = await loadShadowSnapshot();
    const stats = snapshot || null;
    const suggestions = generateSuggestions(stats);

    const responsePayload = {
      status: 200,
      error: null,
      race,
      shadowDecision,
      stats,
      suggestions,
    };

    console.log("[greenzone_today] response", {
      race,
      suggestionsCount: suggestions.length,
    });

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error("[greenzone_today] Unexpected error", err);
    return res.status(500).json({
      status: 500,
      error: "Internal server error",
      race: { track: null, raceNo: null, date: null },
      shadowDecision: null,
      stats: null,
      suggestions: [],
    });
  }
}
