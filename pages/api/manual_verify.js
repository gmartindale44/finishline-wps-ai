// pages/api/manual_verify.js
// Manual outcome entry endpoint - allows entering Win/Place/Show manually
// Writes to Redis using the same structure as verify_race for calibration/GreenZone compatibility

export const config = {
  runtime: "nodejs",
};

// Import shared helpers from verify_race
// We'll reuse the same logging and helpers to ensure compatibility
import { Redis } from "@upstash/redis";
import { hgetall } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";
import { computeGreenZoneForRace } from "../../lib/greenzone/greenzone_v1.js";

const VERIFY_PREFIX = "fl:verify:";
const PRED_PREFIX = "fl:pred:";

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error("[manual_verify] Failed to init Redis client", error);
      redisClient = null;
    }
  }
  return redisClient;
}

/**
 * Build a race ID for verify logs (same as verify_race)
 */
function buildVerifyRaceId(track, date, raceNo) {
  const slugTrack = (track || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  let slugDate = date || "";
  if (!slugDate || !/^\d{4}-\d{2}-\d{2}$/.test(slugDate)) {
    slugDate = "";
  }

  const slugRaceNo = String(raceNo || "").trim() || "0";
  const parts = [slugTrack, slugDate, "unknown", `r${slugRaceNo}`].filter(Boolean);
  return parts.join("-");
}

/**
 * Canonicalize date to YYYY-MM-DD format (same logic as verify_race)
 */
function canonicalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Already ISO (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // MM/DD/YYYY -> YYYY-MM-DD
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

/**
 * Normalize prediction object (same as verify_race)
 */
function normalizePrediction(predicted) {
  if (!predicted || typeof predicted !== "object") {
    return { win: "", place: "", show: "" };
  }
  const win = typeof predicted.win === "string" ? predicted.win.trim() : "";
  const place = typeof predicted.place === "string" ? predicted.place.trim() : "";
  const show = typeof predicted.show === "string" ? predicted.show.trim() : "";
  return { win, place, show };
}

/**
 * Normalize horse name for comparison (same as verify_race)
 */
function normalizeHorseName(name) {
  return (name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Compute hits from predicted vs outcome (same logic as verify_race)
 */
function computeHits(predicted, outcome) {
  const norm = normalizeHorseName;
  const pWin = norm(predicted.win);
  const pPlace = norm(predicted.place);
  const pShow = norm(predicted.show);
  const oWin = norm(outcome.win);
  const oPlace = norm(outcome.place);
  const oShow = norm(outcome.show);

  const winHit = !!pWin && !!oWin && pWin === oWin;
  const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
  const showHit = !!pShow && !!oShow && pShow === oShow;

  // Top3Hit: any predicted horse is in the top 3 outcome positions
  const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
  const top3Hit = [pWin, pPlace, pShow]
    .filter(Boolean)
    .some((name) => top3Set.has(name));

  return {
    winHit,
    placeHit,
    showHit,
    top3Hit,
  };
}

/**
 * Fetch prediction log from Redis for a specific race
 */
async function fetchPredictionLog(track, dateIso, raceNo) {
  try {
    // Try multiple possible key patterns
    const patterns = [
      slugRaceId({ track, date: dateIso, postTime: "unknown", raceNo }),
      slugRaceId({ track, date: dateIso, postTime: "", raceNo }),
    ];

    for (const raceId of patterns) {
      const key = `${PRED_PREFIX}${raceId}`;
      const hash = await hgetall(key);
      if (hash && Object.keys(hash).length > 0) {
        // Parse predicted picks from picks field (JSON string)
        let predicted = { win: "", place: "", show: "" };
        try {
          const picksStr = hash.picks || "{}";
          const picks = typeof picksStr === "string" ? JSON.parse(picksStr) : picksStr;
          predicted = {
            win: picks.win || "",
            place: picks.place || "",
            show: picks.show || "",
          };
        } catch {
          // picks might not be parseable, that's ok
        }

        const confRaw = parseFloat(hash.confidence || "0") || 0;
        const confidence = confRaw <= 1 ? confRaw * 100 : confRaw;
        const t3Raw = parseFloat(hash.top3_mass || "0") || 0;
        const top3Mass = t3Raw <= 1 ? t3Raw * 100 : t3Raw;

        return {
          predicted,
          confidence: Number.isFinite(confidence) && confidence > 0 ? confidence : null,
          top3Mass: Number.isFinite(top3Mass) && top3Mass > 0 ? top3Mass : null,
        };
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Log verify result to Redis (reuse same structure as verify_race)
 */
async function logVerifyResult(result) {
  if (!result) return;

  const redis = getRedis();
  if (!redis) return;

  try {
    const { track, date, raceNo } = result;
    const raceId = buildVerifyRaceId(track, date, raceNo);

    const logPayload = {
      raceId,
      track: track || "",
      date: date || "",
      dateIso: date || "",
      raceNo: raceNo || "",
      query: result.query || "",
      top: result.top || null,
      outcome: result.outcome || { win: "", place: "", show: "" },
      predicted: result.predicted || { win: "", place: "", show: "" },
      hits: result.hits || {
        winHit: false,
        placeHit: false,
        showHit: false,
        top3Hit: false,
      },
      summary: result.summary || "",
      ok: result.ok === true,
      step: result.step || "",
      debug: {
        ...(result.debug || {}),
        canonicalDateIso: date || "",
      },
      ts: Date.now(),
    };

    const logKey = `${VERIFY_PREFIX}${raceId}`;
    await redis.set(logKey, JSON.stringify(logPayload));
  } catch (err) {
    console.error("[manual_verify] Failed to log verify result", err);
  }
}

/**
 * Build summary text for manual verify
 */
function buildManualSummary({ date, dateRaw, outcome, predicted, hits }) {
  const lines = [];
  
  if (dateRaw && dateRaw !== date) {
    lines.push(`UI date: ${dateRaw}`);
  }
  if (date) {
    lines.push(`Using date: ${date}`);
  }
  
  lines.push("Outcome (manual entry):");
  lines.push(`  Win: ${outcome.win || "-"}`);
  lines.push(`  Place: ${outcome.place || "-"}`);
  lines.push(`  Show: ${outcome.show || "-"}`);
  
  if (predicted && (predicted.win || predicted.place || predicted.show)) {
    const predParts = [predicted.win, predicted.place, predicted.show].filter(Boolean);
    if (predParts.length) {
      lines.push(`Predicted: ${predParts.join(" / ")}`);
    }
  }
  
  const hitParts = [];
  if (hits.winHit) hitParts.push("winHit");
  if (hits.placeHit) hitParts.push("placeHit");
  if (hits.showHit) hitParts.push("showHit");
  if (hits.top3Hit) hitParts.push("top3Hit");
  lines.push(`Hits: ${hitParts.length ? hitParts.join(", ") : "(none)"}`);
  
  return lines.join("\n");
}

/**
 * Safely parse request body
 */
function safeParseBody(req) {
  return new Promise((resolve) => {
    try {
      if (req.body && typeof req.body === "object") {
        return resolve(req.body);
      }
    } catch {
      // ignore and fall through
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const out = {};
        for (const part of raw.split("&")) {
          const [k, v] = part.split("=");
          if (!k) continue;
          out[decodeURIComponent(k)] = decodeURIComponent(v || "");
        }
        resolve(out);
      }
    });
  });
}

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      step: "manual_verify",
      error: "METHOD_NOT_ALLOWED",
      message: `Expected POST, received ${req.method}`,
    });
  }

  try {
    const body = await safeParseBody(req);

    // Extract and validate required fields
    const track = (body.track || body.trackName || "").trim();
    const raceNo = (body.raceNo || body.race || "").toString().trim();
    const outcome = body.outcome || {};

    if (!track) {
      return res.status(200).json({
        ok: false,
        step: "manual_verify",
        error: "missing_track",
        message: "Track is required",
      });
    }

    if (!raceNo) {
      return res.status(200).json({
        ok: false,
        step: "manual_verify",
        error: "missing_race_no",
        message: "Race number is required",
      });
    }

    // Require at least win + place
    const win = (outcome.win || "").trim();
    const place = (outcome.place || "").trim();
    const show = (outcome.show || "").trim();

    if (!win || !place) {
      return res.status(200).json({
        ok: false,
        step: "manual_verify",
        error: "missing_outcome",
        message: "Outcome must include at least Win and Place",
      });
    }

    // Canonicalize date
    const dateRaw = body.dateRaw || body.date || body.dateIso || null;
    const dateIso = canonicalizeDate(body.dateIso || body.date || dateRaw);

    if (!dateIso) {
      return res.status(200).json({
        ok: false,
        step: "manual_verify",
        error: "invalid_date",
        message: "Date must be in YYYY-MM-DD or MM/DD/YYYY format",
      });
    }

    // Normalize outcome
    const normalizedOutcome = {
      win,
      place: place || "",
      show: show || "",
    };

    // Get predicted (priority: body.predicted > fetch from Redis > empty)
    let predicted = normalizePrediction(body.predicted || {});
    let confidence = body.confidence || null;
    let top3Mass = body.top3Mass || body.top3_mass || null;

    // Try to fetch from Redis if not provided
    if (!predicted.win && !predicted.place && !predicted.show) {
      const predLog = await fetchPredictionLog(track, dateIso, raceNo);
      if (predLog) {
        predicted = normalizePrediction(predLog.predicted || {});
        confidence = predLog.confidence || confidence;
        top3Mass = predLog.top3Mass || top3Mass;
      }
    }

    // Compute hits
    const hits = computeHits(predicted, normalizedOutcome);

    // Build summary
    const summary = buildManualSummary({
      date: dateIso,
      dateRaw: dateRaw || dateIso,
      outcome: normalizedOutcome,
      predicted,
      hits,
    });

    // Build result object (matching verify_race structure)
    const raceId = buildVerifyRaceId(track, dateIso, raceNo);
    const result = {
      raceId,
      track,
      date: dateIso,
      dateIso: dateIso,
      raceNo,
      outcome: normalizedOutcome,
      predicted,
      hits,
      summary,
      ok: true,
      step: "manual_verify",
      debug: {
        source: "manual",
        manualProvider: body.provider || "manual",
        uiDateRaw: dateRaw || dateIso,
        confidence: confidence || null,
        top3Mass: top3Mass || null,
      },
      ts: Date.now(),
    };

    // Log to Redis (same structure as verify_race)
    await logVerifyResult(result);

    // Compute GreenZone (safe, never throws)
    let greenZone = { enabled: false };
    try {
      const raceCtx = {
        track,
        raceNo,
        dateIso,
        predicted,
        outcome: normalizedOutcome,
      };
      greenZone = await computeGreenZoneForRace(raceCtx);
    } catch (error) {
      console.warn("[manual_verify] GreenZone computation failed:", error?.message || error);
    }

    // Return response (matching verify_race format)
    return res.status(200).json({
      ok: true,
      step: "manual_verify",
      date: dateIso,
      track,
      raceNo,
      outcome: normalizedOutcome,
      predicted,
      hits,
      summary,
      raceId,
      greenZone: greenZone || { enabled: false },
      debug: result.debug,
    });
  } catch (error) {
    console.error("[manual_verify] Unexpected error:", error);
    return res.status(200).json({
      ok: false,
      step: "manual_verify",
      error: "internal_error",
      message: error?.message || String(error),
    });
  }
}

