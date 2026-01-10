// pages/api/verify_backfill.js
// Phase 2: real backfill runner that fans out to /api/verify_race.
//
// This endpoint is intentionally conservative:
// - Accepts POST JSON payloads from the Verify UI
// - Normalizes into one or more "race" requests
// - Optionally runs in dryRun mode (no HTTP calls)
// - Checks Redis to skip races that are already verified
// - Calls /api/verify_race for each race and aggregates results
// - Never throws; always returns HTTP 200 with structured JSON

export const config = {
  runtime: "nodejs",
};

// Import Redis helpers for skip logic
import { verifyLogExists, buildRaceId, buildVerifyKey } from "../../utils/finishline/backfill_helpers.js";

const DEFAULT_MAX_RACES = 10;
const HARD_MAX_RACES = 50;

function safeParseJson(maybeJson) {
  if (typeof maybeJson !== "string") return maybeJson;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function normalizeBody(req) {
  let body = req.body;

  if (!body && typeof req.body === "string") {
    body = safeParseJson(req.body);
  }

  if (typeof body === "string") {
    body = safeParseJson(body);
  }

  if (!body || typeof body !== "object") {
    body = {};
  }

  return body;
}

function coerceString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function resolveBaseUrl(req) {
  // Prefer explicit env overrides if present
  const fromEnv =
    process.env.FINISHLINE_VERIFY_BASE_URL ||
    process.env.NEXT_PUBLIC_FINISHLINE_VERIFY_BASE_URL;

  if (fromEnv && typeof fromEnv === "string") {
    return fromEnv.replace(/\/+$/, "");
  }

  // Fallback to host headers (works on Vercel + local dev)
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";

  if (!host) {
    // As a very last resort, assume localhost (dev)
    return "http://localhost:3000";
  }

  return `${proto}://${host}`;
}

function normalizeSingleRace(input, fallback = {}) {
  if (!input || typeof input !== "object") input = {};

  const track =
    coerceString(input.track) ||
    coerceString(input.trackName) ||
    coerceString(input.track_label) ||
    coerceString(fallback.track);

  const raceNo =
    coerceString(input.raceNo) ||
    coerceString(input.race) ||
    coerceString(input.raceNumber) ||
    coerceString(input.raceNum) ||
    coerceString(fallback.raceNo);

  // We try to keep both dateRaw and dateIso if the caller provides them.
  const dateRaw =
    coerceString(input.dateRaw) ||
    coerceString(input.date) ||
    coerceString(fallback.dateRaw) ||
    coerceString(fallback.date);

  const dateIso =
    coerceString(input.dateIso) ||
    coerceString(fallback.dateIso) ||
    dateRaw;

  if (!track || !raceNo || !dateIso) {
    return null;
  }

  return {
    track,
    raceNo,
    date: dateIso,
    dateIso,
    dateRaw: dateRaw || dateIso,
  };
}

/**
 * Extracts an array of race descriptors from the request body.
 * Supports several shapes to stay compatible with current / future UI:
 *
 * 1) { track, raceNo, date, dateIso, dateRaw, ... }
 * 2) { request: { ...same fields... } }
 * 3) { races: [ { track, raceNo, date... }, ... ] }
 */
function extractRacesFromBody(body, maxRaces) {
  const races = [];
  // Try both top-level fields and a nested "ctx" object (for future-proofing).
  const ctx = body.ctx && typeof body.ctx === "object" ? body.ctx : {};

  const fallback = {
    track:
      coerceString(body.track) ||
      coerceString(body.trackName) ||
      coerceString(ctx.track) ||
      coerceString(ctx.trackName),
    raceNo:
      coerceString(body.raceNo || body.race) ||
      coerceString(body.raceNumber) ||
      coerceString(body.raceNum) ||
      coerceString(ctx.raceNo || ctx.race) ||
      coerceString(ctx.raceNumber) ||
      coerceString(ctx.raceNum),
    dateRaw:
      coerceString(body.dateRaw || body.date) ||
      coerceString(ctx.dateRaw || ctx.date),
    dateIso:
      coerceString(body.dateIso) ||
      coerceString(ctx.dateIso),
  };

  if (Array.isArray(body.races)) {
    for (const r of body.races) {
      const normalized = normalizeSingleRace(r, fallback);
      if (normalized) races.push(normalized);
      if (races.length >= maxRaces) break;
    }
  } else if (body.request && typeof body.request === "object") {
    const normalized = normalizeSingleRace(body.request, fallback);
    if (normalized) races.push(normalized);
  } else {
    const normalized = normalizeSingleRace(body, fallback);
    if (normalized) races.push(normalized);
  }

  // Extra defensive path: if we still have no races but there is a nested
  // "request" inside something like { ctx: { request: {...} } }, try that too.
  if (!races.length && ctx.request && typeof ctx.request === "object") {
    const normalized = normalizeSingleRace(ctx.request, fallback);
    if (normalized) races.push(normalized);
  }

  // De-duplicate by simple key
  const seen = new Set();
  const unique = [];
  for (const r of races) {
    const key = `${r.track}|${r.dateIso}|${r.raceNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
    if (unique.length >= maxRaces) break;
  }

  return unique;
}

async function callVerifyRace(baseUrl, race) {
  const url = `${baseUrl}/api/verify_race`;

  const payload = {
    track: race.track,
    raceNo: race.raceNo,
    date: race.date,
    dateIso: race.dateIso,
    dateRaw: race.dateRaw,
  };

  // Get internal job secret for server-to-server PayGate bypass
  const internalSecret = process.env.INTERNAL_JOB_SECRET || '';
  const headers = {
    "Content-Type": "application/json",
    "x-finishline-internal": "true", // System flag to bypass PayGate for internal batch jobs
  };

  // Only include secret header if env var is set (otherwise PayGate will be enforced)
  if (internalSecret) {
    headers["x-finishline-internal-secret"] = internalSecret;
  } else {
    console.warn('[verify_backfill] INTERNAL_JOB_SECRET not set - PayGate will be enforced for verify_race calls');
  }

  let responseJson = null;
  let httpStatus = 0;
  let networkError = null;
  let error = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    httpStatus = res.status;

    try {
      responseJson = await res.json();
      // Extract error details from response JSON (even if httpStatus is 200, responseJson.ok might be false)
      if (responseJson && typeof responseJson === "object") {
        error = responseJson.error || responseJson.message || null;
        // Note: responseJson.httpStatus (e.g., HRN 403) is for informational visibility only
        // Do NOT override actual HTTP status - preserve it for success determination
      }
    } catch {
      responseJson = null;
    }
  } catch (err) {
    networkError =
      err && typeof err.message === "string"
        ? err.message
        : String(err || "Unknown error");
  }

  // Success criteria: verify_race returned ok === true
  // Hits (winHit/placeHit/showHit), outcome accuracy, ROI, etc. are analytics only and do NOT affect success/failure
  // A verification is successful if the API call succeeded (HTTP 200) AND verify_race.ok === true
  const verifyRaceOk = responseJson && typeof responseJson === "object" && responseJson.ok === true;
  const ok = !networkError && httpStatus === 200 && verifyRaceOk;
  
  // For visibility: include responseJson.httpStatus if present (e.g., HRN 403), but don't use for success check
  const responseHttpStatus = (responseJson && typeof responseJson === "object" && typeof responseJson.httpStatus === "number") 
    ? responseJson.httpStatus 
    : null;

  return {
    race,
    ok, // Based solely on verify_race.ok === true (hits are analytics only)
    httpStatus, // Actual HTTP status from fetch response (preserved for success check)
    responseHttpStatus, // Optional: responseJson.httpStatus for visibility (e.g., HRN 403) - analytics only
    networkError,
    error: error || networkError || null,
    step: responseJson?.step || null,
    outcome: responseJson?.outcome || null,
    hits: responseJson?.hits || null, // Analytics only - do NOT use for success/failure
    raw: responseJson || null,
    bypassedPayGate: responseJson?.bypassedPayGate || responseJson?.responseMeta?.bypassedPayGate || false,
    verifyRaceOk: verifyRaceOk, // Explicit flag: verify_race.ok === true (for debugging)
  };
}

export default async function handler(req, res) {
  // Server-side PayGate check (non-blocking in monitor mode)
  try {
    const { checkPayGateAccess } = await import('../../lib/paygate-server.js');
    const accessCheck = checkPayGateAccess(req);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        ok: false,
        error: 'PayGate locked',
        message: 'Premium access required. Please unlock to continue.',
        code: 'paygate_locked',
        reason: accessCheck.reason
      });
    }
  } catch (paygateErr) {
    // Non-fatal: log but allow request (fail-open for safety)
    console.warn('[verify_backfill] PayGate check failed (non-fatal):', paygateErr?.message);
  }
  if (req.method !== "POST") {
    // We stay nice and return 200 with a descriptive message instead of 405,
    // to keep the UI simple and avoid surprises.
    return res.status(200).json({
      ok: false,
      step: "verify_backfill",
      mode: "invalid_method",
      message: "verify_backfill expects POST with JSON body",
      method: req.method || null,
    });
  }

  const body = normalizeBody(req);

  const maxRacesRaw =
    typeof body.maxRaces === "number" ? body.maxRaces : DEFAULT_MAX_RACES;
  const maxRaces = Math.min(
    Math.max(1, maxRacesRaw || DEFAULT_MAX_RACES),
    HARD_MAX_RACES
  );

  const dryRun =
    body.dryRun === true ||
    body.mode === "dryRun" ||
    body.dry_run === true;

  const races = extractRacesFromBody(body, maxRaces);

  if (!races.length) {
    // Debug payload so we can see what the UI actually sent.
    let bodyForDebug = normalizeBody(req);
    let bodySample = null;
    let bodyKeys = [];

    try {
      if (bodyForDebug && typeof bodyForDebug === "object") {
        bodyKeys = Object.keys(bodyForDebug);
        bodySample = JSON.stringify(bodyForDebug).slice(0, 1000);
      } else if (typeof bodyForDebug === "string") {
        bodySample = bodyForDebug.slice(0, 1000);
      }
    } catch {
      bodySample = "[unserializable body]";
    }

    return res.status(200).json({
      ok: false,
      step: "verify_backfill",
      mode: dryRun ? "dryRun" : "live",
      message: "No valid races found in request body",
      count: 0,
      successes: 0,
      failures: 0,
      results: [],
      debug: {
        bodyKeys,
        bodySample,
      },
    });
  }

  const baseUrl = resolveBaseUrl(req);
  const results = [];

  if (dryRun) {
    for (const race of races) {
      results.push({
        race,
        ok: true,
        skipped: true,
        dryRun: true,
      });
    }
  } else {
    // Helper to normalize date to YYYY-MM-DD format (matches buildRaceId in backfill_helpers.js)
    function normalizeDateToIso(dateStr) {
      if (!dateStr) return "";
      const s = String(dateStr).trim();
      
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
      
      // Try parsing as Date (last resort, but be defensive)
      try {
        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().slice(0, 10);
        }
      } catch {}
      
      // If we can't normalize, return empty string (will cause buildRaceId to handle it)
      return "";
    }

    // Check Redis for existing verify logs before calling /api/verify_race
    for (const race of races) {
      let shouldSkip = false;
      let skipReason = null;
      let verifiedRedisKeyChecked = null;
      let verifiedRedisKeyExists = false;
      let raceIdDerived = null;

      try {
        // Normalize date to YYYY-MM-DD format (CRITICAL: must match buildRaceId normalization)
        const normalizedDate = normalizeDateToIso(race.dateIso || race.date);
        
        // Build raceId using the same logic as verify_race.js buildVerifyRaceId
        // This ensures exact same normalization as verify_race uses when writing keys
        raceIdDerived = buildRaceId(race.track, normalizedDate, race.raceNo);
        
        // Build the Redis key (format: fl:verify:{raceId})
        // raceId format: track-date-unknown-r{raceNo} (includes raceNo to prevent collisions)
        verifiedRedisKeyChecked = buildVerifyKey(raceIdDerived);
        
        // Check if this race already has a verify log in Redis
        // IMPORTANT: Pass normalized date to ensure key matches exactly
        const exists = await verifyLogExists({
          track: race.track,
          date: normalizedDate, // Use normalized date
          dateIso: normalizedDate,
          dateRaw: race.dateRaw,
          raceNo: race.raceNo,
        });
        
        verifiedRedisKeyExists = exists;

        if (exists) {
          shouldSkip = true;
          skipReason = "already_verified_in_redis";
        }
      } catch (err) {
        // If Redis check fails, log warning but proceed with verify call
        console.warn("[verify_backfill] Redis check failed, proceeding without skip:", err.message);
        // Continue to call verify_race as normal
      }

      if (shouldSkip) {
        // Skip calling /api/verify_race - race already verified
        results.push({
          race,
          ok: true,
          skipped: true,
          skipReason,
          httpStatus: null,
          step: "verify_backfill_skip",
          outcome: null,
          hits: null,
          networkError: null,
          // Debug fields for skip verification (safe to expose)
          verifiedRedisKeyChecked: verifiedRedisKeyChecked || null,
          verifiedRedisKeyExists: verifiedRedisKeyExists,
          raceIdDerived: raceIdDerived || null,
        });
      } else {
        // Call /api/verify_race as normal (it will write to Redis)
        // Wrap in try/catch to ensure one race failure doesn't break the batch
        try {
          const result = await callVerifyRace(baseUrl, race);
          // Add debug fields even for non-skipped results (for troubleshooting)
          if (raceIdDerived || verifiedRedisKeyChecked) {
            result.raceIdDerived = raceIdDerived || null;
            result.verifiedRedisKeyChecked = verifiedRedisKeyChecked || null;
            result.verifiedRedisKeyExists = verifiedRedisKeyExists;
          }
          results.push(result);
        } catch (err) {
          // If callVerifyRace itself throws (shouldn't happen, but be defensive), log and continue
          console.error(`[verify_backfill] Error calling verify_race for race ${race.track} ${race.dateIso} ${race.raceNo}:`, err);
          results.push({
            race,
            ok: false,
            httpStatus: 0,
            networkError: err?.message || String(err || "Unknown error"),
            error: err?.message || String(err || "Unknown error"),
            step: "verify_backfill_error",
            outcome: null,
            hits: null,
            raw: null,
          });
        }
      }
    }
  }

  // Success = verify_race returned ok === true (hits are analytics only, not failure conditions)
  // A race is successful if the verify_race API call succeeded and returned ok: true
  const successes = results.filter((r) => r.ok && !r.skipped).length;
  // Failures = verify_race call failed OR returned ok !== true (excluding network errors and skipped)
  const failures = results.filter(
    (r) => !r.ok && !r.skipped && !r.networkError
  ).length;
  const networkFailures = results.filter((r) => !!r.networkError).length;
  const skipped = results.filter((r) => !!r.skipped && !r.dryRun).length;
  const processed = results.filter((r) => !r.skipped || r.dryRun).length;

  // Keep the response payload modest; include a small sample of raw results.
  // Note: hits, outcome, ROI are included for analytics but do NOT affect ok/success determination
  // Success is based solely on verify_race.ok === true
  const sampleSize = 10;
  const sample = results.slice(0, sampleSize).map((r) => ({
    race: r.race,
    ok: r.ok, // Based solely on verify_race.ok === true (hits are analytics only)
    skipped: !!r.skipped,
    skipReason: r.skipReason || null,
    httpStatus: r.httpStatus, // Actual HTTP status from fetch
    responseHttpStatus: r.responseHttpStatus || null, // Optional: responseJson.httpStatus for visibility
    step: r.step,
    outcome: r.outcome, // Analytics only
    hits: r.hits, // Analytics only - do NOT use for success/failure
    networkError: r.networkError || null,
    error: r.error || null, // Include structured error from verify_race
    bypassedPayGate: r.bypassedPayGate || false,
    verifyRaceOk: r.verifyRaceOk !== undefined ? r.verifyRaceOk : null, // Debug: verify_race.ok value
    // Debug fields for skip verification (safe to expose - no secrets)
    verifiedRedisKeyChecked: r.verifiedRedisKeyChecked || null,
    verifiedRedisKeyExists: r.verifiedRedisKeyExists !== undefined ? r.verifiedRedisKeyExists : null,
    raceIdDerived: r.raceIdDerived || null,
  }));

  // Check if any race bypassed PayGate (for debug visibility)
  const anyBypassedPayGate = results.some(r => r.bypassedPayGate === true);

  // Always return HTTP 200 (never hard-fail the batch)
  // Let UI decide based on ok flag and failures count
  // ok = true if all races succeeded, false if any failed (but still return 200)
  return res.status(200).json({
    ok: failures === 0 && networkFailures === 0,
    step: "verify_backfill",
    mode: dryRun ? "dryRun" : "live",
    baseUrl,
    count: races.length,
    successes,
    failures,
    networkFailures,
    skipped,
    processed,
    sampleLimit: sampleSize,
    results: sample,
    // Include first failure details for UI error display
    firstFailure: failures > 0 || networkFailures > 0 ? (results.find(r => !r.ok && !r.skipped) || null) : null,
    // Debug: show if PayGate was bypassed for internal batch jobs
    bypassedPayGate: anyBypassedPayGate,
  });
}
