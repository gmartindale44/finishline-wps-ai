// api/greenzone_today.js
// GreenZone v1 — shadow-based suggestions (stub endpoint)
//
// v0 goal:
// - Stop the 404s from the UI
// - Echo back basic race/meta info
// - Attach shadow snapshot stats from data/shadow_snapshot_v1.json
// - Leave "suggestions" empty for now (we'll fill this in later)

import fs from "node:fs";
import path from "node:path";

export const config = { runtime: 'nodejs' };

let cachedShadowSnapshot = null;

function loadShadowSnapshot() {
  if (cachedShadowSnapshot) return cachedShadowSnapshot;

  const snapshotPath = path.join(
    process.cwd(),
    "data",
    "shadow_snapshot_v1.json"
  );

  try {
    const raw = fs.readFileSync(snapshotPath, "utf8");
    cachedShadowSnapshot = JSON.parse(raw);
  } catch (err) {
    console.error("[greenzone_today] Failed to load shadow snapshot:", err);
    cachedShadowSnapshot = null;
  }

  return cachedShadowSnapshot;
}

export default async function handler(req, res) {
  console.log("[greenzone_today] incoming request", { method: req.method });

  if (req.method !== "POST") {
    return res.status(405).json({
      status: 405,
      error: "Method not allowed. Use POST.",
      suggestions: [],
    });
  }

  const body = req.body || {};

  // Try to pull basic race metadata out of flexible payloads
  const meta = body.meta || body.race || {};
  const track =
    meta.track || body.track || body.Track || body.trackName || null;
  const raceNo =
    meta.raceNo ??
    meta.race_no ??
    body.raceNo ??
    body.race_no ??
    body.raceNumber ??
    null;
  const date =
    meta.date || body.date || body.raceDate || body.uiDate || null;

  // If the upstream (verify) already computed a shadowDecision object, pass it through
  const shadowDecision =
    body.shadowDecision || body.shadow_decision || null;

  const snapshot = loadShadowSnapshot();

  const response = {
    status: 200,
    error: null,
    race: {
      track,
      raceNo,
      date,
    },
    shadowDecision,
    stats: snapshot
      ? {
          strategyName: snapshot.strategyName,
          version: snapshot.version,
          rows: snapshot.rows,
          legs: snapshot.legs,
        }
      : null,
    suggestions: [],
  };

  return res.status(200).json(response);
}

