/**
 * Debug endpoint for Redis key computation and existence checks
 * Safe: No secrets exposed, only computed keys and existence booleans
 * 
 * Usage: GET /api/debug_redis_keys?track=<track>&date=<date>&raceNo=<raceNo>&surface=<surface>
 */
import { buildVerifyRaceId, normalizeTrack, normalizeDateToIso, normalizeRaceNo, normalizeSurface } from "../../lib/verify_normalize.js";
import { buildVerifyKey } from "../../utils/finishline/backfill_helpers.js";
import { getRedis } from "../../utils/finishline/backfill_helpers.js";
import { getRedisEnv } from "../../lib/redis.js";
import { getRedisFingerprint } from "../../lib/redis_fingerprint.js";
import { keys, get as redisGet } from "../../lib/redis.js";

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const { track, date, raceNo, surface } = req.query;

  const redisFingerprint = getRedisFingerprint();
  const redisEnv = getRedisEnv();
  const redisClientType = redisEnv.url && redisEnv.token ? 'REST (lib/redis.js)' : 'SDK (@upstash/redis)';

  const result = {
    ok: true,
    input: { track, date, raceNo, surface },
    redisFingerprint,
    redisClientType,
    redisConfigured: Boolean(getRedis() || (redisEnv.url && redisEnv.token)),
    // Computed keys
    predsnapRaceId: null,
    predsnapPattern: null,
    verifyRaceId: null,
    verifyKey: null,
    // Existence checks
    predsnapKeysFound: [],
    predsnapKeyExists: false,
    verifyKeyExists: false,
    verifyKeyType: null,
    verifyKeyValuePreview: null,
    // Normalization details
    normalization: null,
    errors: [],
  };

  try {
    // Normalize inputs
    const trackIn = track || "";
    const raceNoIn = raceNo || "";
    const dateIn = date || "";
    const surfaceIn = surface || null;

    const trackSlug = normalizeTrack(trackIn);
    const normalizedDate = normalizeDateToIso(dateIn);
    const raceNoNormalized = normalizeRaceNo(raceNoIn);
    const surfaceSlug = normalizeSurface(surfaceIn || "unknown");

    result.normalization = {
      trackIn,
      trackSlug,
      raceNoIn,
      raceNoNormalized,
      dateIn,
      dateIso: normalizedDate,
      surfaceIn: surfaceIn || null,
      surfaceSlug,
    };

    // Compute predsnap raceId (pipe format with spaces)
    // Same normalization as predict_wps.js deriveRaceId()
    const normalizeTrackForPredsnap = (t) => {
      if (!t) return "";
      return String(t)
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");
    };

    const predsnapNormTrack = normalizeTrackForPredsnap(trackIn);
    if (predsnapNormTrack && normalizedDate && raceNoNormalized) {
      result.predsnapRaceId = `${normalizedDate}|${predsnapNormTrack}|${raceNoNormalized}`;
      result.predsnapPattern = `fl:predsnap:${result.predsnapRaceId}:*`;
    }

    // Compute verify raceId (dash format)
    if (trackSlug && normalizedDate && raceNoNormalized) {
      result.verifyRaceId = buildVerifyRaceId(trackIn, dateIn, raceNoIn, surfaceIn || "unknown");
      result.verifyKey = buildVerifyKey(result.verifyRaceId);
    }

    // Check existence in Redis (if configured)
    if (result.redisConfigured) {
      try {
        // Check predsnap keys (pattern match)
        // Note: Redis KEYS is expensive, but this is a debug endpoint
        if (result.predsnapPattern) {
          try {
            // Use keys function with pattern (handles wildcards)
            const pattern = result.predsnapPattern;
            const foundKeys = await keys(pattern);
            if (Array.isArray(foundKeys)) {
              result.predsnapKeysFound = foundKeys.slice(0, 10); // Limit to first 10
              result.predsnapKeyExists = foundKeys.length > 0;
            }
          } catch (err) {
            result.errors.push(`predsnap keys scan failed: ${err?.message || String(err)}`);
            // Fallback: try SDK client if REST failed
            try {
              const redis = getRedis();
              if (redis && typeof redis.keys === 'function') {
                const foundKeys = await redis.keys(result.predsnapPattern);
                if (Array.isArray(foundKeys)) {
                  result.predsnapKeysFound = foundKeys.slice(0, 10);
                  result.predsnapKeyExists = foundKeys.length > 0;
                }
              }
            } catch (sdkErr) {
              // Both methods failed, error already logged
            }
          }
        }

        // Check verify key (exact match)
        if (result.verifyKey) {
          try {
            const redis = getRedis();
            if (redis) {
              // Try SDK client
              const type = await redis.type(result.verifyKey);
              result.verifyKeyExists = type === "string" || type === "hash";
              result.verifyKeyType = type || "none";

              if (result.verifyKeyExists) {
                // Try to read value and parse as JSON for structured preview
                try {
                  let rawValue = null;
                  let parsedValue = null;
                  
                  if (type === "string") {
                    const value = await redis.get(result.verifyKey);
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
                          // Not valid JSON - will use rawValue
                        }
                      } else {
                        // Other type (number, boolean, etc.) - stringify for snippet
                        rawValue = String(value);
                      }
                    }
                  } else if (type === "hash") {
                    const hash = await redis.hgetall(result.verifyKey);
                    if (hash && Object.keys(hash).length > 0) {
                      // Hash type - try to reconstruct object
                      rawValue = JSON.stringify(hash);
                      try {
                        // Try to parse fields that might be JSON strings
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
                  
                  if (parsedValue && typeof parsedValue === "object") {
                    // Successfully parsed (or already was an object)
                    result.verifyKeyValuePreview = {
                      parsedOk: true,
                      ok: parsedValue.ok ?? null,
                      step: parsedValue.step ?? null,
                      date: parsedValue.date ?? null,
                      track: parsedValue.track ?? null,
                      raceNo: parsedValue.raceNo ?? null,
                      outcome: parsedValue.outcome ?? null,
                      hits: parsedValue.hits ?? null,
                    };
                  } else if (rawValue) {
                    // Parse failed - return raw snippet
                    result.verifyKeyValuePreview = {
                      parsedOk: false,
                      rawSnippet: String(rawValue).slice(0, 160),
                    };
                  }
                } catch (readErr) {
                  result.errors.push(`verify key read failed: ${readErr?.message || String(readErr)}`);
                }
              }
            } else {
              // Try REST client
              try {
                const value = await redisGet(result.verifyKey);
                result.verifyKeyExists = value !== null && value !== undefined;
                result.verifyKeyType = value !== null && value !== undefined ? "string" : "none";
                if (value != null) {
                  let parsed = null;
                  let rawValue = null;
                  
                  // REST client typically returns strings, but Upstash might auto-parse JSON
                  if (typeof value === "string") {
                    rawValue = value;
                    try {
                      parsed = JSON.parse(value);
                    } catch {
                      // Not valid JSON - will use rawValue
                    }
                  } else if (typeof value === "object" && !Array.isArray(value) && value.constructor === Object) {
                    // Already parsed object (Upstash REST might auto-parse)
                    parsed = value;
                    try {
                      rawValue = JSON.stringify(value);
                    } catch {
                      rawValue = String(value);
                    }
                  } else {
                    // Other type - convert to string
                    rawValue = String(value);
                  }
                  
                  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    // Successfully parsed
                    result.verifyKeyValuePreview = {
                      parsedOk: true,
                      ok: parsed.ok ?? null,
                      step: parsed.step ?? null,
                      date: parsed.date ?? null,
                      track: parsed.track ?? null,
                      raceNo: parsed.raceNo ?? null,
                      outcome: parsed.outcome ?? null,
                      hits: parsed.hits ?? null,
                    };
                  } else if (rawValue) {
                    // Parse failed or not an object - return raw snippet
                    result.verifyKeyValuePreview = {
                      parsedOk: false,
                      rawSnippet: String(rawValue).slice(0, 160),
                    };
                  }
                }
              } catch (restErr) {
                result.errors.push(`verify key REST check failed: ${restErr?.message || String(restErr)}`);
              }
            }
          } catch (err) {
            result.errors.push(`verify key check failed: ${err?.message || String(err)}`);
          }
        }
      } catch (err) {
        result.errors.push(`Redis check failed: ${err?.message || String(err)}`);
      }
    } else {
      result.errors.push("Redis not configured");
    }

  } catch (err) {
    result.ok = false;
    result.errors.push(`Processing error: ${err?.message || String(err)}`);
    console.error('[debug_redis_keys] Error:', err);
  }

  res.status(200).json(result);
}