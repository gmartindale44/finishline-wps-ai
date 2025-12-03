/**
 * Backfill Helper Functions
 * 
 * Shared utilities for backfill operations:
 * - Fetch race lists from Redis
 * - Load/write verify results
 * - Summarize backfill operations
 */

import { Redis } from "@upstash/redis";

const PRED_PREFIX = "fl:pred:";
const VERIFY_PREFIX = "fl:verify:";
const VERIFY_LOG_PREFIX = "fl:verify:log:";

let redisClient = null;

function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error("[backfill_helpers] Failed to init Redis client", error);
      redisClient = null;
    }
  }
  return redisClient;
}

/**
 * Build raceId from track, date, raceNo
 * EXACTLY matches the format used by verify_race.js buildVerifyRaceId()
 * This ensures Redis keys are consistent between verify_race and backfill operations.
 */
export function buildRaceId(track, date, raceNo) {
  // Normalize track: lowercase, collapse spaces, replace non-alphanum with '-', remove dup '-'
  // This EXACTLY matches buildVerifyRaceId in pages/api/verify_race.js
  const slugTrack = (track || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Normalize date: use YYYY-MM-DD format
  let slugDate = date || "";
  if (!slugDate || !/^\d{4}-\d{2}-\d{2}$/.test(slugDate)) {
    // If date is invalid, use empty string (calibration script will handle it)
    slugDate = "";
  }

  // Normalize race number
  const slugRaceNo = String(raceNo || "").trim() || "0";

  // Build: track-date-unknown-r{raceNo} (using "unknown" for postTime to match prediction pattern)
  const parts = [slugTrack, slugDate, "unknown", `r${slugRaceNo}`].filter(Boolean);
  return parts.join("-");
}

/**
 * Build verify raceId from context object (for convenience)
 * @param {object} ctx - Context with track, date/dateIso/dateRaw, raceNo
 * @returns {string} - Race ID matching verify_race format
 */
export function buildVerifyRaceIdFromContext(ctx) {
  const date = ctx.date || ctx.dateIso || ctx.dateRaw || "";
  return buildRaceId(ctx.track, date, ctx.raceNo);
}

/**
 * Build the Redis key for verify logs
 * @param {string} raceId - Race ID (from buildRaceId or buildVerifyRaceIdFromContext)
 * @returns {string} - Redis key: fl:verify:{raceId}
 */
export function buildVerifyKey(raceId) {
  return `${VERIFY_PREFIX}${raceId}`;
}

/**
 * Fetch list of races from prediction keys in Redis
 * @param {object} options
 * @param {string} [options.track] - Filter by track
 * @param {string} [options.date] - Filter by date (YYYY-MM-DD)
 * @param {number} [options.maxRaces] - Maximum number of races to return
 * @returns {Promise<Array<{track: string, date: string, raceNo: string}>>}
 */
export async function fetchRaceList({ track = null, date = null, maxRaces = null } = {}) {
  const redis = getRedis();
  if (!redis) {
    console.warn("[backfill_helpers] Redis not available, returning empty race list");
    return [];
  }
  
  const races = [];
  let cursor = 0;
  
  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: `${PRED_PREFIX}*`,
        count: 100,
      });
      cursor = Number(nextCursor);
      
      for (const key of keys) {
        try {
          const type = await redis.type(key);
          let hash = {};
          
          if (type === "hash") {
            hash = await redis.hgetall(key);
          } else if (type === "string") {
            const value = await redis.get(key);
            if (value) {
              try {
                hash = JSON.parse(value);
              } catch {
                // Skip invalid JSON
                continue;
              }
            }
          } else {
            continue;
          }
          
          // Extract track, date, raceNo
          const raceTrack = hash.track || "";
          const raceDate = hash.date || hash.dateIso || hash.date_iso || "";
          const raceNo = String(hash.raceNo || hash.race_no || hash.race || "");
          
          if (!raceTrack || !raceDate || !raceNo) {
            continue;
          }
          
          // Apply filters
          if (track && raceTrack.toLowerCase() !== track.toLowerCase()) {
            continue;
          }
          if (date && raceDate !== date) {
            continue;
          }
          
          races.push({
            track: raceTrack,
            date: raceDate,
            raceNo: raceNo,
          });
          
          if (maxRaces && races.length >= maxRaces) {
            break;
          }
        } catch (err) {
          console.warn(`[backfill_helpers] Error processing key ${key}:`, err.message);
        }
      }
      
      if (maxRaces && races.length >= maxRaces) {
        break;
      }
    } while (cursor !== 0);
  } catch (err) {
    console.error("[backfill_helpers] Error fetching race list:", err);
  }
  
  return races;
}

/**
 * Fetch all dates for a specific track from prediction keys
 * @param {string} track - Track name
 * @returns {Promise<Array<string>>} - Array of dates (YYYY-MM-DD)
 */
export async function fetchTrackDays(track) {
  const races = await fetchRaceList({ track });
  const dates = new Set();
  
  for (const race of races) {
    if (race.date) {
      dates.add(race.date);
    }
  }
  
  return Array.from(dates).sort();
}

