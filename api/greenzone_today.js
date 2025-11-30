// api/greenzone_today.js
import fs from "node:fs/promises";
import path from "node:path";

export const config = {
  runtime: "nodejs",
};

// Simple in-memory cache for the snapshot
let cachedSnapshot = null;
let cachedSnapshotMtime = null;

async function loadShadowSnapshot() {
  try {
    const dataPath = path.join(process.cwd(), "data", "shadow_snapshot_v1.json");
    const stats = await fs.stat(dataPath);

    // Reload only if file changed
    if (!cachedSnapshot || !cachedSnapshotMtime || stats.mtimeMs !== cachedSnapshotMtime) {
      const raw = await fs.readFile(dataPath, "utf8");
      cachedSnapshot = JSON.parse(raw);
      cachedSnapshotMtime = stats.mtimeMs;
      console.log("[greenzone_today] Loaded shadow snapshot");
    }

    return cachedSnapshot;
  } catch (err) {
    console.error("[greenzone_today] Failed to load shadow snapshot:", err);
    return null;
  }
}

function extractRaceMeta(req) {
  const method = (req.method || "GET").toUpperCase();
  const source = method === "GET" ? req.query : (req.body || {});

  const track =
    source.track ||
    source.Track ||
    source.trackName ||
    null;

  const raceNo =
    source.raceNo ||
    source.race ||
    source.race_number ||
    null;

  const date =
    source.date ||
    source.raceDate ||
    source.race_date ||
    null;

  const shadowDecision =
    source.shadowDecision ||
    source.decision ||
    null;

  return {
    race: {
      track: track ? String(track) : null,
      raceNo: raceNo != null ? String(raceNo) : null,
      date: date ? String(date) : null,
    },
    shadowDecision: shadowDecision || null,
  };
}

export default async function handler(req, res) {
  const method = (req.method || "GET").toUpperCase();

  // Allow both GET (current UI) and POST (future)
  if (method !== "GET" && method !== "POST") {
    return res.status(405).json({
      status: 405,
      error: "Method not allowed. Use GET or POST.",
      suggestions: [],
    });
  }

  try {
    const { race, shadowDecision } = extractRaceMeta(req);
    const snapshot = await loadShadowSnapshot();

    return res.status(200).json({
      status: 200,
      error: null,
      race,
      shadowDecision,
      stats: snapshot,
      suggestions: [],
    });
  } catch (err) {
    console.error("[greenzone_today] Unexpected error:", err);
    return res.status(500).json({
      status: 500,
      error: "Internal error in greenzone_today",
      suggestions: [],
    });
  }
}
