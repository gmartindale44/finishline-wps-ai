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
 * Matches the format used by verify_race.js
 */
export function buildRaceId(track, date, raceNo) {
  function toSlug(str) {
    return String(str || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  
  const trackSlug = toSlug(track);
  const raceSuffix = `r${raceNo || 0}`;
  return `${trackSlug}-${date}-unknown-${raceSuffix}`;
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
 * @param {string} track
 * @param {string} date
 * @param {string} raceNo
 * @returns {Promise<boolean>}
 */
export async function verifyExists(track, date, raceNo) {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  
  const raceId = buildRaceId(track, date, raceNo);
  const key = `${VERIFY_PREFIX}${raceId}`;
  
  try {
    const type = await redis.type(key);
    return type === "string" || type === "hash";
  } catch {
    return false;
  }
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