/**
 * Check if a verify result already exists in Redis
 * Accepts either a context object or individual track/date/raceNo parameters
 * @param {object|string} ctxOrRaceId - Context object {track, date/dateIso/dateRaw, raceNo} OR a raceId string
 * @param {string} [date] - Date (if ctxOrRaceId is track string)
 * @param {string} [raceNo] - Race number (if ctxOrRaceId is track string)
 * @returns {Promise<boolean>} - true if verify log exists, false otherwise
 */
export async function verifyLogExists(ctxOrRaceId, date, raceNo) {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  
  let raceId;
  if (typeof ctxOrRaceId === "string") {
    // If first param is a string, treat it as raceId (or track if date/raceNo provided)
    if (date && raceNo) {
      // ctxOrRaceId is track, date and raceNo are separate params
      raceId = buildRaceId(ctxOrRaceId, date, raceNo);
    } else {
      // ctxOrRaceId is already a raceId
      raceId = ctxOrRaceId;
    }
  } else if (ctxOrRaceId && typeof ctxOrRaceId === "object") {
    // ctxOrRaceId is a context object
    raceId = buildVerifyRaceIdFromContext(ctxOrRaceId);
  } else {
    return false;
  }
  
  const key = buildVerifyKey(raceId);
  
  try {
    const type = await redis.type(key);
    return type === "string" || type === "hash";
  } catch {
    return false;
  }
}

/**
 * @deprecated Use verifyLogExists instead for consistency
 * Check if a verify result already exists in Redis
 * @param {string} track
 * @param {string} date
 * @param {string} raceNo
 * @returns {Promise<boolean>}
 */
export async function verifyExists(track, date, raceNo) {
  return verifyLogExists(track, date, raceNo);
}

/**
 * Load verify result from Redis
 * @param {string} track
 * @param {string} date
 * @param {string} raceNo
 * @returns {Promise<object|null>}
 */
export async function loadFromRedis(track, date, raceNo) {
  const redis = getRedis();
  if (!redis) {
    return null;
  }
  
  const raceId = buildRaceId(track, date, raceNo);
  const key = `${VERIFY_PREFIX}${raceId}`;
  
  try {
    const type = await redis.type(key);
    if (type === "string") {
      const value = await redis.get(key);
      if (value) {
        return JSON.parse(value);
      }
    } else if (type === "hash") {
      return await redis.hgetall(key);
    }
  } catch (err) {
    console.warn(`[backfill_helpers] Error loading ${key}:`, err.message);
  }
  
  return null;
}

/**
 * Write verify result to Redis
 * @param {object} result - Verify result object
 * @param {string} result.track
 * @param {string} result.date
 * @param {string} result.raceNo
 * @param {object} result.outcome
 * @param {object} result.predicted
 * @param {object} result.hits
 * @param {object} result.debug
 * @returns {Promise<boolean>}
 */
export async function writeToRedis(result) {
  const redis = getRedis();
  if (!redis) {
    console.warn("[backfill_helpers] Redis not available, cannot write");
    return false;
  }
  
  const { track, date, raceNo } = result;
  const raceId = buildRaceId(track, date, raceNo);
  const key = `${VERIFY_PREFIX}${raceId}`;
  
  try {
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
    
    await redis.set(key, JSON.stringify(logPayload));
    return true;
  } catch (err) {
    console.error(`[backfill_helpers] Error writing ${key}:`, err);
    return false;
  }
}

/**
 * Write audit entry to verify log
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {object} entry - Audit entry
 * @returns {Promise<boolean>}
 */
export async function writeAuditLog(date, entry) {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  
  const key = `${VERIFY_LOG_PREFIX}${date}`;
  
  try {
    const logEntry = {
      ...entry,
      ts: Date.now(),
    };
    
    await redis.lpush(key, JSON.stringify(logEntry));
    // Keep only last 1000 entries per day
    await redis.ltrim(key, 0, 999);
    return true;
  } catch (err) {
    console.error(`[backfill_helpers] Error writing audit log ${key}:`, err);
    return false;
  }
}

/**
 * Summarize backfill operation results
 * @param {Array<object>} results - Array of verify results
 * @returns {object} - Summary object
 */
export function summarizeBackfill(results) {
  const summary = {
    total: results.length,
    successes: 0,
    failures: 0,
    skipped: 0,
    withOutcome: 0,
    withoutOutcome: 0,
    byStep: {},
    byTrack: {},
  };
  
  for (const result of results) {
    if (result.skipped) {
      summary.skipped++;
      continue;
    }
    
    if (result.ok) {
      summary.successes++;
    } else {
      summary.failures++;
    }
    
    const hasOutcome = !!(result.outcome?.win || result.outcome?.place || result.outcome?.show);
    if (hasOutcome) {
      summary.withOutcome++;
    } else {
      summary.withoutOutcome++;
    }
    
    const step = result.step || "unknown";
    summary.byStep[step] = (summary.byStep[step] || 0) + 1;
    
    const track = result.track || "unknown";
    summary.byTrack[track] = (summary.byTrack[track] || 0) + 1;
  }
  
  return summary;
}

