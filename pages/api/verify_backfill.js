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
import { verifyLogExists, buildVerifyKey, getRedis } from "../../utils/finishline/backfill_helpers.js";
// Import centralized normalization (ensures exact match with verify_race.js)
import { buildVerifyRaceId, normalizeTrack, normalizeRaceNo, normalizeDateToIso, normalizeSurface } from "../../lib/verify_normalize.js";

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
  // Check for force override query param (testing only - bypasses skip check)
  const forceOverride = req.query?.force === '1' || req.query?.force === 'true' || req.query?.force === true;
  
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
    // Check Redis for existing verify logs before calling /api/verify_race
    for (const race of races) {
      let shouldSkip = false;
      let skipReason = null;
      let verifiedRedisKeyChecked = null;
      let verifiedRedisKeyExists = false;
      let verifiedRedisKeyType = null;
      let verifiedRedisKeyValuePreview = null;
      let raceIdDerived = null;
      let normalization = null;
      let existingVerifyParsedOk = false;
      let existingVerifyOkField = null;
      let existingVerifySnippet = null;
      let existingVerifyParsed = null; // Store full parsed object for structured preview

      try {
        // Store input values for debug
        const trackIn = race.track || "";
        const raceNoIn = race.raceNo || "";
        const dateIn = race.dateIso || race.date || "";
        const surfaceIn = race.surface || null;
        
        // Normalize using centralized helpers (CRITICAL: must match verify_race.js exactly)
        const normalizedDate = normalizeDateToIso(dateIn);
        const trackSlug = normalizeTrack(trackIn);
        const raceNoNormalized = normalizeRaceNo(raceNoIn);
        const surfaceSlug = normalizeSurface(surfaceIn || "unknown");
        
        // Build raceId using centralized function (same as verify_race.js)
        raceIdDerived = buildVerifyRaceId(trackIn, dateIn, raceNoIn, surfaceIn || "unknown");
        
        // Build the Redis key (format: fl:verify:{raceId})
        verifiedRedisKeyChecked = buildVerifyKey(raceIdDerived);
        
        // Normalization debug object (always included)
        normalization = {
          trackIn,
          trackSlug,
          raceNoIn,
          raceNoNormalized,
          dateIn,
          dateIso: normalizedDate,
          surfaceIn: surfaceIn || null,
          surfaceSlug,
        };
        
        // Check if this race already has a verify log in Redis (EXACT key lookup, no wildcards)
        const checkResult = await verifyLogExists({
          track: trackIn,
          date: dateIn, // verifyLogExists will normalize internally using same helpers
          dateIso: normalizedDate,
          dateRaw: race.dateRaw,
          raceNo: raceNoIn,
          surface: surfaceIn,
        });
        
        verifiedRedisKeyExists = checkResult.exists || false;
        verifiedRedisKeyType = checkResult.type || null;
        
        // If checkResult.key differs from our computed key, use the one from checkResult (for debugging)
        if (checkResult.key && checkResult.key !== verifiedRedisKeyChecked) {
          console.warn(`[verify_backfill] Key mismatch: computed=${verifiedRedisKeyChecked}, checkResult=${checkResult.key}`);
          verifiedRedisKeyChecked = checkResult.key; // Use the actual key that was checked
        }
        
        // Read the stored value and check if it's a valid verified result (ok === true)
        if (verifiedRedisKeyExists && verifiedRedisKeyChecked) {
          try {
            const redis = getRedis();
            if (redis) {
              const actualType = await redis.type(verifiedRedisKeyChecked);
              verifiedRedisKeyType = actualType || null;
              
              let rawValue = null;
              let parsedValue = null;
              
              if (actualType === "string") {
                const value = await redis.get(verifiedRedisKeyChecked);
                // Upstash SDK may auto-parse JSON, so check if it's already an object
                if (value != null) {
                  if (typeof value === "object" && !Array.isArray(value) && value.constructor === Object) {
                    // Already parsed object - use directly
                    parsedValue = value;
                    try {
                      rawValue = JSON.stringify(value);
                    } catch {
                      rawValue = String(value);
                    }
                  } else if (typeof value === "string") {
                    // Still a string - need to parse
                    rawValue = value;
                    try {
                      parsedValue = JSON.parse(value);
                    } catch {
                      // Not valid JSON - will treat as unparseable
                    }
                  } else {
                    // Other type (number, boolean, etc.) - stringify for snippet
                    rawValue = String(value);
                  }
                }
              } else if (actualType === "hash") {
                // For hash type, convert to JSON string for parsing
                const hash = await redis.hgetall(verifiedRedisKeyChecked);
                if (hash && Object.keys(hash).length > 0) {
                  rawValue = JSON.stringify(hash);
                  // Try to reconstruct object from hash fields
                  try {
                    const reconstructed = {};
                    for (const [k, v] of Object.entries(hash)) {
                      if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
                        try {
                          reconstructed[k] = JSON.parse(v);
                        } catch {
                          reconstructed[k] = v;
                        }
                      } else {
                        reconstructed[k] = v;
                      }
                    }
                    parsedValue = reconstructed;
                  } catch {
                    // Use hash as-is
                    parsedValue = hash;
                  }
                }
              }
              
              if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
                // Successfully parsed (or already was an object)
                existingVerifyParsedOk = true;
                existingVerifyParsed = parsedValue; // Store full parsed object
                existingVerifyOkField = parsedValue.ok === true;
                
                // Ensure rawValue/snippet is set for debug output
                if (!rawValue) {
                  try {
                    rawValue = JSON.stringify(parsedValue);
                  } catch {
                    rawValue = String(parsedValue);
                  }
                }
                existingVerifySnippet = rawValue ? String(rawValue).slice(0, 160) : null;
                
                // Only skip if parsed successfully AND ok === true
                // If parse fails or ok !== true, we should re-verify
                if (existingVerifyOkField && !forceOverride) {
                  shouldSkip = true;
                  skipReason = "already_verified_in_redis";
                }
              } else {
                // Parse failed or value was not an object - treat as not verified, proceed with verification
                existingVerifyParsedOk = false;
                existingVerifyParsed = null;
                existingVerifyOkField = null;
                if (rawValue) {
                  existingVerifySnippet = String(rawValue).slice(0, 160);
                  console.warn('[verify_backfill] Stored value not valid JSON or not an object, will re-verify. Raw snippet:', existingVerifySnippet);
                }
              }
            }
          } catch (readErr) {
            // Non-fatal: just log, don't expose error, proceed with verification
            console.warn('[verify_backfill] Failed to read Redis value, will re-verify:', readErr?.message);
          }
        }
      } catch (err) {
        // If Redis check fails, log warning but proceed with verify call
        console.warn("[verify_backfill] Redis check failed, proceeding without skip:", err.message);
        // Continue to call verify_race as normal (normalization still populated for debug)
      }

      if (shouldSkip) {
        // Skip calling /api/verify_race - race already verified (ok === true in stored value)
        // Build structured preview for verifyKeyValuePreview (matching debug_redis_keys format)
        let structuredPreview = null;
        if (existingVerifyParsed && typeof existingVerifyParsed === "object") {
          // Use the parsed object to build structured preview
          structuredPreview = {
            parsedOk: true,
            ok: existingVerifyParsed.ok ?? null,
            step: existingVerifyParsed.step ?? null,
            date: existingVerifyParsed.date ?? null,
            track: existingVerifyParsed.track ?? null,
            raceNo: existingVerifyParsed.raceNo ?? null,
            outcome: existingVerifyParsed.outcome ?? null,
            hits: existingVerifyParsed.hits ?? null,
          };
        } else if (existingVerifySnippet) {
          structuredPreview = {
            parsedOk: false,
            rawSnippet: existingVerifySnippet,
          };
        }
        
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
          // Debug fields for skip verification (explicit fields as requested, safe to expose - no secrets)
          verifyKeyChecked: verifiedRedisKeyChecked || null, // Exact key checked (for auditability)
          verifyKeyExists: verifiedRedisKeyExists, // Boolean
          verifyKeyValuePreview: structuredPreview || verifiedRedisKeyValuePreview || null, // Structured preview (matching debug_redis_keys format)
          raceIdDerived: raceIdDerived || null, // Race ID portion (without prefix)
          skipReason: skipReason || null, // String enum: "already_verified_in_redis" or null
          // Additional context
          verifiedRedisKeyType: verifiedRedisKeyType || "none",
          redisNamespacePrefixUsed: "fl:verify:",
          normalization: normalization || null,
          // New debug fields for parsed verify value
          existingVerifyParsedOk: existingVerifyParsedOk,
          existingVerifyOkField: existingVerifyOkField,
          existingVerifySnippet: existingVerifySnippet,
        });
      } else {
        // Call /api/verify_race as normal (it will write to Redis)
        // Wrap in try/catch to ensure one race failure doesn't break the batch
        try {
          const result = await callVerifyRace(baseUrl, race);
          // Add explicit debug fields for all results (for auditability)
          result.verifyKeyChecked = verifiedRedisKeyChecked || null; // Exact key checked
          result.verifyKeyExists = verifiedRedisKeyExists; // Boolean
          result.verifyKeyValuePreview = verifiedRedisKeyValuePreview || null; // Truncated preview (safe)
          result.raceIdDerived = raceIdDerived || null; // Race ID portion
          result.skipReason = null; // Not skipped, so null
          // Additional context
          result.verifiedRedisKeyType = verifiedRedisKeyType || "none";
          result.redisNamespacePrefixUsed = "fl:verify:";
          result.normalization = normalization || null;
          // New debug fields for parsed verify value (even if not skipped)
          result.existingVerifyParsedOk = existingVerifyParsedOk;
          result.existingVerifyOkField = existingVerifyOkField;
          result.existingVerifySnippet = existingVerifySnippet;
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
            // Explicit debug fields even for errors (for auditability)
            verifyKeyChecked: verifiedRedisKeyChecked || null, // Exact key that would have been checked
            verifyKeyExists: verifiedRedisKeyExists || false, // Boolean (if check was attempted)
            verifyKeyValuePreview: verifiedRedisKeyValuePreview || null, // Truncated preview if available
            raceIdDerived: raceIdDerived || null, // Race ID portion
            skipReason: null, // Error case, so not skipped
            // Additional context
            verifiedRedisKeyType: verifiedRedisKeyType || "none",
            redisNamespacePrefixUsed: "fl:verify:",
            normalization: normalization || null,
            // New debug fields for parsed verify value (if check was attempted)
            existingVerifyParsedOk: existingVerifyParsedOk || false,
            existingVerifyOkField: existingVerifyOkField || null,
            existingVerifySnippet: existingVerifySnippet || null,
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
    // Explicit debug fields as requested (safe to expose - no secrets, no full values)
    verifyKeyChecked: r.verifyKeyChecked || r.verifiedRedisKeyChecked || null, // Exact key checked
    verifyKeyExists: r.verifyKeyExists !== undefined ? r.verifyKeyExists : (r.verifiedRedisKeyExists !== undefined ? r.verifiedRedisKeyExists : null), // Boolean
    verifyKeyValuePreview: r.verifyKeyValuePreview || r.verifiedRedisKeyValuePreview || null, // Truncated preview (max 80 chars, safe)
    raceIdDerived: r.raceIdDerived || null, // Race ID portion
    skipReason: r.skipReason || null, // String enum or null
    // Additional context
    verifiedRedisKeyType: r.verifiedRedisKeyType || "none",
    redisNamespacePrefixUsed: r.redisNamespacePrefixUsed || "fl:verify:",
    normalization: r.normalization || null,
  }));

  // Check if any race bypassed PayGate (for debug visibility)
  const anyBypassedPayGate = results.some(r => r.bypassedPayGate === true);

  // Check Redis configuration (for top-level debug)
  const redisConfigured = Boolean(getRedis());
  
  // Get safe Redis fingerprint (no secrets)
  let redisFingerprint = null;
  try {
    const { getRedisFingerprint } = await import('../../lib/redis_fingerprint.js');
    redisFingerprint = getRedisFingerprint();
  } catch {}
  
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
    // Top-level debug fields (safe to expose - no secrets)
    debug: {
      usedDeployment: process.env.VERCEL_GIT_COMMIT_SHA || null,
      usedEnv: process.env.VERCEL_ENV || null,
      baseUrl: baseUrl,
      redisConfigured: redisConfigured,
      redisFingerprint: redisFingerprint, // Complete fingerprint (url, token hash, env) - safe, no secrets
      forceOverride: forceOverride, // Show if force=1 was used
      redisVerifyPrefix: "fl:verify:",
      // CRITICAL: Show which Redis client type is used (for diagnosing mismatches)
      redisClientType: "@upstash/redis SDK (via backfill_helpers.getRedis)",
    },
  });
}
