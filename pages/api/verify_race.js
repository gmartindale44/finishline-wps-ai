// pages/api/verify_race.js
// Feature-flagged verify_race handler with ultra-safe stub fallback
// - Default: stub mode (parses Google HTML for Win/Place/Show, always returns 200)
// - Full mode: CSE + HRN + Equibase parsing (enabled via VERIFY_RACE_MODE=full)
// - Always falls back to stub on any error

export const config = {
  runtime: "nodejs",
};

// GreenZone v1 integration
import { computeGreenZoneForRace } from "../../lib/greenzone/greenzone_v1.js";
// Normalize helpers for prediction lookup
import { slugRaceId } from "../../lib/normalize.js";
import { hgetall } from "../../lib/redis.js";
// Centralized verify normalization (ensures key consistency)
import { buildVerifyRaceId } from "../../lib/verify_normalize.js";

const VERIFY_PREFIX = "fl:verify:";
const PRED_PREFIX = "fl:pred:";

/**
 * Log verify result to Upstash Redis
 * This is best-effort and must not break the user flow
 */
async function logVerifyResult(result) {
  // Log ALL verify responses (including ok:false), so we can analyze coverage and failures.
  // Still keep the ok flag in the payload so calibration or analysis can filter later.
  if (!result) {
    return {
      verifyKey: null,
      writeOk: false,
      writeErr: "result is null",
      readbackOk: false,
      readbackErr: "result is null",
      ttlSeconds: null,
      valueSize: null,
    };
  }

  // Return object for server-side verification (defined at function scope)
  let redisResult = {
    verifyKey: null,
    writeOk: false,
    writeErr: null,
    readbackOk: false,
    readbackErr: null,
    ttlSeconds: null,
    valueSize: null,
  };
  
  try {
    const { track, date, raceNo } = result;

    // Build raceId for the key
    const raceId = buildVerifyRaceId(track, date, raceNo);

    // Try to fetch prediction metadata (confidence/T3M) if available
    let predmeta = null;
    try {
      // Build join key (same normalization as predmeta write)
      const normalizeTrack = (t) => {
        if (!t) return "";
        return String(t)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ")
          .replace(/[^a-z0-9\s]/g, "")
          .replace(/\s+/g, " ");
      };
      
      const normalizeDate = (d) => {
        if (!d) return "";
        const str = String(d).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        try {
          const parsed = new Date(str);
          if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
          }
        } catch {}
        return "";
      };
      
      const normTrack = normalizeTrack(track);
      const normDate = normalizeDate(date);
      const normRaceNo = String(raceNo || "").trim();
      
      // ADDITIVE: Try to fetch best snapshot first (if enabled)
      // Define outside if block so it's available for debug logging later
      const enablePredSnapshots = process.env.ENABLE_PRED_SNAPSHOTS === 'true'; // default false
      if (enablePredSnapshots && normTrack && normDate && normRaceNo) {
        try {
          const joinKey = `${normDate}|${normTrack}|${normRaceNo}`;
          const { keys: redisKeys, get: redisGet } = await import('../../lib/redis.js');
          const { getRedisFingerprint } = await import('../../lib/redis_fingerprint.js');
          const redisFingerprint = getRedisFingerprint();
          
          // Find all snapshots for this race
          const snapshotPattern = `fl:predsnap:${joinKey}:*`;
          
          // Initialize debug info
          if (!predmeta) predmeta = {};
          if (!predmeta.debug) predmeta.debug = {};
          predmeta.debug.snapshotPattern = snapshotPattern;
          predmeta.debug.redisFingerprint = redisFingerprint; // Safe fingerprint for diagnostics
          predmeta.debug.redisClientType = "REST API (lib/redis.js)"; // For diagnostics
          predmeta.debug.joinKey = joinKey; // Show exact key format used
          
          const snapshotKeys = await redisKeys(snapshotPattern);
          
          if (snapshotKeys.length > 0) {
            // Parse timestamps from keys: fl:predsnap:{raceId}:{asOf}
            const snapshots = [];
            for (const key of snapshotKeys) {
              const match = key.match(/fl:predsnap:[^:]+:(.+)$/);
              if (match) {
                const asOfStr = match[1];
                const rawValue = await redisGet(key);
                if (rawValue) {
                  try {
                    const snapshot = JSON.parse(rawValue);
                    const asOfDate = new Date(asOfStr);
                    if (!isNaN(asOfDate.getTime())) {
                      snapshots.push({
                        key,
                        asOf: asOfDate,
                        data: snapshot,
                      });
                    }
                  } catch {}
                }
              }
            }
            
            // Sort by timestamp (newest first)
            snapshots.sort((a, b) => b.asOf.getTime() - a.asOf.getTime());
            
            // Select best snapshot: latest snapshot before verification time
            const verifyTime = new Date();
            const bestSnapshot = snapshots.find(s => s.asOf.getTime() <= verifyTime.getTime());
            
            // Use best snapshot if available, otherwise use latest overall
            if (bestSnapshot || snapshots.length > 0) {
              const selected = bestSnapshot || snapshots[0];
              const snapshot = selected.data;
              
              // Extract predmeta fields from snapshot
              // Also extract predicted picks if available in snapshot
              const snapshotPredicted = {};
              if (Array.isArray(snapshot.picks) && snapshot.picks.length >= 3) {
                snapshotPredicted.win = snapshot.picks.find(p => p.slot === 'Win')?.name || snapshot.picks[0]?.name || '';
                snapshotPredicted.place = snapshot.picks.find(p => p.slot === 'Place')?.name || snapshot.picks[1]?.name || '';
                snapshotPredicted.show = snapshot.picks.find(p => p.slot === 'Show')?.name || snapshot.picks[2]?.name || '';
              } else if (Array.isArray(snapshot.ranking) && snapshot.ranking.length >= 3) {
                snapshotPredicted.win = snapshot.ranking[0]?.name || '';
                snapshotPredicted.place = snapshot.ranking[1]?.name || '';
                snapshotPredicted.show = snapshot.ranking[2]?.name || '';
              }
              
              predmeta = {
                confidence_pct: typeof snapshot.confidence === 'number' 
                  ? (snapshot.confidence <= 1 ? Math.round(snapshot.confidence * 100) : Math.round(snapshot.confidence))
                  : null,
                t3m_pct: typeof snapshot.top3_mass === 'number'
                  ? (snapshot.top3_mass <= 1 ? Math.round(snapshot.top3_mass * 100) : Math.round(snapshot.top3_mass))
                  : null,
                top3_list: Array.isArray(snapshot.ranking) && snapshot.ranking.length >= 3
                  ? snapshot.ranking.slice(0, 3).map(r => r.name).filter(Boolean)
                  : Array.isArray(snapshot.picks) && snapshot.picks.length >= 3
                    ? snapshot.picks.slice(0, 3).map(p => p.name || p.slot).filter(Boolean)
                    : null,
                // ADDITIVE: Store predicted picks from snapshot (for verify hit calculation)
                predicted: snapshotPredicted,
                // Store snapshot timestamp for logging
                predsnap_asOf: selected.asOf.toISOString()
              };
              
              // ADDITIVE: Store debug info for successful snapshot selection
              if (!predmeta.debug) predmeta.debug = {};
              predmeta.debug.snapshotKeysFoundCount = snapshotKeys.length;
              predmeta.debug.snapshotSelectedAsOf = selected.asOf.toISOString();
              predmeta.debug.snapshotSelectedKey = selected.key;
            } else {
              // ADDITIVE: Store debug info when no snapshot found (for diagnostics)
              if (!predmeta) predmeta = {};
              if (!predmeta.debug) predmeta.debug = {};
              predmeta.debug.snapshotKeysFoundCount = 0;
              predmeta.debug.snapshotSelectedAsOf = null;
              predmeta.debug.snapshotSelectedKey = null;
            }
          } else {
            // ADDITIVE: Store debug info when snapshot lookup not attempted (pattern match returned 0)
            if (!predmeta) predmeta = {};
            if (!predmeta.debug) predmeta.debug = {};
            predmeta.debug.snapshotKeysFoundCount = 0;
            predmeta.debug.snapshotSelectedAsOf = null;
            predmeta.debug.snapshotSelectedKey = null;
          }
        } catch (snapshotErr) {
          // Non-fatal: log but continue to predmeta lookup
          console.warn('[verify_race] Snapshot lookup failed (non-fatal):', snapshotErr?.message || snapshotErr);
          // ADDITIVE: Store debug info when snapshot lookup throws error
          if (!predmeta) predmeta = {};
          if (!predmeta.debug) predmeta.debug = {};
          predmeta.debug.snapshotKeysFoundCount = null;
          predmeta.debug.snapshotSelectedAsOf = null;
          predmeta.debug.snapshotSelectedKey = null;
          predmeta.debug.snapshotLookupError = snapshotErr?.message || String(snapshotErr);
        }
      }
      
      // First, try permanent predmeta key (if snapshot not found)
      if (!predmeta && normTrack && normDate && normRaceNo) {
        const joinKey = `${normDate}|${normTrack}|${normRaceNo}`;
        const predmetaKey = `fl:predmeta:${joinKey}`;
        // Use REST client for get operations
        const { get: redisGet } = await import('../../lib/redis.js');
        const rawValue = await redisGet(predmetaKey);
        
        if (rawValue) {
          try {
            predmeta = JSON.parse(rawValue);
          } catch {
            // Invalid JSON, skip
          }
        }
      }
      
      // If permanent key not found, try to find and reconcile pending key
      if (!predmeta && normTrack && normDate && normRaceNo) {
        let reconciled = false;
        let reconcileReason = null;
        let reconciledKey = null;
        
        try {
          // Use REST client for keys/search operations
          const { keys: redisKeys, get: redisGet, del: redisDel, setex: redisSetex } = await import('../../lib/redis.js');
          
          // Search for pending keys with hard limit for safety
          const pendingPattern = 'fl:predmeta:pending:*';
          const allPendingKeys = await redisKeys(pendingPattern);
          // Safety: limit to most recent 25 keys (sorted by timestamp in key name)
          // Extract timestamp from key: fl:predmeta:pending:${timestamp}
          const pendingKeyList = allPendingKeys
            .map(k => {
              const match = k.match(/fl:predmeta:pending:(\d+)$/);
              return match ? { key: k, ts: parseInt(match[1], 10) } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.ts - a.ts) // Most recent first
            .slice(0, 25) // Hard limit: max 25 keys
            .map(item => item.key);
          
          // Extract verify context fields for matching
          const verifyDistance = result.distance || result.distance_input || null;
          const verifySurface = result.surface || null;
          // Count runners from outcome or predicted if available
          const verifyRunnersCount = (() => {
            if (result.outcome && result.outcome.win && result.outcome.place && result.outcome.show) {
              // Count unique horses in outcome
              const horses = new Set([
                result.outcome.win,
                result.outcome.place,
                result.outcome.show
              ].filter(Boolean));
              // This is minimum 3, but actual count might be higher - use predicted if available
              if (result.predicted && Array.isArray(result.predicted.top3_list)) {
                return result.predicted.top3_list.length;
              }
              return horses.size >= 3 ? horses.size : null;
            }
            if (result.predicted && Array.isArray(result.predicted.top3_list)) {
              return result.predicted.top3_list.length;
            }
            return null;
          })();
          // Compute horses fingerprint from outcome/predicted if available
          const verifyHorsesFingerprint = (() => {
            const names = [];
            if (result.outcome) {
              if (result.outcome.win) names.push(result.outcome.win);
              if (result.outcome.place) names.push(result.outcome.place);
              if (result.outcome.show) names.push(result.outcome.show);
            }
            if (result.predicted && Array.isArray(result.predicted.top3_list)) {
              names.push(...result.predicted.top3_list);
            }
            if (names.length === 0) return null;
            // Same hash logic as predict_wps.js
            const combined = names.map(n => String(n).trim().toLowerCase()).filter(Boolean).join("|");
            if (!combined) return null;
            let hash = 0;
            for (let i = 0; i < combined.length; i++) {
              hash = ((hash << 5) - hash) + combined.charCodeAt(i);
              hash = hash & hash;
            }
            return Math.abs(hash).toString(16).slice(0, 12).padStart(12, '0');
          })();
          
          // Filter by track and time window (within 2 hours)
          const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
          const candidates = [];
          
          for (const pendingKey of pendingKeyList) {
            try {
              const rawPending = await redisGet(pendingKey);
              if (!rawPending) continue;
              
              const pendingMeta = JSON.parse(rawPending);
              
              // Check track matches (normalized) - REQUIRED
              const pendingTrack = normalizeTrack(pendingMeta.track || "");
              if (pendingTrack !== normTrack) continue;
              
              // Check created_at is within 2 hours - REQUIRED
              const createdTs = pendingMeta.created_at_ms || new Date(pendingMeta.created_at || 0).getTime();
              if (createdTs < twoHoursAgo) continue;
              
              // Compute match score
              let score = 0;
              
              // Track match (already filtered, but worth noting: +3 base score for passing filter)
              score += 3;
              
              // Distance match (+5)
              if (verifyDistance && pendingMeta.distance) {
                const normVerifyDist = String(verifyDistance).trim().toLowerCase();
                const normPendingDist = String(pendingMeta.distance).trim().toLowerCase();
                if (normVerifyDist === normPendingDist) {
                  score += 5;
                }
              }
              
              // Surface match (+5)
              if (verifySurface && pendingMeta.surface) {
                const normVerifySurf = String(verifySurface).trim().toLowerCase();
                const normPendingSurf = String(pendingMeta.surface).trim().toLowerCase();
                if (normVerifySurf === normPendingSurf) {
                  score += 5;
                }
              }
              
              // Runners count match (+3)
              if (verifyRunnersCount !== null && typeof pendingMeta.runners_count === 'number') {
                if (verifyRunnersCount === pendingMeta.runners_count) {
                  score += 3;
                }
              }
              
              // Horses fingerprint match (+2)
              if (verifyHorsesFingerprint && pendingMeta.horses_fingerprint) {
                if (verifyHorsesFingerprint === pendingMeta.horses_fingerprint) {
                  score += 2;
                }
              }
              
              // Recency bonus (up to +5) - newer gets higher score, prioritize very recent matches
              const ageMs = Date.now() - createdTs;
              const ageHours = ageMs / (60 * 60 * 1000);
              const recencyBonus = Math.max(0, 5 - (ageHours * 2.5)); // Max +5 for very recent (< 1 hour), decays to 0 over 2 hours
              score += recencyBonus;
              
              candidates.push({
                key: pendingKey,
                meta: pendingMeta,
                score,
                createdTs,
              });
            } catch {
              // Skip invalid pending keys
              continue;
            }
          }
          
          // Sort by score (descending), then by recency (descending)
          candidates.sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return b.createdTs - a.createdTs;
          });
          
          // Lowered threshold: require score >= 5 (allows track match + recency, or track + one metadata match)
          // This is more lenient than the previous >= 8 threshold
          const bestCandidate = candidates.length > 0 && candidates[0].score >= 5 ? candidates[0] : null;
          
          // If found, copy to permanent key and delete pending
          if (bestCandidate) {
            const reconciledMeta = {
              ...bestCandidate.meta,
              date: normDate,
              raceNo: normRaceNo,
            };
            
            const joinKey = `${normDate}|${normTrack}|${normRaceNo}`;
            const permanentKey = `fl:predmeta:${joinKey}`;
            
            // Write permanent key with 45-day TTL using REST client
            await redisSetex(permanentKey, 3888000, JSON.stringify(reconciledMeta));
            
            // Delete pending key (best-effort, don't fail if deletion fails)
            try {
              await redisDel(bestCandidate.key);
            } catch {
              // Ignore deletion errors
            }
            
            predmeta = reconciledMeta;
            reconciled = true;
            reconciledKey = bestCandidate.key;
            reconcileReason = `score=${bestCandidate.score} (track match + recency/metadata)`;
          } else if (candidates.length > 0) {
            reconcileReason = `no_match_above_threshold (best_score=${candidates[0].score}, threshold=5, candidates=${candidates.length})`;
          } else {
            reconcileReason = `no_candidates (pending_keys_checked=${pendingKeyList.length})`;
          }
        } catch (err) {
          // Fail open - if pending key search fails, continue without it
          reconcileReason = `error: ${err.message}`;
        }
        
        // Add debug info to result.debug if available (for diagnostics, but don't break on failure)
        if (result.debug && typeof result.debug === 'object') {
          result.debug.predmeta_reconciled = reconciled;
          if (reconcileReason) {
            result.debug.predmeta_reconcile_reason = reconcileReason;
          }
          if (reconciledKey) {
            result.debug.predmeta_reconciled_from = reconciledKey;
          }
        }
      }
    } catch (err) {
      // Fail open - if predmeta read fails, continue without it
      // Do not log error to avoid noise
    }

    // Build the log payload matching what calibration script expects
    // The calibration script looks for: track, date (or dateIso or debug.canonicalDateIso), raceNo, outcome
    const logPayload = {
      raceId,
      track: track || "",
      date: date || "",
      dateIso: date || "", // Alias for calibration script compatibility
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
      ok: result.ok === true, // normalize to boolean
      step: result.step || "",
      debug: {
        ...(result.debug || {}),
        canonicalDateIso: date || "", // For calibration script fallback lookup
      },
      ts: Date.now(),
    };

    // Attach prediction metadata if available
    if (predmeta) {
      if (typeof predmeta.confidence_pct === 'number') {
        logPayload.confidence_pct = predmeta.confidence_pct;
      }
      // Accept both t3m_pct and top3_mass_pct (for backward compatibility)
      if (typeof predmeta.t3m_pct === 'number') {
        logPayload.t3m_pct = predmeta.t3m_pct;
      } else if (typeof predmeta.top3_mass_pct === 'number') {
        logPayload.t3m_pct = predmeta.top3_mass_pct;
      }
      if (Array.isArray(predmeta.top3_list) && predmeta.top3_list.length > 0) {
        logPayload.top3_list = predmeta.top3_list;
      }
      // ADDITIVE: Store snapshot timestamp if snapshot was used
      if (predmeta.predsnap_asOf) {
        logPayload.predsnap_asOf = predmeta.predsnap_asOf;
      }
      // ADDITIVE: Store snapshot debug fields if snapshot feature is enabled
      // Note: enablePredSnapshots is defined in the outer scope (line 80)
      const enablePredSnapshots = process.env.ENABLE_PRED_SNAPSHOTS === 'true';
      if (enablePredSnapshots && predmeta.debug) {
        if (!logPayload.debug) logPayload.debug = {};
        logPayload.debug.snapshotKeysFoundCount = predmeta.debug.snapshotKeysFoundCount;
        logPayload.debug.snapshotSelectedAsOf = predmeta.debug.snapshotSelectedAsOf;
        if (predmeta.debug.snapshotLookupError) {
          logPayload.debug.snapshotLookupError = predmeta.debug.snapshotLookupError;
        }
      }
    }

    const logKey = `${VERIFY_PREFIX}${raceId}`;
    
    // ADDITIVE: Add verify log key name to debug for diagnostics (in both logPayload and result.debug)
    if (!logPayload.debug) logPayload.debug = {};
    logPayload.debug.verifyLogKey = logKey; // Exact key written (for auditability)
    logPayload.debug.raceId = raceId; // Race ID portion (without prefix)
    
    // CRITICAL: Also add to result.debug so it appears in the API response
    if (!result.debug) result.debug = {};
    result.debug.verifyRaceId = raceId; // Race ID portion (without prefix)
    result.debug.verifyKey = logKey; // Full Redis key that will be written
    result.debug.wroteToRedis = false; // Will be set to true if write succeeds
    
    // Add Redis fingerprint for diagnostics (safe, no secrets)
    try {
      const { getRedisFingerprint } = await import('../../lib/redis_fingerprint.js');
      const fingerprint = getRedisFingerprint();
      logPayload.debug.redisFingerprint = fingerprint;
      logPayload.debug.redisClientType = "REST API (lib/redis.js)";
      // Also add to result.debug
      result.debug.redisFingerprint = fingerprint;
      result.debug.redisClientType = "REST API (lib/redis.js)";
    } catch {}
    
    // Use REST client setex for verify logs (90 days TTL = 7776000 seconds)
    // CRITICAL: Always write to Redis (log all responses including ok:false for analytics)
    // But ensure we ALWAYS overwrite when ok=true AND outcome has win/place/show
    const hasCompleteOutcome = result.ok === true && 
                               result.outcome && 
                               result.outcome.win && 
                               result.outcome.place && 
                               result.outcome.show;
    
    // Always write (per requirement: log ALL verify responses for analytics)
    // This ensures ok:true results overwrite stale ok:false records
    // CRITICAL: Determine write reason for debugging
    const verifyWriteReason = hasCompleteOutcome 
      ? "ok_true_with_complete_outcome"
      : (result.ok === true ? "ok_true_incomplete_outcome" : "ok_false_analytics");
    const verifyWritePerformed = true; // We always attempt write
    
    // Update redisResult (already defined at function scope)
    redisResult.verifyKey = logKey;
    redisResult.writeOk = false;
    redisResult.writeErr = null;
    redisResult.readbackOk = false;
    redisResult.readbackErr = null;
    redisResult.ttlSeconds = null;
    redisResult.valueSize = null;
    
    try {
      const { setex, get } = await import('../../lib/redis.js');
      const redisModule = await import('../../lib/redis.js');
      const redis = redisModule.default || redisModule.redis;
      const valueStr = JSON.stringify(logPayload);
      await setex(logKey, 7776000, valueStr);
      
      // CRITICAL: Immediate readback to verify write succeeded
      const readbackValue = await get(logKey);
      
      // Get TTL using Upstash Redis client directly
      let readbackTtl = null;
      try {
        const { Redis } = await import('@upstash/redis');
        const redisClient = Redis.fromEnv();
        readbackTtl = await redisClient.ttl(logKey);
      } catch (ttlErr) {
        // TTL check is best-effort, don't fail readback if TTL fails
        console.warn("[verify-log] TTL check failed (non-critical):", ttlErr?.message);
      }
      
      redisResult.writeOk = true;
      redisResult.valueSize = valueStr.length;
      
      if (readbackValue !== null && readbackValue !== undefined) {
        redisResult.readbackOk = true;
        if (readbackTtl !== null && readbackTtl >= 0) {
          redisResult.ttlSeconds = readbackTtl;
        } else {
          redisResult.readbackErr = "TTL check returned null or negative";
        }
      } else {
        redisResult.readbackOk = false;
        redisResult.readbackErr = "Readback returned null/undefined";
      }
      
      logPayload.debug.verifyWriteOk = true;
      logPayload.debug.verifyWriteError = null;
      logPayload.debug.verifyWriteReason = verifyWriteReason;
      // CRITICAL: Update result.debug so it appears in API response
      if (!result.debug) result.debug = {};
      result.debug.wroteToRedis = true;
      result.debug.verifyKeyWritten = logKey;
      result.debug.verifyWritePerformed = verifyWritePerformed;
      result.debug.verifyWriteReason = verifyWriteReason;
      result.debug.writeResult = { success: true, key: logKey, hasCompleteOutcome };
      result.debug.redisResult = redisResult; // Add readback result to debug
    } catch (writeErr) {
      redisResult.writeOk = false;
      redisResult.writeErr = writeErr?.message || String(writeErr);
      
      // Track verify write error but don't break user flow
      logPayload.debug.verifyWriteOk = false;
      logPayload.debug.verifyWriteError = writeErr?.message || String(writeErr);
      logPayload.debug.verifyWriteReason = verifyWriteReason;
      // CRITICAL: Update result.debug so it appears in API response
      if (!result.debug) result.debug = {};
      result.debug.wroteToRedis = false;
      result.debug.verifyKeyWritten = logKey;
      result.debug.verifyWritePerformed = false;
      result.debug.verifyWriteReason = verifyWriteReason;
      result.debug.writeResult = { 
        success: false, 
        key: logKey, 
        hasCompleteOutcome,
        error: writeErr?.message || String(writeErr) 
      };
      result.debug.redisResult = redisResult; // Include error details
      console.error("[verify-log] Failed to log verify result", writeErr);
    }
  } catch (err) {
    // IMPORTANT: logging failures must NOT break the user flow
    console.error("[verify-log] Failed to log verify result", err);
    // Return error result so caller knows write failed
    return {
      verifyKey: null,
      writeOk: false,
      writeErr: err?.message || String(err),
      readbackOk: false,
      readbackErr: err?.message || String(err),
      ttlSeconds: null,
      valueSize: null,
    };
  }
  
  // CRITICAL: Return redisResult so caller can include it in responseMeta
  // Note: redisResult is defined inside the try block, so if we reach here,
  // it means the try block completed and redisResult is available
  return redisResult;
}

/**
 * Safely parse the request body. Supports JSON or URL-encoded form data.
 */
function safeParseBody(req) {
  return new Promise((resolve) => {
    try {
      // If Next.js has already parsed JSON, prefer that
      if (req.body && typeof req.body === "object") {
        return resolve(req.body);
      }
    } catch {
      // ignore and fall through to manual parsing
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
        // very simple x-www-form-urlencoded parser as a fallback
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

/**
 * Build a simple Google search URL for the race.
 */
function buildGoogleSearchUrl({ track, date, raceNo }) {
  const safeTrack = track || "Unknown Track";
  const safeDate = date || "Unknown Date";
  const safeRaceNo = raceNo || "Unknown Race";
  const q = `${safeTrack} Race ${safeRaceNo} ${safeDate} results Win Place Show`;
  const params = new URLSearchParams({ q });
  return {
    query: q,
    url: `https://www.google.com/search?${params.toString()}`,
  };
}

/**
 * Normalize prediction object into a consistent shape
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
 * Normalize predictions from request body - handles multiple formats
 * Supports:
 * - body.predicted.win/place/show
 * - body.predWin/predPlace/predShow
 * - body.win/place/show
 * Returns normalized object with win/place/show strings (trimmed)
 */
function normalizePredictedFromBody(body) {
  if (!body || typeof body !== "object") {
    return { win: "", place: "", show: "" };
  }

  // Try body.predicted object first
  if (body.predicted && typeof body.predicted === "object") {
    const win = (body.predicted.win || "").trim();
    const place = (body.predicted.place || "").trim();
    const show = (body.predicted.show || "").trim();
    if (win || place || show) {
      return { win, place, show };
    }
  }

  // Try body.predWin/predPlace/predShow
  const predWin = (body.predWin || "").trim();
  const predPlace = (body.predPlace || "").trim();
  const predShow = (body.predShow || "").trim();
  if (predWin || predPlace || predShow) {
    return { win: predWin, place: predPlace, show: predShow };
  }

  // Try body.win/place/show (less common but possible)
  const win = (body.win || "").trim();
  const place = (body.place || "").trim();
  const show = (body.show || "").trim();
  if (win || place || show) {
    return { win, place, show };
  }

  // No predictions found - return empty object
  return { win: "", place: "", show: "" };
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Compute GreenZone for a race result - ultra-safe wrapper
 * Returns disabled state on any error (never throws)
 */
async function computeGreenZoneSafe(result) {
  try {
    if (!result || !result.track || !result.date || !result.raceNo) {
      return { enabled: false, reason: "missing_race_context" };
    }
    
    const raceCtx = {
      track: result.track,
      raceNo: result.raceNo,
      dateIso: result.date,
      predicted: result.predicted,
      outcome: result.outcome,
    };
    
    const greenZone = await computeGreenZoneForRace(raceCtx);
    return greenZone || { enabled: false, reason: "computation_failed" };
  } catch (error) {
    console.warn("[verify_race] GreenZone computation failed:", error?.message || error);
    return { enabled: false, reason: "internal_error" };
  }
}

/**
 * Fetch prediction log from Redis for a specific race
 * Returns predicted picks, confidence, and top3Mass if available
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
 * Check if scraped race metadata doesn't match the requested race
 * Returns true if there's a mismatch (should reject the scraped result)
 * @param {Object} ctx - Request context: { dateIso, raceNo, track }
 * @param {Object} scraped - Scraped metadata: { canonicalDateIso, raceNo, track }
 * @returns {boolean} - True if mismatch detected (should reject)
 */
function isScrapedRaceMismatched(ctx, scraped) {
  try {
    if (!scraped || !ctx) return false;

    const { canonicalDateIso, raceNo: scrapedRaceNo, track: scrapedTrack } = scraped || {};
    const { dateIso, raceNo: requestedRaceNo, track: requestedTrack } = ctx || {};

    // 1. Date mismatch: if canonical date exists and != ctx date, treat as mismatch
    if (canonicalDateIso && dateIso && canonicalDateIso !== dateIso) {
      return true;
    }

    // 2. Race number mismatch (if we can detect it)
    if (scrapedRaceNo != null && requestedRaceNo != null) {
      const scrapedStr = String(scrapedRaceNo).trim();
      const requestedStr = String(requestedRaceNo).trim();
      if (scrapedStr && requestedStr && scrapedStr !== requestedStr) {
        return true;
      }
    }

    // 3. Optional: obvious track mismatch (case-insensitive)
    if (scrapedTrack && requestedTrack) {
      const scrapedLower = scrapedTrack.toLowerCase().trim();
      const requestedLower = requestedTrack.toLowerCase().trim();
      if (scrapedLower && requestedLower && scrapedLower !== requestedLower) {
        return true;
      }
    }

    return false;
  } catch (err) {
    // On any error, fail *safe* (do NOT treat as trusted)
    console.warn("[isScrapedRaceMismatched] Error checking mismatch, treating as mismatch:", err?.message || err);
    return true;
  }
}

/**
 * Add GreenZone to response object - safe wrapper that never throws
 * Modifies response object in-place, adds greenZone field
 */
async function addGreenZoneToResponse(response) {
  try {
    if (!response || typeof response !== "object") return;
    
    // Compute GreenZone (safe, returns disabled state on error)
    const greenZone = await computeGreenZoneSafe(response);
    
    // Add to response
    response.greenZone = greenZone || { enabled: false };
  } catch (error) {
    // Ultra-safe: if anything fails, just add disabled state
    console.warn("[verify_race] Failed to add GreenZone to response:", error?.message || error);
    if (response && typeof response === "object") {
      response.greenZone = { enabled: false, reason: "internal_error" };
    }
  }
}

/**
 * Build summary text from outcome, date, step, and query
 * Safe helper that never throws
 * @param {object} params - { date, uiDateRaw, outcome, step, query }
 * @returns {string} - Formatted summary text
 */
function buildSummary({ date, uiDateRaw, outcome, step, query }) {
  try {
    const lines = [];
    
    // UI date line
    if (uiDateRaw && typeof uiDateRaw === "string") {
      lines.push(`UI date: ${uiDateRaw}`);
    }
    
    // Using date line
    if (date && typeof date === "string") {
      lines.push(`Using date: ${date}`);
    }
    
    // Step line
    if (step && typeof step === "string") {
      lines.push(`Step: ${step}`);
    }
    
    // Query line
    if (query && typeof query === "string") {
      lines.push(`Query: ${query}`);
    }
    
    // Outcome section
    lines.push("");
    lines.push("Outcome:");
    
    const win = (outcome && outcome.win && typeof outcome.win === "string") ? outcome.win.trim() : "";
    const place = (outcome && outcome.place && typeof outcome.place === "string") ? outcome.place.trim() : "";
    const show = (outcome && outcome.show && typeof outcome.show === "string") ? outcome.show.trim() : "";
    
    if (win) {
      lines.push(`  Win: ${win}`);
    } else {
      lines.push(`  Win: -`);
    }
    
    if (place) {
      lines.push(`  Place: ${place}`);
    } else {
      lines.push(`  Place: -`);
    }
    
    if (show) {
      lines.push(`  Show: ${show}`);
    } else {
      lines.push(`  Show: -`);
    }
    
    return lines.join("\n");
  } catch (err) {
    console.error("[buildSummary] Error building summary:", err);
    // Return a minimal safe summary
    return `Step: ${step || "unknown"}\nOutcome:\n  Win: -\n  Place: -\n  Show: -`;
  }
}

// ACTIVE handler for /api/verify_race is: pages/api/verify_race.js
const HANDLER_FILE = "pages/api/verify_race.js";
const BACKEND_VERSION = "verify_v4_hrn_equibase";

/**
 * Try Equibase fallback - NO-OP version for stub mode
 * The full verify pipeline has its own real Equibase fallback;
 * this version is just to keep the stub path from erroring.
 * @param {string} track - Track name
 * @param {string} dateIso - ISO date (YYYY-MM-DD)
 * @param {string|number} raceNo - Race number
 * @param {object} baseDebug - Existing debug object
 * @returns {{ outcome: object|null, debugExtras: object }}
 */
async function tryEquibaseFallback(track, dateIso, raceNo, baseDebug = {}) {
  // Stub / no-op implementation for stub mode.
  // The full verify pipeline has its own real Equibase fallback;
  // this version is just to keep the stub path from erroring.
  // Return minimal debug info - no error message needed in stub mode
  return {
    outcome: null,
    debugExtras: {},
  };
}

/**
 * Fetch with retry logic and browser-like headers (for anti-bot evasion)
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  const retryableStatuses = [403, 429, 503, 502, 504];
  const backoffs = [500, 1500, 3000]; // ms delays
  
  // Browser-like headers to avoid anti-bot detection
  const browserHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.google.com/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    ...options.headers,
  };

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: browserHeaders,
      });

      // If successful or non-retryable error, return immediately
      if (response.ok || !retryableStatuses.includes(response.status)) {
        return response;
      }

      // Store response for retryable errors
      lastResponse = response;

      // If this is the last attempt, return the failed response
      if (attempt === maxRetries - 1) {
        return response;
      }

      // Wait before retrying (exponential backoff)
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)];
      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (err) {
      lastError = err;

      // If this is the last attempt, re-throw
      if (attempt === maxRetries - 1) {
        throw err;
      }

      // Wait before retrying
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)];
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but handle edge case
  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  throw new Error("fetchWithRetry: unexpected state");
}

/**
 * Try HRN fallback - attempts to fetch and parse HRN entries-results page
 * @param {string} track - Track name
 * @param {string} dateIso - ISO date (YYYY-MM-DD)
 * @param {object} baseDebug - Existing debug object (may contain googleHtml)
 * @returns {{ outcome: object|null, debugExtras: object, httpStatus: number|null }}
 */
async function tryHrnFallback(track, dateIso, raceNo, baseDebug = {}) {
  const debugExtras = {};
  let httpStatus = null;
  let urlAttempted = null;
  
  try {
    debugExtras.hrnAttempted = true;
    debugExtras.hrnRaceNo = (raceNo !== null && raceNo !== undefined) ? String(raceNo || "").trim() : null;

    const hrnUrlFromGoogle = baseDebug.googleHtml ? extractHrnUrlFromGoogleHtml(baseDebug.googleHtml) : null;
    const hrnUrl = hrnUrlFromGoogle || buildHrnUrl(track, dateIso);
    debugExtras.hrnUrl = hrnUrl || null;
    urlAttempted = hrnUrl;

    if (!hrnUrl) {
      debugExtras.hrnParseError = "No HRN URL available";
      return { outcome: null, debugExtras, httpStatus: null };
    }

    // Use fetchWithRetry with browser-like headers and retry logic
    const res = await fetchWithRetry(hrnUrl, {
      method: "GET",
    }, 3);

    httpStatus = res.status;
    debugExtras.hrnHttpStatus = httpStatus;

    if (!res.ok) {
      const statusText = res.statusText || "";
      debugExtras.hrnParseError = `HTTP ${httpStatus}${statusText ? ` ${statusText}` : ""} from HRN (blocked or unavailable)`;
      return { outcome: null, debugExtras, httpStatus, urlAttempted };
    }

    const html = await res.text();
    const { outcome, debug: hrnDebug } = extractOutcomeFromHrnHtml(html, raceNo);
    
    // Merge ALL HRN debug fields into debugExtras (not just selective ones)
    if (hrnDebug && typeof hrnDebug === 'object') {
      // Merge all fields from hrnDebug into debugExtras
      Object.assign(debugExtras, hrnDebug);
    }
    
    if (!outcome || (!outcome.win && !outcome.place && !outcome.show)) {
      debugExtras.hrnParseError = "No outcome parsed from HRN HTML";
      return { outcome: null, debugExtras, httpStatus, urlAttempted };
    }

    return { outcome, debugExtras, httpStatus: 200, urlAttempted };
  } catch (err) {
    const errorMsg = err && typeof err.message === "string" ? err.message : String(err || "Unknown error");
    debugExtras.hrnParseError = `Fetch error: ${errorMsg}`;
    return { outcome: null, debugExtras, httpStatus, urlAttempted };
  }
}

/**
 * Extract HRN entries-results URL from Google HTML
 * Also tries to decode Google redirect URLs (/url?q=...)
 * @param {string} html - Google search results HTML
 * @returns {string|null} - First matching HRN URL or null
 */
function extractHrnUrlFromGoogleHtml(html) {
  if (!html || typeof html !== "string") {
    return null;
  }

  // Pattern 1: Direct URLs
  const directPattern = /https:\/\/entries\.horseracingnation\.com\/entries-results\/[^"'>\s]+\/\d{4}-\d{2}-\d{2}/i;
  const directMatch = html.match(directPattern);
  if (directMatch && directMatch[0]) {
    return directMatch[0];
  }

  // Pattern 2: Google redirect URLs (/url?q=...)
  const urlQPattern = /\/url\?q=([^&"'>]+)/gi;
  let match;
  while ((match = urlQPattern.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(match[1]);
      const hrnMatch = decoded.match(/https:\/\/entries\.horseracingnation\.com\/entries-results\/[^"'>\s]+\/\d{4}-\d{2}-\d{2}/i);
      if (hrnMatch && hrnMatch[0]) {
        return hrnMatch[0];
      }
    } catch (e) {
      // Ignore decode errors
    }
  }

  // Pattern 3: Percent-encoded in href attributes
  const hrefPattern = /href=["']([^"']*entries-results[^"']*)["']/gi;
  while ((match = hrefPattern.exec(html)) !== null) {
    try {
      const url = match[1];
      // Try decoding if needed
      const decoded = url.includes("%") ? decodeURIComponent(url) : url;
      const hrnMatch = decoded.match(/https:\/\/entries\.horseracingnation\.com\/entries-results\/[^"'>\s]+\/\d{4}-\d{2}-\d{2}/i);
      if (hrnMatch && hrnMatch[0]) {
        return hrnMatch[0];
      }
    } catch (e) {
      // Ignore decode errors
    }
  }
  
  return null;
}

/**
 * Build HRN entries-results URL from track and date
 * @param {string} track - Track name (e.g. "Laurel Park")
 * @param {string} date - ISO date (e.g. "2025-11-30")
 * @returns {string|null} - Constructed HRN URL or null
 */
function buildHrnUrl(track, date) {
  if (!track || !date) return null;
  
  // Normalize track to slug: lowercase, replace spaces with hyphens, remove special chars
  const trackSlug = track
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  
  if (!trackSlug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  
  return `https://entries.horseracingnation.com/entries-results/${trackSlug}/${date}`;
}

/**
 * Split HRN HTML into race blocks by finding sections that contain "Race N" followed by a payout table
 * @param {string} html - Full HRN page HTML
 * @returns {Array<{ raceNo: string, html: string, tableIndex: number }>}
 */
function splitHrnHtmlIntoRaceBlocks(html) {
  const blocks = [];
  
  if (!html || typeof html !== "string") {
    return blocks;
  }
  
  try {
    // Find all table-payouts tables
    const tablePattern = /<table[^>]*table-payouts[^>]*>/gi;
    const tableMatches = [];
    let match;
    while ((match = tablePattern.exec(html)) !== null) {
      tableMatches.push({ index: match.index, fullMatch: match[0] });
    }
    
    // For each table, look backwards for the closest "Race N" marker
    // Also look at the table content itself to infer race number
    for (let i = 0; i < tableMatches.length; i++) {
      const tableStart = tableMatches[i].index;
      // Look further back (up to 15000 chars) to find race markers
      const beforeTable = html.substring(Math.max(0, tableStart - 15000), tableStart);
      
      // Find the closest "Race N" before this table (case-insensitive)
      const racePattern = /Race\s+(\d+)/gi;
      const raceMatches = [];
      let raceMatch;
      while ((raceMatch = racePattern.exec(beforeTable)) !== null) {
        raceMatches.push({
          raceNo: raceMatch[1],
          index: raceMatch.index,
          distance: beforeTable.length - raceMatch.index
        });
      }
      
      // Use the last (closest) race match before the table
      if (raceMatches.length > 0) {
        const closestRace = raceMatches[raceMatches.length - 1];
        blocks.push({
          raceNo: closestRace.raceNo,
          tableIndex: i,
          tableStart: tableStart
        });
      } else {
        // Fallback: if no race marker found, try to infer from table order
        // Table 0 = Race 1, Table 1 = Race 2, etc. (only if we have multiple tables)
        if (tableMatches.length > 1) {
          blocks.push({
            raceNo: String(i + 1), // First table is Race 1, second is Race 2, etc.
            tableIndex: i,
            tableStart: tableStart
          });
        }
      }
    }
  } catch (err) {
    // On any error, return empty blocks (caller will fall back to parsing all tables)
    console.error("[splitHrnHtmlIntoRaceBlocks] Error:", err.message);
    return [];
  }
  
  return blocks;
}

/**
 * Extract Win/Place/Show from HRN entries-results HTML
 * Parses the finish order table to find horses in positions 1, 2, 3
 * Uses multiple fallback strategies for robust extraction
 * @param {string} html - HRN page HTML
 * @param {string|number} raceNo - Race number to target (optional, defaults to first table)
 * @returns {{ outcome: { win: string, place: string, show: string }, debug: object }}
 */
function extractOutcomeFromHrnHtml(html, raceNo = null) {
  const outcome = { win: "", place: "", show: "" };
  const debug = {
    hrnParsedBy: null,
    hrnOutcomeRaw: { win: "", place: "", show: "" },
    hrnOutcomeNormalized: { win: "", place: "", show: "" },
    hrnFoundMarkers: {
      Results: false,
      Finish: false,
      Win: false,
      Place: false,
      Show: false,
    },
    hrnRegionFound: false,
    hrnRegionSnippet: null,
    hrnCandidateRejectedReasons: [],
  };
  
  if (!html || typeof html !== "string") {
    debug.hrnParsedBy = "none";
    return { outcome, debug };
  }
  
  try {
    // STEP 1: Strip script/style/comment blocks BEFORE any parsing to avoid matching JS code
    let sanitizedHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ") // Remove all <script> blocks
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ") // Remove all <style> blocks
      .replace(/<!--[\s\S]*?-->/g, " ") // Remove HTML comments
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ") // Remove noscript blocks
      .replace(/\s+/g, " "); // Normalize whitespace
    
    // Check for markers in sanitized HTML (Results=True, Finish=True, Win=True, Place=True, Show=True)
    const markersPattern = /(Results|Finish|Win|Place|Show)\s*=\s*True/gi;
    let markerMatch;
    while ((markerMatch = markersPattern.exec(sanitizedHtml)) !== null) {
      const markerName = markerMatch[1];
      if (markerName) {
        debug.hrnFoundMarkers[markerName] = true;
      }
    }
    
    // STEP 2: Isolate "results region" - find section most likely to contain finish results
    let resultsRegion = null;
    const regionPatterns = [
      // Pattern 1: Look for explicit "Results" or "Race Results" headings
      /(?:<h[1-6][^>]*>[\s\S]*?(?:Results?|Finish|Payout)[\s\S]*?<\/h[1-6]>[\s\S]{0,5000})/i,
      // Pattern 2: Look for containers with "results" class/id
      /<[^>]*(?:class|id)=["'][^"']*(?:results?|finish|payout)[^"']*["'][^>]*>([\s\S]{500,8000})<\/[^>]+>/i,
      // Pattern 3: Look for table with "results" or "payout" in class/id
      /<table[^>]*(?:class|id)=["'][^"']*(?:results?|finish|payout|table-payouts)[^"']*["'][^>]*>([\s\S]{500,10000})<\/table>/i,
      // Pattern 4: Look for section between "Race" and "Results" keywords (within reasonable distance)
      /Race[\s\S]{0,2000}?(?:Results?|Finish)[\s\S]{0,5000}/i,
    ];
    
    for (const pattern of regionPatterns) {
      const match = sanitizedHtml.match(pattern);
      if (match && match[0] && match[0].length > 500) {
        resultsRegion = match[0];
        break;
      }
    }
    
    // Fallback: If no specific region found, but markers exist, use a larger context around markers
    if (!resultsRegion && (debug.hrnFoundMarkers.Results || debug.hrnFoundMarkers.Finish)) {
      const markerPos = sanitizedHtml.search(/(?:Results|Finish)\s*=\s*True/i);
      if (markerPos > -1) {
        const start = Math.max(0, markerPos - 2000);
        const end = Math.min(sanitizedHtml.length, markerPos + 5000);
        resultsRegion = sanitizedHtml.slice(start, end);
      }
    }
    
    // If still no region found, try to find any table with "payout" or "results" in it
    if (!resultsRegion) {
      const tableMatch = sanitizedHtml.match(/<table[^>]*>[\s\S]{500,10000}?<\/table>/gi);
      if (tableMatch) {
        // Use the largest table (likely to be results table)
        resultsRegion = tableMatch.reduce((largest, current) => 
          current.length > (largest?.length || 0) ? current : largest, null);
      }
    }
    
    // If no results region found, return early with no outcome
    if (!resultsRegion) {
      debug.hrnParsedBy = "none";
      debug.hrnRegionFound = false;
      return { outcome, debug };
    }
    
    debug.hrnRegionFound = true;
    debug.hrnRegionSnippet = resultsRegion.slice(0, 200).replace(/\s+/g, " "); // First 200 chars for debugging
    
    // If raceNo is provided, try to find the matching race block within results region
    let targetHtml = resultsRegion;
    if (raceNo !== null && raceNo !== undefined) {
      const raceNoStr = String(raceNo || "").trim();
      if (raceNoStr) {
        const blocks = splitHrnHtmlIntoRaceBlocks(resultsRegion);
        
        // Find the block matching the requested race
        const matchingBlock = blocks.find(b => String(b.raceNo) === raceNoStr);
        
        if (matchingBlock) {
          // Extract HTML from the matching table
          const tablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]*?<\/table>/gi;
          const allTables = [];
          let tableMatch;
          while ((tableMatch = tablePattern.exec(resultsRegion)) !== null) {
            allTables.push({ index: tableMatch.index, html: tableMatch[0] });
          }
          
          if (allTables[matchingBlock.tableIndex]) {
            targetHtml = allTables[matchingBlock.tableIndex].html;
          }
        }
      }
    }
    
    // Enhanced helper to decode HTML entities
    const decodeEntity = (str) => {
      if (!str) return "";
      return str
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&#160;/g, " ")
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .trim();
    };
    
    // Enhanced normalization: trim, decode entities, remove extra punctuation, preserve apostrophes/hyphens
    const normalizeHorseName = (name) => {
      if (!name) return "";
      
      // Decode HTML entities
      let normalized = decodeEntity(name);
      
      // Remove HTML tags if any remain
      normalized = normalized.replace(/<[^>]+>/g, "");
      
      // Remove speed figures in parentheses like "(92*)", "(89*)", etc.
      normalized = normalized.replace(/\s*\([^)]*\)\s*$/, "");
      
      // Remove extra punctuation at start/end (but preserve apostrophes and hyphens inside)
      normalized = normalized.replace(/^[^\w'-]+/, "").replace(/[^\w'-]+$/, "");
      
      // Collapse multiple spaces
      normalized = normalized.replace(/\s+/g, " ");
      
      // Trim
      normalized = normalized.trim();
      
      return normalized;
    };
    
    // Strict validation helper that rejects JS tokens, generic words, and invalid patterns
    // Returns { valid: boolean, reason: string | null }
    const validateHorseName = (name, debugReasons = null) => {
      if (!name || name.length === 0) {
        if (debugReasons) debugReasons.push("empty_name");
        return { valid: false, reason: "empty_name" };
      }
      
      // Reject if too short (must be at least 3 chars)
      if (name.length < 3) {
        if (debugReasons) debugReasons.push(`too_short_${name.length}`);
        return { valid: false, reason: "too_short" };
      }
      
      if (name.length > 50) {
        if (debugReasons) debugReasons.push(`too_long_${name.length}`);
        return { valid: false, reason: "too_long" };
      }
      
      // Must contain at least one letter
      if (!/[A-Za-z]/.test(name)) {
        if (debugReasons) debugReasons.push("no_letters");
        return { valid: false, reason: "no_letters" };
      }
      
      // Reject if contains dots (likely JS property access like "dow.dataLayer")
      if (name.includes(".")) {
        if (debugReasons) debugReasons.push(`contains_dot:${name}`);
        return { valid: false, reason: "contains_dot" };
      }
      
      // Reject if contains HTML angle brackets or "=" (likely HTML/JS code)
      if (name.includes("<") || name.includes(">") || name.includes("=")) {
        if (debugReasons) debugReasons.push(`contains_html:${name}`);
        return { valid: false, reason: "contains_html" };
      }
      
      // Reject JavaScript identifiers and keywords
      const jsKeywords = [
        "datalayer", "dow", "window", "document", "function", "var", "let", "const",
        "this", "place", "win", "show", "true", "false", "null", "undefined",
        "return", "if", "else", "for", "while", "prototype", "call", "apply",
        "splice", "push", "pop", "slice", "split", "replace", "match", "exec",
        "test", "parse", "stringify", "object", "array", "number", "string",
      ];
      const nameLower = name.toLowerCase().trim();
      for (const keyword of jsKeywords) {
        if (nameLower === keyword || nameLower === `"${keyword}"` || nameLower === `'${keyword}'`) {
          if (debugReasons) debugReasons.push(`js_keyword:${keyword}`);
          return { valid: false, reason: `js_keyword:${keyword}` };
        }
      }
      
      // Reject generic tokens that are too short or common words
      const genericTokens = ["this", "place", "win", "show", "the", "a", "an", "is", "are", "was", "were"];
      if (genericTokens.includes(nameLower)) {
        if (debugReasons) debugReasons.push(`generic_token:${nameLower}`);
        return { valid: false, reason: `generic_token:${nameLower}` };
      }
      
      // Reject if looks like HTML or code
      if (name.includes("function") || name.includes("=>") || name.includes("()")) {
        if (debugReasons) debugReasons.push(`contains_code:${name}`);
        return { valid: false, reason: "contains_code" };
      }
      
      // Reject common non-horse-name patterns
      if (/^\d+$/.test(name)) {
        if (debugReasons) debugReasons.push(`pure_numbers:${name}`);
        return { valid: false, reason: "pure_numbers" };
      }
      
      if (name.toLowerCase().includes("finish") || name.toLowerCase().includes("position")) {
        if (debugReasons) debugReasons.push(`contains_finish_position:${name}`);
        return { valid: false, reason: "contains_finish_position" };
      }
      
      if (name.toLowerCase().includes("win:") || name.toLowerCase().includes("place:") || name.toLowerCase().includes("show:")) {
        if (debugReasons) debugReasons.push(`contains_label:${name}`);
        return { valid: false, reason: "contains_label" };
      }
      
      // Reject if it's just currency/payout info
      if (/^\$?[\d,]+\.?\d*$/.test(name)) {
        if (debugReasons) debugReasons.push(`currency_only:${name}`);
        return { valid: false, reason: "currency_only" };
      }
      
      // Reject if contains suspicious JS patterns
      if (/[{}()=>]/.test(name) || /^[A-Z],/.test(name)) {
        if (debugReasons) debugReasons.push(`js_pattern:${name}`);
        return { valid: false, reason: "js_pattern" };
      }
      
      return { valid: true, reason: null };
    };
    
    // Helper for backward compatibility (used in some places)
    const isValid = (name) => {
      return validateHorseName(name).valid;
    };
    
    // STRATEGY 1: Look for Results/Finish table sections and parse first three finishers
    // This is the most reliable for entries-results pages
    // Try multiple table patterns to handle different HRN structures
    const tablePatterns = [
      // Pattern 1: Standard table with tbody
      /<table[^>]*(?:results|finish|payout|table-payouts)[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/gi,
      // Pattern 2: Table without explicit tbody (rows directly in table)
      /<table[^>]*(?:results|finish|payout)[^>]*>([\s\S]*?)<\/table>/gi,
      // Pattern 3: Any table that might contain results
      /<table[^>]*>([\s\S]{500,10000}?)<\/table>/gi, // Limit size to avoid matching entire page
    ];
    
    const rows = [];
    let foundTable = false;
    
    for (const tablePattern of tablePatterns) {
      tablePattern.lastIndex = 0; // Reset regex
      let tableMatch;
      
      while ((tableMatch = tablePattern.exec(targetHtml)) !== null && !foundTable) {
        const tableContent = tableMatch[1];
        if (!tableContent || tableContent.length < 100) continue; // Skip tiny tables
        
        // Extract all TRs from table content
        const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        let rowIndex = 0;
        const tableRows = [];
        
        while ((trMatch = trPattern.exec(tableContent)) !== null && rowIndex < 15) {
          const rowHtml = trMatch[1];
          
          // Skip header rows (contain <th> or text like "Finish", "Position", "Horse")
          if (rowHtml.match(/<th[^>]*>/i) || 
              /finish|position|horse\s*name|win|place|show/i.test(rowHtml) && rowIndex === 0) {
            continue;
          }
          
          // Extract all TDs in this row
          const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cells = [];
          let tdMatch;
          
          while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
            // Remove all HTML tags first, then decode
            let cellContent = tdMatch[1]
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            // Decode entities
            cellContent = decodeEntity(cellContent);
            if (cellContent && cellContent.length > 0) {
              cells.push(cellContent);
            }
          }
          
          // Try to find horse name and position
          let horseNameRaw = null;
          let position = null;
          
          // Strategy: Look for position number (1, 2, 3) in any cell, then horse name in adjacent cell
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i].trim();
            // Check if this cell is a position number
            if (/^\s*[123]\s*$/.test(cell)) {
              position = parseInt(cell, 10);
              // Horse name is likely in the next non-empty cell
              for (let j = i + 1; j < Math.min(i + 4, cells.length); j++) {
                const nextCell = cells[j].trim();
                const normalized = normalizeHorseName(nextCell);
                const validation = validateHorseName(normalized, debug.hrnCandidateRejectedReasons);
                if (validation.valid) {
                  horseNameRaw = nextCell;
                  break;
                }
              }
              if (horseNameRaw) break;
            }
          }
          
          // Fallback: If no position found, try to find horse name in first few cells
          if (!position && !horseNameRaw && cells.length > 0) {
            for (const cell of cells.slice(0, 5)) {
              const normalized = normalizeHorseName(cell);
              const validation = validateHorseName(normalized, debug.hrnCandidateRejectedReasons);
              if (validation.valid) {
                horseNameRaw = cell;
                // Assume row order: 1st row = win, 2nd = place, 3rd = show
                position = rowIndex + 1;
                break;
              }
            }
          }
          
          if (horseNameRaw) {
            const horseName = normalizeHorseName(horseNameRaw);
            const validation = validateHorseName(horseName, debug.hrnCandidateRejectedReasons);
            if (validation.valid) {
              tableRows.push({ position: position || (rowIndex + 1), horseName, raw: horseNameRaw });
              rowIndex++;
            }
          }
        }
        
        // If we found at least 3 valid rows, use this table
        if (tableRows.length >= 3) {
          rows.push(...tableRows);
          foundTable = true;
          break;
        } else if (tableRows.length > 0) {
          // Store partial results but keep looking
          rows.push(...tableRows);
        }
      }
      
      if (foundTable) break;
    }
    
    // Extract Win/Place/Show from collected rows
    if (rows.length >= 1 && !outcome.win) {
      const winner = rows.find(r => r.position === 1) || rows[0];
      outcome.win = winner.horseName;
      debug.hrnOutcomeRaw.win = winner.raw || "";
    }
    if (rows.length >= 2 && !outcome.place) {
      const place = rows.find(r => r.position === 2) || rows[1];
      outcome.place = place.horseName;
      debug.hrnOutcomeRaw.place = place.raw || "";
    }
    if (rows.length >= 3 && !outcome.show) {
      const show = rows.find(r => r.position === 3) || rows[2];
      outcome.show = show.horseName;
      debug.hrnOutcomeRaw.show = show.raw || "";
    }
    
    if (outcome.win && outcome.place && outcome.show) {
      debug.hrnParsedBy = "table";
    }
    
    // STRATEGY 2: Look for explicit "Win / Place / Show" labels and parse adjacent horse names
    // Only search within results region (targetHtml) to avoid matching JS code
    if ((!outcome.win || !outcome.place || !outcome.show) && targetHtml && targetHtml.length > 100) {
      // Pattern: "Win:" or "Win" followed by horse name (case insensitive)
      // Updated patterns to be more restrictive - require at least 3 chars, avoid dots
      const winLabelPatterns = [
        /(?:^|\s|>|:)\s*Win\s*[:–—\-]?\s*([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[|\$)/i,
        /Win\s+Payout[^:]*:\s*\$?[\d,]+\.?\d*\s+([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[)/i,
      ];
      
      const placeLabelPatterns = [
        /(?:^|\s|>|:)\s*Place\s*[:–—\-]?\s*([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[|\$)/i,
        /Place\s+Payout[^:]*:\s*\$?[\d,]+\.?\d*\s+([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[)/i,
      ];
      
      const showLabelPatterns = [
        /(?:^|\s|>|:)\s*Show\s*[:–—\-]?\s*([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[|\$)/i,
        /Show\s+Payout[^:]*:\s*\$?[\d,]+\.?\d*\s+([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[)/i,
      ];
      
      for (const pattern of winLabelPatterns) {
        const match = targetHtml.match(pattern);
        if (match && match[1] && !outcome.win) {
          const raw = match[1].trim();
          const normalized = normalizeHorseName(raw);
          const validation = validateHorseName(normalized, debug.hrnCandidateRejectedReasons);
          if (validation.valid) {
            outcome.win = normalized;
            debug.hrnOutcomeRaw.win = raw;
            if (!debug.hrnParsedBy) debug.hrnParsedBy = "labels";
            break;
          }
        }
      }
      
      for (const pattern of placeLabelPatterns) {
        const match = targetHtml.match(pattern);
        if (match && match[1] && !outcome.place) {
          const raw = match[1].trim();
          const normalized = normalizeHorseName(raw);
          const validation = validateHorseName(normalized, debug.hrnCandidateRejectedReasons);
          if (validation.valid) {
            outcome.place = normalized;
            debug.hrnOutcomeRaw.place = raw;
            if (!debug.hrnParsedBy) debug.hrnParsedBy = "labels";
            break;
          }
        }
      }
      
      for (const pattern of showLabelPatterns) {
        const match = targetHtml.match(pattern);
        if (match && match[1] && !outcome.show) {
          const raw = match[1].trim();
          const normalized = normalizeHorseName(raw);
          const validation = validateHorseName(normalized, debug.hrnCandidateRejectedReasons);
          if (validation.valid) {
            outcome.show = normalized;
            debug.hrnOutcomeRaw.show = raw;
            if (!debug.hrnParsedBy) debug.hrnParsedBy = "labels";
            break;
          }
        }
      }
    }
    
    // STRATEGY 3: Regex fallbacks - capture patterns like "Win" followed by horse name
    // Only search within results region (targetHtml) to avoid matching JS code
    // More restrictive patterns - no dots allowed, must be at least 3 chars
    if ((!outcome.win || !outcome.place || !outcome.show) && targetHtml && targetHtml.length > 100) {
      // Pattern: Look for sequences like "Win [horse name]", avoiding odds/payout numbers
      // Updated: removed dots from character class, require at least 3 chars
      const regexPatterns = [
        // Pattern: "Win" followed by optional punctuation, then horse name (no dots!)
        { key: "win", regex: /Win\s*[:\-—–]?\s*([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[|\$|(?:\d+\.[\d,]+)|Win|Place|Show)/i },
        { key: "place", regex: /Place\s*[:\-—–]?\s*([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[|\$|(?:\d+\.[\d,]+)|Win|Place|Show)/i },
        { key: "show", regex: /Show\s*[:\-—–]?\s*([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[|\$|(?:\d+\.[\d,]+)|Win|Place|Show)/i },
        // Alternative: Look for position numbers (1st, 2nd, 3rd) followed by horse name
        { key: "win", regex: /(?:1st|First|1\s+st)\s+([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[)/i },
        { key: "place", regex: /(?:2nd|Second|2\s+nd)\s+([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[)/i },
        { key: "show", regex: /(?:3rd|Third|3\s+rd)\s+([A-Za-z][A-Za-z0-9\s'\-]{2,30}?)(?:\s|$|,|;|<|\(|\[)/i },
      ];
      
      for (const { key, regex } of regexPatterns) {
        if ((key === "win" && outcome.win) || (key === "place" && outcome.place) || (key === "show" && outcome.show)) {
          continue; // Already found
        }
        
        const match = targetHtml.match(regex);
        if (match && match[1]) {
          const raw = match[1].trim();
          const normalized = normalizeHorseName(raw);
          const validation = validateHorseName(normalized, debug.hrnCandidateRejectedReasons);
          if (validation.valid) {
            if (key === "win" && !outcome.win) {
              outcome.win = normalized;
              debug.hrnOutcomeRaw.win = raw;
              if (!debug.hrnParsedBy) debug.hrnParsedBy = "regex";
            } else if (key === "place" && !outcome.place) {
              outcome.place = normalized;
              debug.hrnOutcomeRaw.place = raw;
              if (!debug.hrnParsedBy) debug.hrnParsedBy = "regex";
            } else if (key === "show" && !outcome.show) {
              outcome.show = normalized;
              debug.hrnOutcomeRaw.show = raw;
              if (!debug.hrnParsedBy) debug.hrnParsedBy = "regex";
            }
          }
        }
      }
    }
    
    // Final normalization and strict validation
    outcome.win = normalizeHorseName(outcome.win);
    outcome.place = normalizeHorseName(outcome.place);
    outcome.show = normalizeHorseName(outcome.show);
    
    // Final validation with strict rules - reject any invalid candidates
    const winValidation = validateHorseName(outcome.win, debug.hrnCandidateRejectedReasons);
    if (!winValidation.valid) {
      outcome.win = "";
      debug.hrnOutcomeRaw.win = "";
    }
    
    const placeValidation = validateHorseName(outcome.place, debug.hrnCandidateRejectedReasons);
    if (!placeValidation.valid) {
      outcome.place = "";
      debug.hrnOutcomeRaw.place = "";
    }
    
    const showValidation = validateHorseName(outcome.show, debug.hrnCandidateRejectedReasons);
    if (!showValidation.valid) {
      outcome.show = "";
      debug.hrnOutcomeRaw.show = "";
    }
    
    // Store normalized values in debug
    debug.hrnOutcomeNormalized = {
      win: outcome.win,
      place: outcome.place,
      show: outcome.show,
    };
    
    // If no valid outcome found, mark as "none" (don't return false positives)
    if (!outcome.win && !outcome.place && !outcome.show) {
      debug.hrnParsedBy = "none";
    } else if (!debug.hrnParsedBy) {
      // Partial results found but strategy not recorded (shouldn't happen, but handle it)
      debug.hrnParsedBy = "partial";
    }
    
  } catch (err) {
    console.error("[extractOutcomeFromHrnHtml] Parse error:", err.message || err);
    debug.hrnParsedBy = "error";
    // Return empty outcome on error - never throw
    // CRITICAL: Ensure outcome has no ok property
    const cleanErrorOutcome = { win: "", place: "", show: "" };
    delete cleanErrorOutcome.ok;
    return { outcome: cleanErrorOutcome, debug };
  }
  
  // CRITICAL: Clean outcome before returning - ensure no ok property exists
  // This prevents any contamination from object mutations or property assignments
  const cleanReturnOutcome = {
    win: (outcome.win && typeof outcome.win === 'string') ? outcome.win : "",
    place: (outcome.place && typeof outcome.place === 'string') ? outcome.place : "",
    show: (outcome.show && typeof outcome.show === 'string') ? outcome.show : "",
  };
  // Explicitly delete ok if it exists (defensive cleanup)
  delete cleanReturnOutcome.ok;
  
  // CRITICAL: If outcome somehow got an ok property, log it for debugging
  if ('ok' in outcome && outcome.ok !== undefined) {
    console.error(`[extractOutcomeFromHrnHtml] CRITICAL: outcome has unexpected ok property (value: ${JSON.stringify(outcome.ok)})`);
    console.error(`[extractOutcomeFromHrnHtml] Stack:`, new Error().stack);
    console.error(`[extractOutcomeFromHrnHtml] Outcome object:`, JSON.stringify(outcome));
  }
  
  return { outcome: cleanReturnOutcome, debug };
}

/**
 * Extract Win/Place/Show from Equibase chart HTML
 * Parses the finishing order table to find horses in positions 1, 2, 3
 * @param {string} html - Equibase page HTML
 * @returns {{ win: string, place: string, show: string }}
 */
function extractOutcomeFromEquibaseHtml(html) {
  const outcome = { win: "", place: "", show: "" };
  
  if (!html || typeof html !== "string") {
    return outcome;
  }
  
  // Check for bot blocking (common patterns)
  if (html.includes("Incapsula") || html.includes("_Incapsula_Resource") || html.length < 2000) {
    // Likely bot-blocked, return empty
    return outcome;
  }
  
  try {
    // Helper to decode HTML entities
    const decodeEntity = (str) => {
      if (!str) return "";
      return str
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&#160;/g, " ")
        .trim();
    };
    
    // Helper to validate horse name
    const isValid = (name) => {
      if (!name || name.length === 0) return false;
      if (name.length > 50) return false;
      if (!/[A-Za-z]/.test(name)) return false;
      if (name.includes("<") || name.includes(">") || name.includes("function")) return false;
      if (/^\d+$/.test(name)) return false;
      if (name.toLowerCase().includes("finish") || name.toLowerCase().includes("position")) return false;
      return true;
    };
    
    // Strategy A: Look for finishing order table
    // Equibase typically has a table with Finish/Horse columns
    const finishTablePattern = /<table[^>]*>[\s\S]*?(?:Finish|Fin|Horse|Pos)[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i;
    const tableMatch = html.match(finishTablePattern);
    
    if (tableMatch) {
      const tbody = tableMatch[1];
      
      // Extract rows and look for position 1, 2, 3
      const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const finishMap = {};
      
      let trMatch;
      while ((trMatch = trPattern.exec(tbody)) !== null) {
        const rowHtml = trMatch[1];
        
        // Extract all TDs
        const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let tdMatch;
        while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
          const cellContent = tdMatch[1]
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .trim();
          cells.push(cellContent);
        }
        
        // Look for position number (usually first or second cell)
        // And horse name (usually after position)
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const positionMatch = cell.match(/^(\d+)$/);
          
          if (positionMatch) {
            const position = parseInt(positionMatch[1], 10);
            if (position >= 1 && position <= 3 && !finishMap[position]) {
              // Horse name is likely in the next cell or a few cells after
              for (let j = i + 1; j < Math.min(i + 4, cells.length); j++) {
                const nameCandidate = decodeEntity(cells[j])
                  .replace(/\s*\([^)]+\)\s*$/, "") // Remove odds/comments in parentheses
                  .trim();
                
                if (isValid(nameCandidate)) {
                  finishMap[position] = nameCandidate;
                  break;
                }
              }
            }
          }
        }
      }
      
      if (finishMap[1]) outcome.win = finishMap[1];
      if (finishMap[2]) outcome.place = finishMap[2];
      if (finishMap[3]) outcome.show = finishMap[3];
    }
    
    // Strategy B: Look for Win/Place/Show text patterns
    if (!outcome.win || !outcome.place || !outcome.show) {
      // Try to find text like "Win: Horse Name" or "1. Horse Name"
      const winPattern = /(?:Win|Winner|1st)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      const placePattern = /(?:Place|2nd)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      const showPattern = /(?:Show|3rd)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      
      const winMatch = html.match(winPattern);
      const placeMatch = html.match(placePattern);
      const showMatch = html.match(showPattern);
      
      if (winMatch && winMatch[1] && !outcome.win) {
        const name = decodeEntity(winMatch[1].trim());
        if (isValid(name)) {
          outcome.win = name;
        }
      }
      
      if (placeMatch && placeMatch[1] && !outcome.place) {
        const name = decodeEntity(placeMatch[1].trim());
        if (isValid(name)) {
          outcome.place = name;
        }
      }
      
      if (showMatch && showMatch[1] && !outcome.show) {
        const name = decodeEntity(showMatch[1].trim());
        if (isValid(name)) {
          outcome.show = name;
        }
      }
    }
    
    // Strategy C: Look for numbered list pattern "1. Horse Name"
    if (!outcome.win || !outcome.place || !outcome.show) {
      const numberedPattern = /(\d+)\.\s*([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/gi;
      const numberedMap = {};
      
      let match;
      while ((match = numberedPattern.exec(html)) !== null) {
        const position = parseInt(match[1], 10);
        if (position >= 1 && position <= 3 && !numberedMap[position]) {
          const name = decodeEntity(match[2].trim());
          if (isValid(name)) {
            numberedMap[position] = name;
          }
        }
      }
      
      if (!outcome.win && numberedMap[1]) outcome.win = numberedMap[1];
      if (!outcome.place && numberedMap[2]) outcome.place = numberedMap[2];
      if (!outcome.show && numberedMap[3]) outcome.show = numberedMap[3];
    }
    
    // Final validation
    if (!isValid(outcome.win)) outcome.win = "";
    if (!isValid(outcome.place)) outcome.place = "";
    if (!isValid(outcome.show)) outcome.show = "";
    
  } catch (err) {
    console.error("[extractOutcomeFromEquibaseHtml] Parse error:", err.message || err);
    return { win: "", place: "", show: "" };
  }
  
  return outcome;
}

/**
 * Extract Win/Place/Show from Google HTML using regex
 * This is a lightweight parser that matches Google AI Overview format:
 * "Win: Doc Sullivan", "Place: Dr. Kraft", "Show: Bank Frenzy"
 */
function extractOutcomeFromGoogleHtml(html) {
  if (!html || typeof html !== "string") {
    return { win: "", place: "", show: "" };
  }

  // Three separate regex patterns, one per line
  // Pattern matches "Win:", "Place:", "Show:" followed by optional whitespace and horse name
  // [A-Za-z0-9 .,'’-]+ matches letters, numbers, spaces, and common punctuation
  const winRegex = /Win:\s*([A-Za-z0-9 .,'’-]+)/i;
  const placeRegex = /Place:\s*([A-Za-z0-9 .,'’-]+)/i;
  const showRegex = /Show:\s*([A-Za-z0-9 .,'’-]+)/i;

  // Apply regex patterns
  const winMatch = html.match(winRegex);
  const placeMatch = html.match(placeRegex);
  const showMatch = html.match(showRegex);

  /**
   * Clean and validate a horse name match
   * @param {RegExpMatchArray|null} match - The regex match result
   * @returns {string} - Cleaned horse name or empty string if invalid
   */
  function cleanMatch(match) {
    if (!match?.[1]) return "";
    
    // Get the captured group and trim
    let cleaned = match[1].trim();
    
    // Decode HTML entities
    cleaned = decodeHtmlEntities(cleaned);
    
    // Strip trailing characters after common delimiters: <, ", ', {, }, ;
    cleaned = cleaned.split(/[<"'{};]/)[0].trim();
    
    // Validation rules: horse name is valid only if:
    // 1. Length ≤ 40 chars
    // 2. Contains at least 1 letter
    // 3. Does NOT contain JS code patterns
    if (
      !cleaned ||
      cleaned.length === 0 ||
      cleaned.length > 40 ||
      !/[A-Za-z]/.test(cleaned) || // Must contain at least one letter
      cleaned.includes("function") ||
      cleaned.includes("=>") ||
      cleaned.includes("prototype") ||
      cleaned.includes("call:") ||
      cleaned.includes("splice") ||
      cleaned.includes("push") ||
      cleaned.includes("pop") ||
      cleaned.includes("<script") ||
      /[{}()=>]/.test(cleaned) || // No JS code patterns
      /^\d+$/.test(cleaned) || // Pure numbers are not horse names
      /^[A-Z],/.test(cleaned) // Patterns like "P,splice" are JS code
    ) {
      return "";
    }
    
    return cleaned;
  }

  const win = cleanMatch(winMatch);
  const place = cleanMatch(placeMatch);
  const show = cleanMatch(showMatch);

  return { win, place, show };
}

/**
 * Build stub response (ultra-safe fallback with Google HTML parsing)
 * This is the default behavior when VERIFY_RACE_MODE is not set to "full"
 * Now enhanced to fetch and parse Google HTML for Win/Place/Show
 */
/**
 * Sanitize response object to ensure ok is always boolean
 * CRITICAL: Prevents type corruption bugs where ok might be string or other type
 */
function sanitizeResponse(response) {
  if (!response || typeof response !== "object") return response;
  
  // CRITICAL: Defensively clean outcome before spreading to prevent ok property contamination
  const cleanResponse = { ...response };
  
  // Ensure outcome has no ok property (defensive cleanup)
  if (cleanResponse.outcome && typeof cleanResponse.outcome === 'object') {
    const cleanOutcome = {
      win: cleanResponse.outcome.win || "",
      place: cleanResponse.outcome.place || "",
      show: cleanResponse.outcome.show || "",
    };
    delete cleanOutcome.ok;
    cleanResponse.outcome = cleanOutcome;
  }
  
  // CRITICAL: Ensure ok is boolean - compute from outcome validation if corrupted
  if (typeof cleanResponse.ok !== "boolean") {
    console.error(`[verify_race] CRITICAL: ok is not boolean (type: ${typeof cleanResponse.ok}, value: ${JSON.stringify(cleanResponse.ok)}) - coercing to boolean`);
    console.error(`[verify_race] Stack:`, new Error().stack);
    console.error(`[verify_race] Response context:`, JSON.stringify({ step: cleanResponse.step, outcome: cleanResponse.outcome }));
    
    // Compute ok from outcome validation if corrupted
    const outcome = cleanResponse.outcome || {};
    // CRITICAL: Ensure hasValidOutcome is ALWAYS boolean (not string like outcome.show)
    const hasValidOutcome = Boolean(outcome.win && outcome.place && outcome.show);
    cleanResponse.ok = hasValidOutcome;
    
    if (!cleanResponse.debug) cleanResponse.debug = {};
    cleanResponse.debug.okTypeError = `ok was coerced from ${typeof response.ok} to boolean`;
    cleanResponse.debug.okOriginalType = typeof response.ok;
    cleanResponse.debug.okOriginalValue = response.ok;
    cleanResponse.debug.okComputedFromOutcome = hasValidOutcome; // Always boolean
  }
  
  return cleanResponse;
}

async function buildStubResponse({ track, date, raceNo, predicted = {}, uiDateRaw = null }) {
  // CRITICAL: date should already be canonical ISO from handler
  // Use it as-is - no fallback to today, no re-normalization
  // If date is missing, that's an upstream bug - log warning but use empty string
  let usingDate = "";
  if (date && typeof date === "string") {
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      usingDate = trimmed;  // Already ISO - use as-is (no modification)
    } else {
      // Try to normalize MM/DD/YYYY format (defensive check only)
      const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (mdy) {
        const [, mm, dd, yyyy] = mdy;
        usingDate = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      } else {
        console.warn("[buildStubResponse] Non-ISO date format, using as-is:", trimmed);
        usingDate = trimmed;
      }
    }
  } else if (date) {
    console.warn("[buildStubResponse] Date is not a string:", typeof date, date);
    usingDate = String(date).trim();
  } else {
    console.warn("[buildStubResponse] Date is missing - this should not happen if handler validated correctly");
    usingDate = "";  // Do NOT fall back to today
  }
  const safeTrack =
    typeof track === "string" && track.trim() ? track.trim() : "";
  const raceNoStr = String(raceNo ?? "").trim() || "";

  const query = [
    safeTrack || "Unknown Track",
    raceNoStr ? `Race ${raceNoStr}` : "",
    usingDate || "",
    "results Win Place Show",
  ]
    .filter(Boolean)
    .join(" ");

  const googleUrl =
    "https://www.google.com/search?q=" + encodeURIComponent(query);

  // Default outcome = empty (original stub behavior)
  let outcome = { win: "", place: "", show: "" };
  let step = "verify_race_google_only_stub";

  // Try to fetch Google HTML and parse W/P/S with regex
  let googleHtml = null;
  let hrnUrl = null;
  let hrnOutcome = null;
  let hrnParseError = null;
  // Initialize hrnDebugFields early to ensure it's always available if HRN is attempted
  let hrnDebugFields = null;
  
  try {
    const res = await fetch(googleUrl, {
      method: "GET",
      headers: {
        // Keep headers minimal to avoid attracting bot detection; these are just "normal browser-ish" hints
        "User-Agent":
          "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (res && res.ok) {
      googleHtml = await res.text();
      outcome = extractOutcomeFromGoogleHtml(googleHtml);

      // Only mark as parsed if all three positions were found
      if (outcome && outcome.win && outcome.place && outcome.show) {
        step = "verify_race_google_parsed_stub";
      }
    }
  } catch (err) {
    // Swallow errors to keep stub ultra-safe
    console.error("[verify_race stub] Google fetch/parse failed:", err);
  }

  // ALWAYS try HRN fallback if we have track, date, and Google didn't find all three
  // This ensures HRN is attempted even if Google fetch fails or doesn't contain results
  let hrnAttempted = false;
  let hrnHttpStatus = null;
  // Note: hrnDebugFields is already declared above, we'll populate it below
  
  if (!outcome.win || !outcome.place || !outcome.show) {
    if (safeTrack && usingDate) {
      hrnAttempted = true; // Mark that we attempted HRN (set early, before any async operations)
      try {
        // First try to extract HRN URL from Google HTML (if we have it)
        if (googleHtml) {
          hrnUrl = extractHrnUrlFromGoogleHtml(googleHtml);
        }
        
        // If not found in Google HTML, construct it directly from track/date
        if (!hrnUrl) {
          hrnUrl = buildHrnUrl(safeTrack, usingDate);
        }
        
        if (hrnUrl) {
          try {
            const hrnRes = await fetch(hrnUrl, {
              method: "GET",
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
                "Accept-Language": "en-US,en;q=0.9",
              },
            });
            
            hrnHttpStatus = hrnRes ? hrnRes.status : null;
            
            if (hrnRes && hrnRes.ok) {
              const hrnHtml = await hrnRes.text();
              const hrnResult = extractOutcomeFromHrnHtml(hrnHtml, raceNoStr);
              hrnOutcome = hrnResult.outcome;
              
              // CRITICAL: Store ALL HRN debug fields - ensure hrnDebugFields is always set when HRN attempted
              if (hrnResult.debug && typeof hrnResult.debug === 'object') {
                hrnDebugFields = { ...hrnResult.debug }; // Copy all fields
              } else {
                // If debug is missing, initialize empty object so we at least track that HRN was attempted
                hrnDebugFields = { hrnParsedBy: "error", hrnParseError: "Debug object missing from parse result" };
              }
              
              // If HRN parsing found at least one result, use it
              // Note: We'll validate later in the function before setting ok=true
              // CRITICAL: Only copy win/place/show properties - never spread entire object which might contain ok
              if (hrnOutcome && (hrnOutcome.win || hrnOutcome.place || hrnOutcome.show)) {
                // Defensively copy only the properties we want - prevent any accidental ok property
                outcome = {
                  win: hrnOutcome.win || "",
                  place: hrnOutcome.place || "",
                  show: hrnOutcome.show || "",
                };
                // Ensure no ok property exists in outcome (defensive)
                delete outcome.ok;
                // Mark as HRN fallback if we got all three, otherwise keep as partial
                // Note: Final ok status will be determined by validation
                if (outcome.win && outcome.place && outcome.show) {
                  step = "verify_race_fallback_hrn";
                } else {
                  step = "verify_race_fallback_hrn_partial";
                }
              } else {
                hrnParseError = "No outcome parsed from HRN HTML";
                // Ensure hrnParsedBy is set even if no outcome
                if (hrnDebugFields && !hrnDebugFields.hrnParsedBy) {
                  hrnDebugFields.hrnParsedBy = "none";
                }
              }
            } else {
              hrnParseError = `HTTP ${hrnHttpStatus || "unknown"}`;
              // Initialize debug fields even on HTTP error
              if (!hrnDebugFields) {
                hrnDebugFields = { hrnParsedBy: "http_error", hrnParseError };
              }
            }
          } catch (hrnErr) {
            hrnParseError = String(hrnErr.message || hrnErr);
            console.error("[verify_race stub] HRN fetch/parse failed:", hrnErr);
            // Initialize debug fields even on exception
            if (!hrnDebugFields) {
              hrnDebugFields = { hrnParsedBy: "error", hrnParseError };
            }
          }
        } else {
          hrnParseError = "No HRN URL available";
          // Initialize debug fields even when URL unavailable
          if (!hrnDebugFields) {
            hrnDebugFields = { hrnParsedBy: "none", hrnParseError };
          }
        }
      } catch (err) {
        hrnParseError = String(err.message || err);
        console.error("[verify_race stub] HRN fallback error:", err);
        // Initialize debug fields even on outer exception
        if (!hrnDebugFields) {
          hrnDebugFields = { hrnParsedBy: "error", hrnParseError };
        }
      }
    } else {
      // Track that HRN was not attempted due to missing track/date
      if (!safeTrack || !usingDate) {
        // Don't set hrnAttempted=true if we don't have required fields
        // hrnAttempted stays false, which is correct
      }
    }
  }

  const predictedNormalized = normalizePrediction(predicted);

  // Compute hits using normalized horse names
  const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const norm = normalizeHorseName;
  const pWin = norm(predictedNormalized.win);
  const pPlace = norm(predictedNormalized.place);
  const pShow = norm(predictedNormalized.show);
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
    .some(name => top3Set.has(name));

  const hits = {
    winHit,
    placeHit,
    showHit,
    top3Hit,
  };

  // Build base summary using helper (wrapped in try/catch for safety)
  let baseSummary = "";
  try {
    baseSummary = buildSummary({
      date: usingDate,
      uiDateRaw: null, // buildStubResponse doesn't receive ctx, so uiDateRaw is not available here
      outcome,
      step,
      query,
    });
  } catch (err) {
    console.error("[buildStubResponse] Error building summary:", err);
    baseSummary = `Step: ${step || "unknown"}\nOutcome:\n  Win: ${outcome.win || "-"}\n  Place: ${outcome.place || "-"}\n  Show: ${outcome.show || "-"}`;
  }
  
  // Append predicted and hits info
  const summaryLines = baseSummary.split("\n");
  const predictedParts = [predictedNormalized.win, predictedNormalized.place, predictedNormalized.show].filter(Boolean);
  if (predictedParts.length) {
    summaryLines.push(`Predicted: ${predictedParts.join(" / ")}`);
  } else {
    summaryLines.push("Predicted: (none)");
  }

  // Show hits
  const hitParts = [];
  if (hits.winHit) hitParts.push("winHit");
  if (hits.placeHit) hitParts.push("placeHit");
  if (hits.showHit) hitParts.push("showHit");
  if (hits.top3Hit) hitParts.push("top3Hit");
  summaryLines.push(`Hits: ${hitParts.length ? hitParts.join(", ") : "(none)"}`);

  if (!outcome.win && !outcome.place && !outcome.show) {
    summaryLines.push("");
    summaryLines.push(
      "Parser note: Google page fetched but Win/Place/Show could not be reliably parsed. Read the Google tab if needed."
    );
  }

  const summary = summaryLines.join("\n");
  
  // STRICT VALIDATION: Final gate check - use same validateHorseName logic as extractOutcomeFromHrnHtml
  // Note: HRN parsing already validates internally, but we do a final gate check for safety
  const validateHorseName = (name) => {
    if (!name || name.length === 0) return { valid: false, reason: "empty_name" };
    if (name.length < 3) return { valid: false, reason: "too_short" };
    if (name.length > 50) return { valid: false, reason: "too_long" };
    if (!/[A-Za-z]/.test(name)) return { valid: false, reason: "no_letters" };
    if (name.includes(".")) return { valid: false, reason: "contains_dot" };
    if (name.includes("<") || name.includes(">") || name.includes("=")) return { valid: false, reason: "contains_html" };
    const jsKeywords = ["datalayer", "dow", "window", "document", "function", "var", "let", "const", "this", "place", "win", "show", "true", "false", "null", "undefined"];
    const nameLower = name.toLowerCase().trim();
    if (jsKeywords.includes(nameLower)) return { valid: false, reason: `js_keyword:${nameLower}` };
    const genericTokens = ["this", "place", "win", "show", "the", "a", "an", "is", "are", "was", "were"];
    if (genericTokens.includes(nameLower)) return { valid: false, reason: `generic_token:${nameLower}` };
    if (name.includes("function") || name.includes("=>") || name.includes("()")) return { valid: false, reason: "contains_code" };
    if (/^\d+$/.test(name)) return { valid: false, reason: "pure_numbers" };
    if (name.toLowerCase().includes("finish") || name.toLowerCase().includes("position")) return { valid: false, reason: "contains_finish_position" };
    if (name.toLowerCase().includes("win:") || name.toLowerCase().includes("place:") || name.toLowerCase().includes("show:")) return { valid: false, reason: "contains_label" };
    if (/^\$?[\d,]+\.?\d*$/.test(name)) return { valid: false, reason: "currency_only" };
    if (/[{}()=>]/.test(name) || /^[A-Z],/.test(name)) return { valid: false, reason: "js_pattern" };
    return { valid: true, reason: null };
  };
  
  // Final validation gate - validate what we have (HRN parsing already validated, but safety check)
  // Save original values before validation to track rejections
  const originalWin = outcome.win;
  const originalPlace = outcome.place;
  const originalShow = outcome.show;
  
  const winValid = validateHorseName(outcome.win);
  const placeValid = validateHorseName(outcome.place);
  const showValid = validateHorseName(outcome.show);
  
  // Track if we need to clear any invalid outcomes
  let validationFailed = false;
  if (originalWin && !winValid.valid) {
    outcome.win = "";
    validationFailed = true;
  }
  if (originalPlace && !placeValid.valid) {
    outcome.place = "";
    validationFailed = true;
  }
  if (originalShow && !showValid.valid) {
    outcome.show = "";
    validationFailed = true;
  }
  
  // CRITICAL: Ensure outcome never has an ok property (defensive cleanup before computing ok)
  if (outcome && typeof outcome === 'object') {
    delete outcome.ok;
  }
  
  // STRICT OK: ok=true ONLY if we have ALL THREE non-empty AND validated W/P/S
  // Compute ok in exactly one place based on validated outcome - never from object properties
  const hasAllValidOutcome = winValid.valid && placeValid.valid && showValid.valid && outcome.win && outcome.place && outcome.show;
  const ok = Boolean(hasAllValidOutcome); // Explicitly coerce to boolean - never trust implicit conversion
  
  // If validation failed or missing W/P/S, update hrnDebugFields if HRN was attempted
  // CRITICAL: Ensure hrnDebugFields exists if hrnAttempted is true
  if (hrnAttempted) {
    // Initialize hrnDebugFields if it doesn't exist (shouldn't happen, but defensive)
    if (!hrnDebugFields || typeof hrnDebugFields !== 'object') {
      hrnDebugFields = { hrnParsedBy: "none" };
    }
    
    if (!hrnDebugFields.hrnCandidateRejectedReasons) {
      hrnDebugFields.hrnCandidateRejectedReasons = [];
    }
    if (validationFailed) {
      if (originalWin && !winValid.valid) {
        hrnDebugFields.hrnCandidateRejectedReasons.push(`win_rejected:${winValid.reason}:${originalWin}`);
      }
      if (originalPlace && !placeValid.valid) {
        hrnDebugFields.hrnCandidateRejectedReasons.push(`place_rejected:${placeValid.reason}:${originalPlace}`);
      }
      if (originalShow && !showValid.valid) {
        hrnDebugFields.hrnCandidateRejectedReasons.push(`show_rejected:${showValid.reason}:${originalShow}`);
      }
    }
    // If we don't have all three validated outcomes, ensure hrnParsedBy reflects this
    if (!hasAllValidOutcome) {
      if (validationFailed) {
        // Validation failed - mark as validation_failed if we had a parse method
        if (hrnDebugFields.hrnParsedBy && hrnDebugFields.hrnParsedBy !== "none" && hrnDebugFields.hrnParsedBy !== "error") {
          hrnDebugFields.hrnParsedBy = "validation_failed";
        } else {
          hrnDebugFields.hrnParsedBy = "none";
        }
      } else if (!outcome.win || !outcome.place || !outcome.show) {
        // Partial results - hrnParsedBy can stay as "table"/"labels"/"regex" but ok=false because incomplete
        // Don't change hrnParsedBy, just ensure it's set
        if (!hrnDebugFields.hrnParsedBy || hrnDebugFields.hrnParsedBy === null) {
          hrnDebugFields.hrnParsedBy = "partial";
        }
      } else {
        // No outcome at all
        if (!hrnDebugFields.hrnParsedBy || hrnDebugFields.hrnParsedBy === null) {
          hrnDebugFields.hrnParsedBy = "none";
        }
      }
    }
  }
  
  // Initialize debug object - NEVER reassign, only merge
  const debug = {
    googleUrl,
    backendVersion: BACKEND_VERSION,
    handlerFile: HANDLER_FILE,
    canonicalDateIso: usingDate,
  };
  
  // Add uiDateRaw if provided (merge, don't reassign)
  if (uiDateRaw !== null && uiDateRaw !== undefined) {
    debug.uiDateRaw = uiDateRaw;
  }
  
  // Merge ALL HRN debug fields if HRN was attempted (merge, don't reassign)
  if (hrnAttempted) {
    debug.hrnAttempted = true;
    if (hrnUrl) {
      debug.hrnUrl = hrnUrl;
    }
    if (hrnHttpStatus !== null) {
      debug.hrnHttpStatus = hrnHttpStatus;
    }
    if (hrnParseError) {
      debug.hrnParseError = hrnParseError;
    }
    
    // Merge ALL fields from hrnDebugFields (not just selective ones) - use Object.assign to merge into existing debug
    if (hrnDebugFields && typeof hrnDebugFields === 'object') {
      Object.assign(debug, hrnDebugFields);
    }
    
    // If ok=false after validation, ensure hrnParsedBy reflects this
    if (!ok && !debug.hrnParsedBy) {
      debug.hrnParsedBy = "none";
    }
  }
  
  // Set source based on step (merge, don't reassign)
  if (step && step.includes("hrn")) {
    debug.source = "hrn";
  } else if (step && step.includes("google")) {
    debug.source = "google";
  }
  
  // Store googleHtml in debug for potential future use (but don't send it in response to avoid bloat)
  // We'll just keep it for internal reference if needed
  
  // CRITICAL: Final defensive cleanup - ensure outcome has no ok property and ok is boolean
  const cleanOutcome = {
    win: (outcome && typeof outcome.win === 'string') ? outcome.win : "",
    place: (outcome && typeof outcome.place === 'string') ? outcome.place : "",
    show: (outcome && typeof outcome.show === 'string') ? outcome.show : "",
  };
  // Explicitly ensure no ok property exists (defensive cleanup)
  delete cleanOutcome.ok;
  
  // CRITICAL: Final recomputation of ok from cleaned outcome - NEVER trust existing ok variable
  // ALWAYS compute ok as boolean explicitly to prevent contamination
  // This prevents any corruption from object spreads, destructuring, or variable shadowing
  const finalOk = Boolean(
    cleanOutcome.win && 
    cleanOutcome.place && 
    cleanOutcome.show &&
    winValid.valid && 
    placeValid.valid && 
    showValid.valid
  );
  
  // CRITICAL: Assert ok is boolean before returning (debug guard)
  if (typeof finalOk !== 'boolean') {
    console.error(`[verify_race] CRITICAL BUG: finalOk is ${typeof finalOk} (value: ${JSON.stringify(finalOk)}) in buildStubResponse return`);
    console.error(`[verify_race] Stack:`, new Error().stack);
    console.error(`[verify_race] Context: cleanOutcome=${JSON.stringify(cleanOutcome)}, validations: win=${winValid.valid}, place=${placeValid.valid}, show=${showValid.valid}`);
    // Force to false if assertion fails
    const forcedOk = false;
    return {
      ok: forcedOk,
      step,
      date: usingDate,
      track: safeTrack,
      raceNo: raceNoStr,
      query,
      top: {
        title: `Google search: ${query}`,
        link: googleUrl,
      },
      outcome: cleanOutcome,
      predicted: predictedNormalized,
      hits,
      summary: summary,
      debug: {
        ...debug,
        okComputationError: `finalOk was ${typeof finalOk}, forced to false`,
      },
      responseMeta: {
        handlerFile: HANDLER_FILE,
        backendVersion: BACKEND_VERSION,
        internalBypassAuthorized: false,
      },
    };
  }
  
  return {
    ok: finalOk, // Use recomputed value - never trust the original ok variable
    step,
    date: usingDate,
    track: safeTrack,
    raceNo: raceNoStr,
    query,
    top: {
      title: `Google search: ${query}`,
      link: googleUrl,
    },
    outcome: cleanOutcome, // Use cleaned outcome with no ok property
    predicted: predictedNormalized,
    hits,
    summary: summary,
    debug,
    responseMeta: {
      handlerFile: HANDLER_FILE,
      backendVersion: BACKEND_VERSION,
      internalBypassAuthorized: false, // buildStubResponse is used in error cases, so bypass is false
    },
  };
}

export default async function handler(req, res) {
  // CRITICAL: Declare predmeta at handler scope to prevent ReferenceError in any code path
  // This ensures predmeta is always defined (even if null) in both manual and auto verify paths
  let predmeta = null;
  
  // Helper function to build responseMeta consistently
  const buildResponseMeta = (baseMeta = {}) => {
    const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA || 
                         process.env.VERCEL_GITHUB_COMMIT_SHA || 
                         process.env.VERCEL_GIT_COMMIT_REF || 
                         null;
    const vercelEnv = process.env.VERCEL_ENV || null;
    const commitShort7 = vercelCommit ? vercelCommit.slice(0, 7) : "no-sha"; // 7 chars to match Vercel UI
    return {
      ...baseMeta,
      vercelEnv,
      vercelCommit,
      nodeEnv: process.env.NODE_ENV || null,
      buildStamp: `${vercelEnv || "unknown"}-${commitShort7}`, // Format: preview-ffdd8bf (7-char SHA matches Vercel)
    };
  };
  
  // Check for internal/system flag to bypass PayGate (for verify_backfill batch jobs)
  // Require BOTH internal header AND secret to prevent spoofing
  const internalHeader = req.headers['x-finishline-internal'] === 'true';
  const internalSecret = String(req.headers['x-finishline-internal-secret'] || '').trim();
  const expectedSecret = process.env.INTERNAL_JOB_SECRET || '';
  const secretOk = !!expectedSecret && internalSecret === expectedSecret;
  const isInternalRequest = internalHeader && secretOk;
  let bypassedPayGate = false;
  let internalBypassAuthorized = false;

  // Server-side PayGate check (non-blocking in monitor mode)
  // Skip PayGate ONLY if this is an internal system request with valid secret (e.g., from verify_backfill)
  if (!isInternalRequest) {
    // If header present but secret missing/mismatch, log for security monitoring
    if (internalHeader && !secretOk) {
      console.warn('[verify_race] Internal header present but secret missing/mismatch - enforcing PayGate');
    }
    
    try {
      const { checkPayGateAccess } = await import('../../lib/paygate-server.js');
      const accessCheck = checkPayGateAccess(req);
      if (!accessCheck.allowed) {
        return res.status(403).json({
          ok: false,
          error: 'PayGate locked',
          message: 'Premium access required. Please unlock to continue.',
          code: 'paygate_locked',
          reason: accessCheck.reason,
          step: 'verify_race_error',
          bypassedPayGate: false,
          responseMeta: buildResponseMeta({
            handlerFile: HANDLER_FILE,
            backendVersion: BACKEND_VERSION,
            bypassedPayGate: false,
            internalBypassAuthorized: false
          })
        });
      }
    } catch (paygateErr) {
      // Non-fatal: log but allow request (fail-open for safety)
      console.warn('[verify_race] PayGate check failed (non-fatal):', paygateErr?.message);
    }
  } else {
    // Internal request with valid secret - bypass PayGate
    bypassedPayGate = true;
    internalBypassAuthorized = true;
    console.log('[verify_race] Internal request detected with valid secret - PayGate bypassed');
  }

  // We NEVER throw from this handler. All errors are reported in the JSON body.
  try {
    if (req.method !== "POST") {
      const stub = await buildStubResponse({
        track: null,
        date: null,
        raceNo: null,
      });
      res.setHeader('X-Handler-Identity', 'VERIFY_RACE_STUB');
      // CRITICAL: Ensure ok is always boolean (defensive check against type corruption)
      const sanitizedStub = sanitizeResponse({ ...stub, ok: false });
      return res.status(200).json({
        ...sanitizedStub,
        step: "verify_race_stub",
        error: "METHOD_NOT_ALLOWED",
        message: `Expected POST, received ${req.method}`,
        summary: `Verify Race stub: method ${req.method} is not supported.`,
      });
    }

    const body = await safeParseBody(req);
    
    // CRITICAL: Sanitize request body - explicitly delete ok field to prevent injection
    // Never trust client-provided ok field - always compute it from outcome validation
    if (body && typeof body === 'object') {
      delete body.ok; // Prevent client from injecting ok field
      if (body.outcome && typeof body.outcome === 'object') {
        delete body.outcome.ok; // Prevent client from injecting ok in outcome
      }
      if (body.predicted && typeof body.predicted === 'object') {
        delete body.predicted.ok; // Prevent client from injecting ok in predicted
      }
    }
    
    const track = (body.track || body.trackName || "").trim();
    
    // Normalize predictions from request body (handles multiple formats)
    const predictedFromClient = normalizePredictedFromBody(body);
    
    // Pure string helper for date normalization (no Date objects for user dates)
    function canonicalizeDateFromClient(raw) {
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

      // Fallback: just return trimmed string (NO Date parsing)
      return s;
    }
    
    // Extract the raw date from body (check multiple fields, including dateIso)
    const uiDateRaw =
      (body && (body.date || body.dateRaw || body.dateIso || body.raceDate || body.canonicalDate)) ||
      null;

    let canonicalDateIso = canonicalizeDateFromClient(uiDateRaw);
    
    // Note: PayGate check already performed at top of handler - bypassedPayGate flag is set there
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
      console.warn('[verify_race] PayGate check failed (non-fatal):', paygateErr?.message);
    }

    // Extract raceNo early - needed for error responses and manual verify branch
    const raceNo = (body.raceNo || body.race || "").toString().trim() || "";

    // Detect manual mode
    const isManual = body.mode === "manual";

    // Normal verify: still require a valid date
    if (!canonicalDateIso && !isManual) {
      // If no valid date, respond with 200 JSON (not 400) to match our "never 500" policy
      return res.status(200).json({
        ok: false,
        step: "verify_race_error",
        error: "Missing or invalid date",
        date: "",
        track: track || "",
        raceNo: raceNo || "",
        query: "",
        top: null,
        outcome: { win: "", place: "", show: "" },
        predicted: predictedFromClient,
        hits: {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        summary: "Error: Missing or invalid date",
        debug: {
          backendVersion: BACKEND_VERSION,
          handlerFile: HANDLER_FILE,
        },
        responseMeta: {
          handlerFile: HANDLER_FILE,
          backendVersion: BACKEND_VERSION,
          internalBypassAuthorized: internalBypassAuthorized,
        },
      });
    }

    // Manual verify: if date is missing/invalid, fall back to "today"
    if (!canonicalDateIso && isManual) {
      canonicalDateIso = new Date().toISOString().slice(0, 10);
    }
    
    // Debug log (only in non-production to avoid noisy logs)
    if (process.env.NODE_ENV !== "production") {
      console.log("[VERIFY_DATES] incoming", {
        uiDateRaw,
        canonicalDateIso,
      });
    }

    // Manual verify branch - handle manual outcome entry
    if (body.mode === "manual" && body.outcome) {
      try {
        // CRITICAL: predmeta is already declared at handler scope (line 2652)
        // For manual verify, explicitly set predmeta to null (manual verify doesn't fetch predmeta)
        // This ensures predmeta is never an undeclared identifier in ANY code path
        predmeta = null; // Explicit assignment for defensive programming
        
        // CRITICAL: Clean outcome from body - only copy win/place/show, explicitly delete ok if present
        const bodyOutcome = body.outcome || {};
        const outcome = {
          win: (bodyOutcome.win || "").trim(),
          place: (bodyOutcome.place || "").trim(),
          show: (bodyOutcome.show || "").trim(),
        };
        // Defensive cleanup - ensure no ok property exists
        delete outcome.ok;

        // Get predictions from body or fetch from Redis
        let predicted = predictedFromClient;
        let confidence = body.confidence || null;
        let top3Mass = body.top3Mass || null;

        // ADDITIVE: If predmeta came from snapshot, use predicted picks from snapshot
        // Note: predmeta is always null for manual verify, so this guard will always be false (safe)
        if (predmeta && predmeta.predicted && (predmeta.predicted.win || predmeta.predicted.place || predmeta.predicted.show)) {
          predicted = predmeta.predicted;
        }
        // If predictions not provided in body/snapshot, try fetching from Redis
        else if (!predicted || (!predicted.win && !predicted.place && !predicted.show)) {
          const predLog = await fetchPredictionLog(track, canonicalDateIso, raceNo);
          if (predLog) {
            predicted = predLog.predicted || { win: "", place: "", show: "" };
            if (predLog.confidence !== null) confidence = predLog.confidence;
            if (predLog.top3Mass !== null) top3Mass = predLog.top3Mass;
          }
        }

        // Normalize predictions
        const predictedNormalized = normalizePrediction(predicted);

        // Compute hits using normalized horse names
        const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
        const norm = normalizeHorseName;
        const pWin = norm(predictedNormalized.win);
        const pPlace = norm(predictedNormalized.place);
        const pShow = norm(predictedNormalized.show);
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

        const hits = {
          winHit,
          placeHit,
          showHit,
          top3Hit,
        };

        // Build summary for manual entry
        const summaryLines = [];
        if (uiDateRaw && uiDateRaw !== canonicalDateIso) {
          summaryLines.push(`UI date: ${uiDateRaw}`);
        }
        if (canonicalDateIso) {
          summaryLines.push(`Using date: ${canonicalDateIso}`);
        }
        summaryLines.push("Outcome (manual entry):");
        summaryLines.push(`  Win: ${outcome.win || "-"}`);
        summaryLines.push(`  Place: ${outcome.place || "-"}`);
        summaryLines.push(`  Show: ${outcome.show || "-"}`);

        if (predictedNormalized && (predictedNormalized.win || predictedNormalized.place || predictedNormalized.show)) {
          const predParts = [predictedNormalized.win, predictedNormalized.place, predictedNormalized.show].filter(Boolean);
          if (predParts.length) {
            summaryLines.push(`Predicted: ${predParts.join(" / ")}`);
          }
        }

        const hitParts = [];
        if (hits.winHit) hitParts.push("winHit");
        if (hits.placeHit) hitParts.push("placeHit");
        if (hits.showHit) hitParts.push("showHit");
        if (hits.top3Hit) hitParts.push("top3Hit");
        summaryLines.push(`Hits: ${hitParts.length ? hitParts.join(", ") : "(none)"}`);

        const summary = summaryLines.join("\n");

        // Build raceId
        const raceId = buildVerifyRaceId(track, canonicalDateIso, raceNo);

        // CRITICAL: Recompute ok from outcome - NEVER hardcode ok:true
        // Clean outcome again to ensure no ok property contamination
        const cleanManualOutcome = {
          win: (outcome.win && typeof outcome.win === 'string') ? outcome.win : "",
          place: (outcome.place && typeof outcome.place === 'string') ? outcome.place : "",
          show: (outcome.show && typeof outcome.show === 'string') ? outcome.show : "",
        };
        delete cleanManualOutcome.ok; // Defensive cleanup
        
        // Recompute ok from cleaned outcome - this is the ONLY source of truth
        const manualOk = Boolean(
          cleanManualOutcome.win && 
          cleanManualOutcome.place && 
          cleanManualOutcome.show
        );
        
        // Build result object
        const result = {
          ok: manualOk, // Recomputed from cleaned outcome - never hardcode true
          step: "manual_verify",
          track,
          date: canonicalDateIso,
          raceNo,
          raceId,
          outcome: cleanManualOutcome, // Use cleaned outcome with no ok property
          predicted: predictedNormalized,
          hits,
          summary,
          debug: {
            source: "manual",
            manualProvider: body.provider || "TwinSpires",
            canonicalDateIso: canonicalDateIso,
          },
        };

        // Add optional fields if present
        if (confidence !== null) result.confidence = confidence;
        if (top3Mass !== null) result.top3Mass = top3Mass;
        if (body.provider) result.provider = body.provider;

        // Log to Redis and get verification result
        const redisResult = await logVerifyResult(result);
        
        // Build Redis fingerprint for diagnostics (gated for production)
        let redisFingerprint = null;
        const vercelEnv = process.env.VERCEL_ENV || 'development';
        const exposeRedisDebug = process.env.EXPOSE_REDIS_DEBUG === 'true';
        const shouldExposeFingerprint = vercelEnv !== 'production' || exposeRedisDebug;
        
        if (shouldExposeFingerprint) {
          try {
            const { getRedisFingerprint } = await import('../../lib/redis_fingerprint.js');
            redisFingerprint = getRedisFingerprint();
          } catch {}
        }
        
        // Store redis result in result for responseMeta
        result._redisResult = redisResult;
        result._redisFingerprint = redisFingerprint;

        // Add GreenZone (safe, never throws)
        await addGreenZoneToResponse(result);

        // CRITICAL: result.ok should already be correctly computed above, but defensive check
        // Clean outcome again to ensure no ok property contamination (defensive)
        const resultOutcome = result.outcome || { win: "", place: "", show: "" };
        const cleanResultOutcome = {
          win: (resultOutcome.win && typeof resultOutcome.win === 'string') ? resultOutcome.win : "",
          place: (resultOutcome.place && typeof resultOutcome.place === 'string') ? resultOutcome.place : "",
          show: (resultOutcome.show && typeof resultOutcome.show === 'string') ? resultOutcome.show : "",
        };
        delete cleanResultOutcome.ok; // Defensive cleanup
        
        // Recompute ok from cleaned outcome - this is the ONLY source of truth
        const resultHasValidOutcome = Boolean(
          cleanResultOutcome.win && 
          cleanResultOutcome.place && 
          cleanResultOutcome.show
        );
        
        // CRITICAL: Create final result with recomputed ok - don't trust existing result.ok
        const finalResult = {
          ...result,
          ok: resultHasValidOutcome, // Recomputed from cleaned outcome - overwrite any existing value
          outcome: cleanResultOutcome, // Use cleaned outcome
        };
        
        // CRITICAL: Assert ok is boolean before proceeding (debug guard)
        if (typeof finalResult.ok !== 'boolean') {
          console.error(`[verify_race] CRITICAL BUG: finalResult.ok is ${typeof finalResult.ok} (value: ${JSON.stringify(finalResult.ok)}) after recomputation`);
          console.error(`[verify_race] Stack:`, new Error().stack);
          console.error(`[verify_race] Context:`, JSON.stringify({ step: finalResult.step, outcome: cleanResultOutcome, resultHasValidOutcome }));
          console.error(`[verify_race] Original result.ok:`, typeof result.ok, JSON.stringify(result.ok));
          // Force to boolean based on outcome
          finalResult.ok = Boolean(resultHasValidOutcome);
          if (!finalResult.debug) finalResult.debug = {};
          finalResult.debug.okComputationError = `finalResult.ok was ${typeof finalResult.ok} (original: ${typeof result.ok}, value: ${JSON.stringify(result.ok)}), forced to ${finalResult.ok}`;
        }
        
        // CRITICAL: Ensure ok is always boolean (defensive check against type corruption)
        const sanitizedResult = sanitizeResponse(finalResult);
        
        return res.status(200).json({
          ...sanitizedResult,
          bypassedPayGate: bypassedPayGate,
          responseMeta: buildResponseMeta({
            handlerFile: HANDLER_FILE,
            backendVersion: BACKEND_VERSION,
            bypassedPayGate: bypassedPayGate,
            internalBypassAuthorized: internalBypassAuthorized,
            redis: finalResult._redisResult || null,
            redisFingerprint: finalResult._redisFingerprint || null,
            vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null, // Keep for backward compatibility
          })
        });
      } catch (error) {
        // Log full error details to server logs for diagnostics
        console.error("[manual_verify_error]", {
          name: error?.name,
          message: error?.message,
          stack: error?.stack,
        });
        console.error("[verify_race] Manual verify error:", error);
        
        // Return error response (still 200 to match never-500 policy)
        return res.status(200).json({
          ok: false,
          step: "manual_verify_error",
          track,
          date: canonicalDateIso,
          raceNo,
          outcome: (() => {
            const rawOutcome = body.outcome || { win: "", place: "", show: "" };
            // CRITICAL: Clean outcome - only copy win/place/show, explicitly delete ok
            const cleanOutcome = {
              win: (rawOutcome.win || "").trim(),
              place: (rawOutcome.place || "").trim(),
              show: (rawOutcome.show || "").trim(),
            };
            delete cleanOutcome.ok; // Defensive cleanup
            return cleanOutcome;
          })(),
          predicted: predictedFromClient,
          hits: {
            winHit: false,
            placeHit: false,
            showHit: false,
            top3Hit: false,
          },
          message: `Manual verify failed: ${error?.message || "Unknown error"}`,
          error: error?.message || String(error) || "Unknown error",
          summary: `Error: Manual verify failed - ${error?.message || "Unknown error"}`,
          debug: {
            error: error?.message || String(error),
            name: error?.name || "UnknownError",
            stack: error?.stack || null, // Full stack trace for diagnostics
            source: "manual",
            catcher: "manual_verify_catch_v2", // Fingerprint to identify which catch block fired
          },
          greenZone: { enabled: false, reason: "error" },
          bypassedPayGate: bypassedPayGate,
          responseMeta: buildResponseMeta({
            handlerFile: HANDLER_FILE,
            backendVersion: BACKEND_VERSION,
            bypassedPayGate: bypassedPayGate,
            internalBypassAuthorized: internalBypassAuthorized,
            vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null, // Keep for backward compatibility
          }),
        });
      }
    }

    // Build context - include all date fields for maximum compatibility
    const ctx = {
      track: body.track || "",
      raceNo: body.raceNo || body.race || "",
      date: canonicalDateIso,
      raceDate: canonicalDateIso,
      canonicalDateIso: canonicalDateIso,
      dateRaw: uiDateRaw,        // for debugging
      predicted: predictedFromClient,
    };

    // Read feature flag INSIDE the handler (not at top level)
    const mode = (process.env.VERIFY_RACE_MODE || "stub").toLowerCase().trim();

    // If not in full mode, immediately return stub
    if (mode !== "full") {
      const stub = await buildStubResponse({
        ...ctx,
        uiDateRaw: ctx.dateRaw || uiDateRaw, // Pass uiDateRaw to buildStubResponse
      });
      // CRITICAL: Never reassign stub.debug - only merge additional fields if needed
      // buildStubResponse already sets source, so we don't need to set it again
      // Just ensure debug object is preserved as-is
      
      // Add GreenZone (safe, never throws) - this should not modify debug
      await addGreenZoneToResponse(stub);
      await logVerifyResult(stub);
      
      // Return stub with preserved debug - never overwrite debug here
      return res.status(200).json({
        ...stub,
        bypassedPayGate: bypassedPayGate,
        responseMeta: {
          ...stub.responseMeta,
          bypassedPayGate: bypassedPayGate,
          internalBypassAuthorized: internalBypassAuthorized,
        }
      });
    }

    // Full mode: attempt to use the full parser
    try {
      // Dynamic import to avoid loading the module if not needed
      // However, since we're already in full mode, we can use static import
      // But to be extra safe, we'll wrap it in try/catch
      const { runFullVerifyRace } = await import("../../lib/verify_race_full.js");

      const fullResult = await runFullVerifyRace({
        ...ctx,
        req, // Pass req for CSE bridge
      });

      // Validate the response has the required shape
      if (
        !fullResult ||
        typeof fullResult !== "object" ||
        !fullResult.step
      ) {
        // Don't throw - return a safe error response instead
        console.error("[verify_race] Invalid full verify response structure", {
          fullResult,
          track,
          date: canonicalDateIso,
          raceNo,
        });
        const errorResponse = {
          ok: false,
          step: "verify_race_full_fallback",
          date: canonicalDateIso,
          track: track || "",
          raceNo: raceNo || "",
          query: "",
          top: null,
          outcome: { win: "", place: "", show: "" },
          predicted: predictedFromClient,
          hits: {
            winHit: false,
            placeHit: false,
            showHit: false,
            top3Hit: false,
          },
          summary: "Full parser returned invalid response structure. Using fallback.",
          debug: {
            backendVersion: BACKEND_VERSION,
            handlerFile: HANDLER_FILE,
            fullError: "Invalid full verify response structure",
          },
        };
        await logVerifyResult(errorResponse).catch(() => {}); // Ignore logging errors
        return res.status(200).json({
          ...errorResponse,
          bypassedPayGate: bypassedPayGate,
          responseMeta: {
            handlerFile: HANDLER_FILE,
            backendVersion: BACKEND_VERSION,
            bypassedPayGate: bypassedPayGate,
            internalBypassAuthorized: internalBypassAuthorized,
          },
        });
      }

      // Import validation helper
      const { isValidOutcome } = await import("../../lib/verify_race_full.js");
      
      // If step is "verify_race", return success directly (Equibase or HRN succeeded)
      if (fullResult.step === "verify_race") {
        // Check for mismatch between requested race and scraped race metadata
        const scrapedMeta = {
          canonicalDateIso: fullResult.date || fullResult.debug?.canonicalDateIso,
          raceNo: fullResult.raceNo || fullResult.debug?.raceNo,
          track: fullResult.track || fullResult.debug?.track,
        };
        
        const requestedCtx = {
          dateIso: canonicalDateIso,
          raceNo: raceNo,
          track: track,
        };
        
        const mismatched = isScrapedRaceMismatched(requestedCtx, scrapedMeta);
        
        let validatedResult;
        if (mismatched) {
          // Treat as "results not yet available" - return empty outcome
          const safeOutcome = { win: "", place: "", show: "" };
          const safeHits = {
            winHit: false,
            placeHit: false,
            showHit: false,
            top3Hit: false,
          };
          
          let mismatchSummary = fullResult.summary || "";
          mismatchSummary += "\nResults not available yet on HRN/Equibase (scraped race/date did not match UI).";
          
          validatedResult = {
            ok: false,
            step: "verify_race_mismatch",
            date: canonicalDateIso,
            track: track || "",
            raceNo: raceNo || "",
            query: fullResult.query || "",
            top: fullResult.top || null,
            outcome: safeOutcome,
            predicted: fullResult.predicted || predictedFromClient,
            hits: safeHits,
            summary: mismatchSummary,
            debug: {
              ...fullResult.debug,
              mismatch: {
                canonicalDateIso: scrapedMeta.canonicalDateIso,
                scrapedRaceNo: scrapedMeta.raceNo,
                scrapedTrack: scrapedMeta.track,
                requestedDateIso: canonicalDateIso,
                requestedRaceNo: raceNo,
                requestedTrack: track,
              },
              googleUrl:
                fullResult.debug?.googleUrl ||
                (() => {
                  try {
                    return buildGoogleSearchUrl({ track, date: canonicalDateIso, raceNo }).url;
                  } catch (err) {
                    console.error("[verify_race] Error building Google URL:", err);
                    return "";
                  }
                })(),
            },
          };
        } else {
          // Normal path - no mismatch
          // STRICT VALIDATION: Validate outcome before setting ok=true
          const outcome = fullResult.outcome || { win: "", place: "", show: "" };
          const validateHorseName = (name) => {
            if (!name || name.length === 0 || name.length < 3 || name.length > 50) return false;
            if (!/[A-Za-z]/.test(name)) return false;
            if (name.includes(".") || name.includes("<") || name.includes(">") || name.includes("=")) return false;
            const nameLower = name.toLowerCase().trim();
            const jsKeywords = ["datalayer", "dow", "window", "document", "function", "var", "let", "const", "this", "place", "win", "show"];
            if (jsKeywords.includes(nameLower)) return false;
            const genericTokens = ["this", "place", "win", "show", "the", "a", "an"];
            if (genericTokens.includes(nameLower)) return false;
            if (/[{}()=>]/.test(name) || /^\d+$/.test(name)) return false;
            return true;
          };
          
          const winValid = validateHorseName(outcome.win);
          const placeValid = validateHorseName(outcome.place);
          const showValid = validateHorseName(outcome.show);
          
          // STRICT OK: ok=true ONLY if ALL THREE are validated
          const hasAllValidOutcome = winValid && placeValid && showValid && outcome.win && outcome.place && outcome.show;
          const strictOk = hasAllValidOutcome;
          
          // Clear invalid outcomes
          const validatedOutcome = {
            win: winValid && outcome.win ? outcome.win : "",
            place: placeValid && outcome.place ? outcome.place : "",
            show: showValid && outcome.show ? outcome.show : "",
          };
          
          validatedResult = {
            ok: strictOk, // Use strict validation, not fullResult.ok
            step: "verify_race",
            date: fullResult.date || canonicalDateIso, // Use canonicalDateIso from handler
            track: fullResult.track || track || "",
            raceNo: fullResult.raceNo || raceNo || "",
            query: fullResult.query || "",
            top: fullResult.top || null,
            outcome: validatedOutcome,
            predicted: fullResult.predicted || predictedFromClient,
            hits: fullResult.hits || {
              winHit: false,
              placeHit: false,
              showHit: false,
              top3Hit: false,
            },
            summary: fullResult.summary || "Full verify race completed.",
            debug: {
              ...(fullResult.debug || {}), // Preserve ALL debug fields from fullResult (including HRN fields)
              googleUrl:
                fullResult.debug?.googleUrl ||
                (() => {
                  try {
                    return buildGoogleSearchUrl({ track, date: canonicalDateIso, raceNo }).url;
                  } catch (err) {
                    console.error("[verify_race] Error building Google URL:", err);
                    return "";
                  }
                })(),
            },
          };
          
          // If validation failed, update debug
          if (!strictOk && validatedResult.debug) {
            if (!validatedResult.debug.hrnCandidateRejectedReasons) {
              validatedResult.debug.hrnCandidateRejectedReasons = [];
            }
            if (outcome.win && !winValid) validatedResult.debug.hrnCandidateRejectedReasons.push(`win_invalid:${outcome.win}`);
            if (outcome.place && !placeValid) validatedResult.debug.hrnCandidateRejectedReasons.push(`place_invalid:${outcome.place}`);
            if (outcome.show && !showValid) validatedResult.debug.hrnCandidateRejectedReasons.push(`show_invalid:${outcome.show}`);
            if (validatedResult.debug.hrnParsedBy && validatedResult.debug.hrnParsedBy !== "none") {
              validatedResult.debug.hrnParsedBy = "validation_failed";
            }
          }
        }

        // Add GreenZone (safe, never throws)
        await addGreenZoneToResponse(validatedResult);
        
        // Log to Redis and get verification result
        const redisResult = await logVerifyResult(validatedResult);
        
        // Build Redis fingerprint for diagnostics (gated for production)
        let redisFingerprint = null;
        const vercelEnv = process.env.VERCEL_ENV || 'development';
        const exposeRedisDebug = process.env.EXPOSE_REDIS_DEBUG === 'true';
        const shouldExposeFingerprint = vercelEnv !== 'production' || exposeRedisDebug;
        
        if (shouldExposeFingerprint) {
          try {
            const { getRedisFingerprint } = await import('../../lib/redis_fingerprint.js');
            redisFingerprint = getRedisFingerprint();
          } catch {}
        }
        
        // Store redis result in validatedResult for responseMeta
        validatedResult._redisResult = redisResult;
        validatedResult._redisFingerprint = redisFingerprint;
        
        // CRITICAL: Ensure ok is always boolean (defensive check against type corruption)
        const sanitizedValidated = sanitizeResponse(validatedResult);
        return res.status(200).json({
          ...sanitizedValidated,
          bypassedPayGate: bypassedPayGate,
          responseMeta: {
            ...validatedResult.responseMeta,
            bypassedPayGate: bypassedPayGate,
            internalBypassAuthorized: internalBypassAuthorized,
            redis: validatedResult._redisResult || null,
            redisFingerprint: validatedResult._redisFingerprint || null,
          }
        });
      }

      // If step is "verify_race_full_fallback", use full result but ensure date is canonical
      // Then try HRN fallback
      if (fullResult.step === "verify_race_full_fallback") {
        console.warn("[verify_race] Full parser returned fallback", {
          step: fullResult.step,
          query: fullResult.query,
        });
        // Use full result but ensure date field is canonical
        // CRITICAL: Do NOT spread fullResult directly - it may have corrupted ok. Explicitly construct.
        // CRITICAL: Clean outcome to remove any ok property contamination
        const fullResultOutcome = fullResult.outcome || { win: "", place: "", show: "" };
        const cleanFullResultOutcome = {
          win: (fullResultOutcome.win && typeof fullResultOutcome.win === 'string') ? fullResultOutcome.win : "",
          place: (fullResultOutcome.place && typeof fullResultOutcome.place === 'string') ? fullResultOutcome.place : "",
          show: (fullResultOutcome.show && typeof fullResultOutcome.show === 'string') ? fullResultOutcome.show : "",
        };
        // Explicitly delete ok if it exists (defensive)
        delete cleanFullResultOutcome.ok;
        
        // CRITICAL: Recompute ok from cleaned outcome - NEVER use fullResult.ok
        const fallbackResultOk = Boolean(
          cleanFullResultOutcome.win && 
          cleanFullResultOutcome.place && 
          cleanFullResultOutcome.show
        );
        
        const fallbackResult = {
          ok: fallbackResultOk, // Recomputed from cleaned outcome - never trust fullResult.ok
          step: fullResult.step || "verify_race_fallback",
          date: fullResult.date || canonicalDateIso, // Ensure canonical date
          track: fullResult.track || track || "",
          raceNo: fullResult.raceNo || raceNo || "",
          query: fullResult.query || "",
          top: fullResult.top || null,
          outcome: cleanFullResultOutcome, // Use cleaned outcome with no ok property
          predicted: fullResult.predicted || predictedFromClient,
          debug: {
            ...(fullResult.debug || {}),
            backendVersion: BACKEND_VERSION,
            handlerFile: HANDLER_FILE,
          },
        };

        // Try HRN fallback if we have track and date
        if (track && canonicalDateIso) {
          const canonicalRaceNo = String(raceNo || "").trim();
          const { outcome: hrnOutcome, debugExtras: hrnDebug, httpStatus: hrnHttpStatus, urlAttempted: hrnUrlAttempted } = await tryHrnFallback(track, canonicalDateIso, canonicalRaceNo, fallbackResult.debug);
          fallbackResult.debug = { ...fallbackResult.debug, ...hrnDebug };

          // If HRN fetch was blocked (403/429), return structured error
          if (hrnHttpStatus === 403 || hrnHttpStatus === 429) {
            return res.status(200).json({
              ok: false,
              step: "fetch_results",
              httpStatus: hrnHttpStatus,
              error: `${hrnHttpStatus} from HRN (blocked)`,
              urlAttempted: hrnUrlAttempted || hrnDebug?.hrnUrl || null,
              date: canonicalDateIso,
              track: track || "",
              raceNo: canonicalRaceNo || "",
              query: fallbackResult.query || "",
              top: null,
              outcome: { win: "", place: "", show: "" },
              predicted: fallbackResult.predicted || predictedFromClient,
              hits: {
                winHit: false,
                placeHit: false,
                showHit: false,
                top3Hit: false,
              },
              summary: `HRN fetch blocked (HTTP ${hrnHttpStatus}). Results unavailable.`,
              debug: fallbackResult.debug,
              bypassedPayGate: bypassedPayGate,
              responseMeta: {
                handlerFile: HANDLER_FILE,
                backendVersion: BACKEND_VERSION,
                bypassedPayGate: bypassedPayGate,
                internalBypassAuthorized: internalBypassAuthorized,
              },
            });
          }

          if (hrnOutcome) {
            // Check for mismatch before accepting HRN outcome
            const hrnScrapedMeta = {
              canonicalDateIso: hrnDebug?.hrnDateIso || canonicalDateIso,
              raceNo: hrnDebug?.hrnRaceNo || canonicalRaceNo,
              track: track,
            };
            
            const requestedCtx = {
              dateIso: canonicalDateIso,
              raceNo: canonicalRaceNo,
              track: track,
            };
            
            const hrnMismatched = isScrapedRaceMismatched(requestedCtx, hrnScrapedMeta);
            
            if (hrnMismatched) {
              // Reject HRN outcome - treat as no results
              fallbackResult.outcome = { win: "", place: "", show: "" };
              fallbackResult.hits = {
                winHit: false,
                placeHit: false,
                showHit: false,
                top3Hit: false,
              };
              fallbackResult.ok = false;
              fallbackResult.step = "verify_race_fallback_hrn_mismatch";
              fallbackResult.debug = {
                ...fallbackResult.debug,
                ...hrnDebug,
                mismatch: {
                  canonicalDateIso: hrnScrapedMeta.canonicalDateIso,
                  scrapedRaceNo: hrnScrapedMeta.raceNo,
                  scrapedTrack: hrnScrapedMeta.track,
                  requestedDateIso: canonicalDateIso,
                  requestedRaceNo: canonicalRaceNo,
                  requestedTrack: track,
                },
              };
              try {
                fallbackResult.summary = buildSummary({
                  date: fallbackResult.date || canonicalDateIso,
                  uiDateRaw: fallbackResult.debug?.uiDateRaw,
                  outcome: fallbackResult.outcome,
                  step: fallbackResult.step,
                  query: fallbackResult.query,
                });
                fallbackResult.summary += "\nResults not available yet on HRN (scraped race/date did not match UI).";
              } catch (err) {
                console.error("[verify_race] Error rebuilding summary:", err);
                fallbackResult.summary = fallbackResult.summary || `Step: ${fallbackResult.step || "unknown"}\nResults not available yet on HRN (scraped race/date did not match UI).`;
              }
            } else {
              // STRICT VALIDATION: Validate HRN outcome before accepting
              const validateHorseName = (name) => {
                if (!name || name.length === 0 || name.length < 3 || name.length > 50) return false;
                if (!/[A-Za-z]/.test(name)) return false;
                if (name.includes(".") || name.includes("<") || name.includes(">") || name.includes("=")) return false;
                const nameLower = name.toLowerCase().trim();
                const jsKeywords = ["datalayer", "dow", "window", "document", "function", "var", "let", "const", "this", "place", "win", "show"];
                if (jsKeywords.includes(nameLower)) return false;
                const genericTokens = ["this", "place", "win", "show", "the", "a", "an"];
                if (genericTokens.includes(nameLower)) return false;
                if (/[{}()=>]/.test(name) || /^\d+$/.test(name)) return false;
                return true;
              };
              
              const winValid = validateHorseName(hrnOutcome.win);
              const placeValid = validateHorseName(hrnOutcome.place);
              const showValid = validateHorseName(hrnOutcome.show);
              
              // Only accept if ALL THREE are validated
              // CRITICAL: Only copy win/place/show properties - never spread entire object which might contain ok
              if (winValid && placeValid && showValid && hrnOutcome.win && hrnOutcome.place && hrnOutcome.show) {
                fallbackResult.outcome = {
                  win: hrnOutcome.win || "",
                  place: hrnOutcome.place || "",
                  show: hrnOutcome.show || "",
                };
                // Defensive cleanup - ensure no ok property
                delete fallbackResult.outcome.ok;
                fallbackResult.ok = Boolean(true); // Explicitly boolean
                fallbackResult.step = "verify_race_fallback_hrn";
              } else {
                // Validation failed - clear invalid outcomes and set ok=false
                fallbackResult.outcome = {
                  win: winValid && hrnOutcome.win ? hrnOutcome.win : "",
                  place: placeValid && hrnOutcome.place ? hrnOutcome.place : "",
                  show: showValid && hrnOutcome.show ? hrnOutcome.show : "",
                };
                // Defensive cleanup - ensure no ok property
                delete fallbackResult.outcome.ok;
                fallbackResult.ok = Boolean(false); // Explicitly boolean
                fallbackResult.step = "verify_race_fallback_hrn_validation_failed";
                // Update debug to reflect validation failure
                if (fallbackResult.debug && hrnDebug) {
                  if (!fallbackResult.debug.hrnCandidateRejectedReasons) {
                    fallbackResult.debug.hrnCandidateRejectedReasons = [];
                  }
                  if (!winValid && hrnOutcome.win) fallbackResult.debug.hrnCandidateRejectedReasons.push(`win_invalid:${hrnOutcome.win}`);
                  if (!placeValid && hrnOutcome.place) fallbackResult.debug.hrnCandidateRejectedReasons.push(`place_invalid:${hrnOutcome.place}`);
                  if (!showValid && hrnOutcome.show) fallbackResult.debug.hrnCandidateRejectedReasons.push(`show_invalid:${hrnOutcome.show}`);
                  if (fallbackResult.debug.hrnParsedBy && fallbackResult.debug.hrnParsedBy !== "none") {
                    fallbackResult.debug.hrnParsedBy = "validation_failed";
                  }
                }
              }
              
              // Rebuild summary with final outcome
              try {
                fallbackResult.summary = buildSummary({
                  date: fallbackResult.date || canonicalDateIso,
                  uiDateRaw: fallbackResult.debug?.uiDateRaw,
                  outcome: fallbackResult.outcome,
                  step: fallbackResult.step,
                  query: fallbackResult.query,
                });
              } catch (err) {
                console.error("[verify_race] Error rebuilding summary:", err);
                fallbackResult.summary = fallbackResult.summary || `Step: ${fallbackResult.step || "unknown"}`;
              }
            }
          } else {
            // HRN failed, try Equibase fallback
            const { outcome: equibaseOutcome, debugExtras: equibaseDebug } = await tryEquibaseFallback(track, canonicalDateIso, canonicalRaceNo, fallbackResult.debug);
            fallbackResult.debug = { ...fallbackResult.debug, ...equibaseDebug };

            if (equibaseOutcome) {
              // Check for mismatch before accepting Equibase outcome
              const equibaseScrapedMeta = {
                canonicalDateIso: equibaseDebug?.equibaseDateIso || canonicalDateIso,
                raceNo: equibaseDebug?.equibaseRaceNo || canonicalRaceNo,
                track: track,
              };
              
              const requestedCtx = {
                dateIso: canonicalDateIso,
                raceNo: canonicalRaceNo,
                track: track,
              };
              
              const equibaseMismatched = isScrapedRaceMismatched(requestedCtx, equibaseScrapedMeta);
              
              if (equibaseMismatched) {
                // Reject Equibase outcome - treat as no results
                fallbackResult.outcome = { win: "", place: "", show: "" };
                fallbackResult.hits = {
                  winHit: false,
                  placeHit: false,
                  showHit: false,
                  top3Hit: false,
                };
                fallbackResult.ok = false;
                fallbackResult.step = "verify_race_fallback_equibase_mismatch";
                fallbackResult.debug = {
                  ...fallbackResult.debug,
                  mismatch: {
                    canonicalDateIso: equibaseScrapedMeta.canonicalDateIso,
                    scrapedRaceNo: equibaseScrapedMeta.raceNo,
                    scrapedTrack: equibaseScrapedMeta.track,
                    requestedDateIso: canonicalDateIso,
                    requestedRaceNo: canonicalRaceNo,
                    requestedTrack: track,
                  },
                };
                try {
                  fallbackResult.summary = buildSummary({
                    date: fallbackResult.date || canonicalDateIso,
                    uiDateRaw: fallbackResult.debug?.uiDateRaw,
                    outcome: fallbackResult.outcome,
                    step: fallbackResult.step,
                    query: fallbackResult.query,
                  });
                  fallbackResult.summary += "\nResults not available yet on Equibase (scraped race/date did not match UI).";
                } catch (err) {
                  console.error("[verify_race] Error rebuilding summary:", err);
                  fallbackResult.summary = fallbackResult.summary || `Step: ${fallbackResult.step || "unknown"}\nResults not available yet on Equibase (scraped race/date did not match UI).`;
                }
              } else {
                // Accept Equibase outcome - no mismatch
                // CRITICAL: Only copy win/place/show properties - never spread entire object which might contain ok
                fallbackResult.outcome = {
                  win: equibaseOutcome?.win || "",
                  place: equibaseOutcome?.place || "",
                  show: equibaseOutcome?.show || "",
                };
                // Defensive cleanup - ensure no ok property
                delete fallbackResult.outcome.ok;
                fallbackResult.ok = Boolean(true); // Explicitly boolean
                fallbackResult.step = "verify_race_fallback_equibase";
                
                // Recompute hits if we have predicted values
                if (fallbackResult.predicted) {
                  const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
                  const norm = normalizeHorseName;
                  const pWin = norm(fallbackResult.predicted.win);
                  const pPlace = norm(fallbackResult.predicted.place);
                  const pShow = norm(fallbackResult.predicted.show);
                  const oWin = norm(equibaseOutcome.win);
                  const oPlace = norm(equibaseOutcome.place);
                  const oShow = norm(equibaseOutcome.show);

                  const winHit = !!pWin && !!oWin && pWin === oWin;
                  const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
                  const showHit = !!pShow && !!oShow && pShow === oShow;
                  const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
                  const top3Hit = [pWin, pPlace, pShow]
                    .filter(Boolean)
                    .some(name => top3Set.has(name));

                  fallbackResult.hits = {
                    winHit,
                    placeHit,
                    showHit,
                    top3Hit,
                  };
                }
                
                // Rebuild summary with final outcome
                try {
                  fallbackResult.summary = buildSummary({
                    date: fallbackResult.date || canonicalDateIso,
                    uiDateRaw: fallbackResult.debug?.uiDateRaw,
                    outcome: fallbackResult.outcome,
                    step: fallbackResult.step,
                    query: fallbackResult.query,
                  });
                } catch (err) {
                  console.error("[verify_race] Error rebuilding summary:", err);
                  fallbackResult.summary = fallbackResult.summary || `Step: ${fallbackResult.step || "unknown"}`;
                }
              }
            }
          }
        }

        // CRITICAL: Final recomputation of ok from outcome - NEVER trust existing fallbackResult.ok
        // This must happen AFTER all outcome assignments but BEFORE logging/returning
        const finalFallbackOutcome = fallbackResult.outcome || { win: "", place: "", show: "" };
        const cleanFinalOutcome = {
          win: (finalFallbackOutcome.win && typeof finalFallbackOutcome.win === 'string') ? finalFallbackOutcome.win : "",
          place: (finalFallbackOutcome.place && typeof finalFallbackOutcome.place === 'string') ? finalFallbackOutcome.place : "",
          show: (finalFallbackOutcome.show && typeof finalFallbackOutcome.show === 'string') ? finalFallbackOutcome.show : "",
        };
        delete cleanFinalOutcome.ok; // Defensive cleanup
        
        // Recompute ok from cleaned outcome - this is the ONLY source of truth
        const finalFallbackOk = Boolean(
          cleanFinalOutcome.win && 
          cleanFinalOutcome.place && 
          cleanFinalOutcome.show
        );
        
        // CRITICAL: Create final object with recomputed ok - don't mutate existing fallbackResult
        const finalFallbackForLog = {
          ...fallbackResult,
          ok: finalFallbackOk, // Recomputed from cleaned outcome
          outcome: cleanFinalOutcome, // Use cleaned outcome
        };
        
        // CRITICAL: Assert ok is boolean (debug guard)
        if (typeof finalFallbackForLog.ok !== 'boolean') {
          console.error(`[verify_race] CRITICAL BUG: finalFallbackForLog.ok is ${typeof finalFallbackForLog.ok} (value: ${JSON.stringify(finalFallbackForLog.ok)})`);
          console.error(`[verify_race] Stack:`, new Error().stack);
          console.error(`[verify_race] Context:`, JSON.stringify({ step: finalFallbackForLog.step, outcome: cleanFinalOutcome }));
          finalFallbackForLog.ok = Boolean(finalFallbackOk);
          if (!finalFallbackForLog.debug) finalFallbackForLog.debug = {};
          finalFallbackForLog.debug.okComputationError = `ok was ${typeof finalFallbackForLog.ok}, forced to ${finalFallbackForLog.ok}`;
        }
        
        await logVerifyResult(finalFallbackForLog);
        // CRITICAL: Ensure ok is always boolean (defensive check against type corruption)
        const sanitizedFallback = sanitizeResponse(finalFallbackForLog);
        return res.status(200).json({
          ...sanitizedFallback,
          bypassedPayGate: bypassedPayGate,
          responseMeta: {
            handlerFile: HANDLER_FILE,
            backendVersion: BACKEND_VERSION,
            bypassedPayGate: bypassedPayGate,
            internalBypassAuthorized: internalBypassAuthorized,
          },
        });
      }

      // Any other step (error cases) - fall back to stub with canonical date
      console.warn("[verify_race] Full parser returned unexpected step, falling back to stub", {
        step: fullResult.step,
      });
      const stub = await buildStubResponse(ctx);
      const fallbackStub = {
        ...stub,
        step: "verify_race_full_fallback",
        date: canonicalDateIso, // Ensure canonical date
        predicted: stub.predicted || predictedFromClient,
        summary: `Full parser attempted but failed: step=${fullResult.step}. Using stub fallback (Google search only).\n${stub.summary}`,
        debug: {
          ...stub.debug,
          fullError: `Full parser step: ${fullResult.step}`,
          backendVersion: BACKEND_VERSION,
          handlerFile: HANDLER_FILE,
        },
      };

      // Try HRN fallback if we have track and date
      if (track && canonicalDateIso) {
        const canonicalRaceNo = String(raceNo || "").trim();
        const { outcome: hrnOutcome, debugExtras: hrnDebug, httpStatus: hrnHttpStatus, urlAttempted: hrnUrlAttempted } = await tryHrnFallback(track, canonicalDateIso, canonicalRaceNo, fallbackStub.debug);
        fallbackStub.debug = { ...fallbackStub.debug, ...hrnDebug };

        // If HRN fetch was blocked (403/429), return structured error
        if (hrnHttpStatus === 403 || hrnHttpStatus === 429) {
          await logVerifyResult({
            ...fallbackStub,
            ok: false,
            step: "fetch_results",
            httpStatus: hrnHttpStatus,
            error: `${hrnHttpStatus} from HRN (blocked)`,
            urlAttempted: hrnUrlAttempted || hrnDebug?.hrnUrl || null,
          });
          return res.status(200).json({
            ok: false,
            step: "fetch_results",
            httpStatus: hrnHttpStatus,
            error: `${hrnHttpStatus} from HRN (blocked)`,
            urlAttempted: hrnUrlAttempted || hrnDebug?.hrnUrl || null,
            date: canonicalDateIso,
            track: track || "",
            raceNo: canonicalRaceNo || "",
            query: fallbackStub.query || "",
            top: null,
            outcome: { win: "", place: "", show: "" },
            predicted: fallbackStub.predicted || predictedFromClient,
            hits: {
              winHit: false,
              placeHit: false,
              showHit: false,
              top3Hit: false,
            },
            summary: `HRN fetch blocked (HTTP ${hrnHttpStatus}). Results unavailable.`,
            debug: fallbackStub.debug,
            bypassedPayGate: bypassedPayGate,
            responseMeta: {
              handlerFile: HANDLER_FILE,
              backendVersion: BACKEND_VERSION,
              bypassedPayGate: bypassedPayGate,
              internalBypassAuthorized: internalBypassAuthorized,
            },
          });
        }

        if (hrnOutcome) {
          // STRICT VALIDATION: Validate hrnOutcome before accepting it
          const validateHorseName = (name) => {
            if (!name || name.length === 0 || name.length < 3 || name.length > 50) return false;
            if (!/[A-Za-z]/.test(name)) return false;
            if (name.includes(".") || name.includes("<") || name.includes(">") || name.includes("=")) return false;
            const nameLower = name.toLowerCase().trim();
            const jsKeywords = ["datalayer", "dow", "window", "document", "function", "var", "let", "const", "this", "place", "win", "show"];
            if (jsKeywords.includes(nameLower)) return false;
            const genericTokens = ["this", "place", "win", "show", "the", "a", "an"];
            if (genericTokens.includes(nameLower)) return false;
            if (/[{}()=>]/.test(name) || /^\d+$/.test(name)) return false;
            return true;
          };
          
          const winValid = validateHorseName(hrnOutcome.win);
          const placeValid = validateHorseName(hrnOutcome.place);
          const showValid = validateHorseName(hrnOutcome.show);
          
          // Only accept if ALL THREE are validated
          // CRITICAL: Only copy win/place/show properties - never spread entire object which might contain ok
          if (winValid && placeValid && showValid && hrnOutcome.win && hrnOutcome.place && hrnOutcome.show) {
            fallbackStub.outcome = {
              win: hrnOutcome.win || "",
              place: hrnOutcome.place || "",
              show: hrnOutcome.show || "",
            };
            // Defensive cleanup - ensure no ok property
            delete fallbackStub.outcome.ok;
            fallbackStub.ok = Boolean(true); // Explicitly boolean
            fallbackStub.step = "verify_race_fallback_hrn";
          } else {
            // Validation failed - clear invalid outcomes and set ok=false
            fallbackStub.outcome = {
              win: winValid && hrnOutcome.win ? hrnOutcome.win : "",
              place: placeValid && hrnOutcome.place ? hrnOutcome.place : "",
              show: showValid && hrnOutcome.show ? hrnOutcome.show : "",
            };
            // Defensive cleanup - ensure no ok property
            delete fallbackStub.outcome.ok;
            fallbackStub.ok = Boolean(false); // Explicitly boolean
            fallbackStub.step = "verify_race_fallback_hrn_validation_failed";
            // Update debug to reflect validation failure
            if (fallbackStub.debug && hrnDebug) {
              if (!fallbackStub.debug.hrnCandidateRejectedReasons) {
                fallbackStub.debug.hrnCandidateRejectedReasons = [];
              }
              if (!winValid && hrnOutcome.win) fallbackStub.debug.hrnCandidateRejectedReasons.push(`win_invalid:${hrnOutcome.win}`);
              if (!placeValid && hrnOutcome.place) fallbackStub.debug.hrnCandidateRejectedReasons.push(`place_invalid:${hrnOutcome.place}`);
              if (!showValid && hrnOutcome.show) fallbackStub.debug.hrnCandidateRejectedReasons.push(`show_invalid:${hrnOutcome.show}`);
              if (fallbackStub.debug.hrnParsedBy && fallbackStub.debug.hrnParsedBy !== "none") {
                fallbackStub.debug.hrnParsedBy = "validation_failed";
              }
            }
          }
          
          // Rebuild summary with final outcome
          try {
            fallbackStub.summary = buildSummary({
              date: fallbackStub.date || canonicalDateIso,
              uiDateRaw: fallbackStub.debug?.uiDateRaw,
              outcome: fallbackStub.outcome,
              step: fallbackStub.step,
              query: fallbackStub.query,
            });
          } catch (err) {
            console.error("[verify_race] Error rebuilding summary:", err);
            fallbackStub.summary = fallbackStub.summary || `Step: ${fallbackStub.step || "unknown"}`;
          }
        } else {
          // HRN failed, try Equibase fallback
          const { outcome: equibaseOutcome, debugExtras: equibaseDebug } = await tryEquibaseFallback(track, canonicalDateIso, canonicalRaceNo, fallbackStub.debug);
          fallbackStub.debug = { ...fallbackStub.debug, ...equibaseDebug };

          if (equibaseOutcome) {
            // CRITICAL: Only copy win/place/show properties - never spread entire object which might contain ok
            fallbackStub.outcome = {
              win: equibaseOutcome?.win || "",
              place: equibaseOutcome?.place || "",
              show: equibaseOutcome?.show || "",
            };
            // Defensive cleanup - ensure no ok property
            delete fallbackStub.outcome.ok;
            fallbackStub.ok = Boolean(true); // Explicitly boolean
            fallbackStub.step = "verify_race_fallback_equibase";
            
            // Recompute hits if we have predicted values
            if (fallbackStub.predicted) {
              const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
              const norm = normalizeHorseName;
              const pWin = norm(fallbackStub.predicted.win);
              const pPlace = norm(fallbackStub.predicted.place);
              const pShow = norm(fallbackStub.predicted.show);
              const oWin = norm(equibaseOutcome.win);
              const oPlace = norm(equibaseOutcome.place);
              const oShow = norm(equibaseOutcome.show);

              const winHit = !!pWin && !!oWin && pWin === oWin;
              const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
              const showHit = !!pShow && !!oShow && pShow === oShow;
              const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
              const top3Hit = [pWin, pPlace, pShow]
                .filter(Boolean)
                .some(name => top3Set.has(name));

              fallbackStub.hits = {
                winHit,
                placeHit,
                showHit,
                top3Hit,
              };
            }
            
            // Rebuild summary with final outcome
            try {
              fallbackStub.summary = buildSummary({
                date: fallbackStub.date || canonicalDateIso,
                uiDateRaw: fallbackStub.debug?.uiDateRaw,
                outcome: fallbackStub.outcome,
                step: fallbackStub.step,
                query: fallbackStub.query,
              });
            } catch (err) {
              console.error("[verify_race] Error rebuilding summary:", err);
              fallbackStub.summary = fallbackStub.summary || `Step: ${fallbackStub.step || "unknown"}`;
            }
          }
        }
      }

      // CRITICAL: Recompute ok from outcome - NEVER trust existing fallbackStub.ok value
      // Clean outcome first to remove any ok property contamination
      const finalOutcome = fallbackStub.outcome || { win: "", place: "", show: "" };
      const cleanFallbackOutcome = {
        win: (finalOutcome.win && typeof finalOutcome.win === 'string') ? finalOutcome.win : "",
        place: (finalOutcome.place && typeof finalOutcome.place === 'string') ? finalOutcome.place : "",
        show: (finalOutcome.show && typeof finalOutcome.show === 'string') ? finalOutcome.show : "",
      };
      // Explicitly delete ok if it exists
      delete cleanFallbackOutcome.ok;
      
      // Recompute ok from cleaned outcome - this is the ONLY source of truth
      const hasValidOutcome = Boolean(
        cleanFallbackOutcome.win && 
        cleanFallbackOutcome.place && 
        cleanFallbackOutcome.show
      );
      
      // CRITICAL: Create new fallbackStub object with recomputed ok - don't mutate existing
      const finalFallbackStub = {
        ...fallbackStub,
        ok: hasValidOutcome, // Recomputed from cleaned outcome
        outcome: cleanFallbackOutcome, // Use cleaned outcome
      };
      
      // CRITICAL: Assert ok is boolean before proceeding (debug guard)
      if (typeof finalFallbackStub.ok !== 'boolean') {
        console.error(`[verify_race] CRITICAL BUG: finalFallbackStub.ok is ${typeof finalFallbackStub.ok} (value: ${JSON.stringify(finalFallbackStub.ok)}) after recomputation`);
        console.error(`[verify_race] Stack:`, new Error().stack);
        console.error(`[verify_race] Context:`, JSON.stringify({ step: finalFallbackStub.step, outcome: cleanFallbackOutcome, hasValidOutcome }));
        // Force to boolean based on outcome
        finalFallbackStub.ok = Boolean(hasValidOutcome);
        if (!finalFallbackStub.debug) finalFallbackStub.debug = {};
        finalFallbackStub.debug.okComputationError = `finalFallbackStub.ok was ${typeof finalFallbackStub.ok}, forced to ${finalFallbackStub.ok}`;
      }
      
      await logVerifyResult(finalFallbackStub);
      // CRITICAL: Ensure ok is always boolean (defensive check against type corruption)
      const sanitizedFallbackStub = sanitizeResponse(finalFallbackStub);
      return res.status(200).json({
        ...sanitizedFallbackStub,
        bypassedPayGate: bypassedPayGate,
        responseMeta: {
          handlerFile: HANDLER_FILE,
          backendVersion: BACKEND_VERSION,
          bypassedPayGate: bypassedPayGate,
          internalBypassAuthorized: internalBypassAuthorized,
        },
      });
    } catch (fullError) {
      // Log error and fall back to stub
      const errorMsg = fullError?.message || String(fullError);
      console.error("[verify_race] Full parser failed, falling back to stub", {
        error: errorMsg,
        stack: fullError?.stack,
        track,
        date: canonicalDateIso,
        raceNo,
      });

      const stub = await buildStubResponse(ctx);
      const errorStub = {
        ...stub,
        step: "verify_race_full_fallback",
        date: canonicalDateIso, // Ensure canonical date
        predicted: stub.predicted || predictedFromClient,
        summary: `Full parser attempted but failed: ${errorMsg}. Using stub fallback (Google search only).\n${stub.summary}`,
        debug: {
          ...(stub.debug || {}), // Preserve ALL debug fields from stub (including HRN fields if present)
          fullError: errorMsg,
          fullErrorStack: fullError?.stack || undefined,
          backendVersion: BACKEND_VERSION,
          handlerFile: HANDLER_FILE,
        },
      };

      // Try HRN fallback if we have track and date
      if (track && canonicalDateIso) {
        const canonicalRaceNo = String(raceNo || "").trim();
        const { outcome: hrnOutcome, debugExtras: hrnDebug, httpStatus: hrnHttpStatus, urlAttempted: hrnUrlAttempted } = await tryHrnFallback(track, canonicalDateIso, canonicalRaceNo, errorStub.debug);
        errorStub.debug = { ...errorStub.debug, ...hrnDebug };

        // If HRN fetch was blocked (403/429), return structured error
        if (hrnHttpStatus === 403 || hrnHttpStatus === 429) {
          await logVerifyResult({
            ...errorStub,
            ok: false,
            step: "fetch_results",
            httpStatus: hrnHttpStatus,
            error: `${hrnHttpStatus} from HRN (blocked)`,
            urlAttempted: hrnUrlAttempted || hrnDebug?.hrnUrl || null,
          });
          return res.status(200).json({
            ok: false,
            step: "fetch_results",
            httpStatus: hrnHttpStatus,
            error: `${hrnHttpStatus} from HRN (blocked)`,
            urlAttempted: hrnUrlAttempted || hrnDebug?.hrnUrl || null,
            date: canonicalDateIso,
            track: track || "",
            raceNo: canonicalRaceNo || "",
            query: errorStub.query || "",
            top: null,
            outcome: { win: "", place: "", show: "" },
            predicted: errorStub.predicted || predictedFromClient,
            hits: {
              winHit: false,
              placeHit: false,
              showHit: false,
              top3Hit: false,
            },
            summary: `HRN fetch blocked (HTTP ${hrnHttpStatus}). Results unavailable.`,
            debug: errorStub.debug,
            bypassedPayGate: bypassedPayGate,
            responseMeta: {
              handlerFile: HANDLER_FILE,
              backendVersion: BACKEND_VERSION,
              bypassedPayGate: bypassedPayGate,
              internalBypassAuthorized: internalBypassAuthorized,
            },
          });
        }

        if (hrnOutcome) {
          // STRICT VALIDATION: Validate hrnOutcome before accepting it
          const validateHorseName = (name) => {
            if (!name || name.length === 0 || name.length < 3 || name.length > 50) return false;
            if (!/[A-Za-z]/.test(name)) return false;
            if (name.includes(".") || name.includes("<") || name.includes(">") || name.includes("=")) return false;
            const nameLower = name.toLowerCase().trim();
            const jsKeywords = ["datalayer", "dow", "window", "document", "function", "var", "let", "const", "this", "place", "win", "show"];
            if (jsKeywords.includes(nameLower)) return false;
            const genericTokens = ["this", "place", "win", "show", "the", "a", "an"];
            if (genericTokens.includes(nameLower)) return false;
            if (/[{}()=>]/.test(name) || /^\d+$/.test(name)) return false;
            return true;
          };
          
          const winValid = validateHorseName(hrnOutcome.win);
          const placeValid = validateHorseName(hrnOutcome.place);
          const showValid = validateHorseName(hrnOutcome.show);
          
          // Only accept if ALL THREE are validated
          // CRITICAL: Only copy win/place/show properties - never spread entire object which might contain ok
          if (winValid && placeValid && showValid && hrnOutcome.win && hrnOutcome.place && hrnOutcome.show) {
            errorStub.outcome = {
              win: hrnOutcome.win || "",
              place: hrnOutcome.place || "",
              show: hrnOutcome.show || "",
            };
            // Defensive cleanup - ensure no ok property
            delete errorStub.outcome.ok;
            errorStub.ok = Boolean(true); // Explicitly boolean
            errorStub.step = "verify_race_fallback_hrn";
          } else {
            // Validation failed - clear invalid outcomes and set ok=false
            errorStub.outcome = {
              win: winValid && hrnOutcome.win ? hrnOutcome.win : "",
              place: placeValid && hrnOutcome.place ? hrnOutcome.place : "",
              show: showValid && hrnOutcome.show ? hrnOutcome.show : "",
            };
            // Defensive cleanup - ensure no ok property
            delete errorStub.outcome.ok;
            errorStub.ok = Boolean(false); // Explicitly boolean
            errorStub.step = "verify_race_fallback_hrn_validation_failed";
            // Update debug to reflect validation failure
            if (errorStub.debug && hrnDebug) {
              if (!errorStub.debug.hrnCandidateRejectedReasons) {
                errorStub.debug.hrnCandidateRejectedReasons = [];
              }
              if (!winValid && hrnOutcome.win) errorStub.debug.hrnCandidateRejectedReasons.push(`win_invalid:${hrnOutcome.win}`);
              if (!placeValid && hrnOutcome.place) errorStub.debug.hrnCandidateRejectedReasons.push(`place_invalid:${hrnOutcome.place}`);
              if (!showValid && hrnOutcome.show) errorStub.debug.hrnCandidateRejectedReasons.push(`show_invalid:${hrnOutcome.show}`);
              if (errorStub.debug.hrnParsedBy && errorStub.debug.hrnParsedBy !== "none") {
                errorStub.debug.hrnParsedBy = "validation_failed";
              }
            }
          }
          
          // Rebuild summary with final outcome
          try {
            errorStub.summary = buildSummary({
              date: errorStub.date || canonicalDateIso,
              uiDateRaw: errorStub.debug?.uiDateRaw,
              outcome: errorStub.outcome,
              step: errorStub.step,
              query: errorStub.query,
            });
          } catch (err) {
            console.error("[verify_race] Error rebuilding summary:", err);
            errorStub.summary = errorStub.summary || `Step: ${errorStub.step || "unknown"}`;
          }
        } else {
          // HRN failed, try Equibase fallback
          const { outcome: equibaseOutcome, debugExtras: equibaseDebug } = await tryEquibaseFallback(track, canonicalDateIso, canonicalRaceNo, errorStub.debug);
          errorStub.debug = { ...errorStub.debug, ...equibaseDebug };

          if (equibaseOutcome) {
            // CRITICAL: Only copy win/place/show properties - never spread entire object which might contain ok
            errorStub.outcome = {
              win: equibaseOutcome?.win || "",
              place: equibaseOutcome?.place || "",
              show: equibaseOutcome?.show || "",
            };
            // Defensive cleanup - ensure no ok property
            delete errorStub.outcome.ok;
            errorStub.ok = Boolean(true); // Explicitly boolean
            errorStub.step = "verify_race_fallback_equibase";
            
            // Recompute hits if we have predicted values
            if (errorStub.predicted) {
              const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
              const norm = normalizeHorseName;
              const pWin = norm(errorStub.predicted.win);
              const pPlace = norm(errorStub.predicted.place);
              const pShow = norm(errorStub.predicted.show);
              const oWin = norm(equibaseOutcome.win);
              const oPlace = norm(equibaseOutcome.place);
              const oShow = norm(equibaseOutcome.show);

              const winHit = !!pWin && !!oWin && pWin === oWin;
              const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
              const showHit = !!pShow && !!oShow && pShow === oShow;
              const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
              const top3Hit = [pWin, pPlace, pShow]
                .filter(Boolean)
                .some(name => top3Set.has(name));

              errorStub.hits = {
                winHit,
                placeHit,
                showHit,
                top3Hit,
              };
            }
            
            // Rebuild summary with final outcome
            try {
              errorStub.summary = buildSummary({
                date: errorStub.date || canonicalDateIso,
                uiDateRaw: errorStub.debug?.uiDateRaw,
                outcome: errorStub.outcome,
                step: errorStub.step,
                query: errorStub.query,
              });
            } catch (err) {
              console.error("[verify_race] Error rebuilding summary:", err);
              errorStub.summary = errorStub.summary || `Step: ${errorStub.step || "unknown"}`;
            }
          }
        }
      }

      // Add GreenZone (safe, never throws)
      await addGreenZoneToResponse(errorStub);
      
      await logVerifyResult(errorStub);
      // CRITICAL: Ensure ok is always boolean (defensive check against type corruption)
      const sanitizedErrorStub = sanitizeResponse(errorStub);
      return res.status(200).json({
        ...sanitizedErrorStub,
        bypassedPayGate: bypassedPayGate,
        responseMeta: {
          handlerFile: HANDLER_FILE,
          backendVersion: BACKEND_VERSION,
          bypassedPayGate: bypassedPayGate,
          internalBypassAuthorized: internalBypassAuthorized,
        },
      });
    }
  } catch (err) {
    // Absolute last-resort catch; still return 200.
    console.error("[verify_race] UNEXPECTED ERROR", err);
    // Try to extract date from body if available, otherwise use empty string (no today fallback)
    const errorBody = await safeParseBody(req).catch(() => ({}));
    const rawDateFromBody = (errorBody && (errorBody.date || errorBody.raceDate || errorBody.race_date || "")) || "";
    
    // Pure string helper for date normalization (reuse the same logic)
    function canonicalizeDateFromClient(raw) {
      if (!raw) return null;
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return s;
      }
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const mm = m[1].padStart(2, "0");
        const dd = m[2].padStart(2, "0");
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }
      return s;
    }
    
    const errorDateIso = canonicalizeDateFromClient(rawDateFromBody) || "";  // No fallback to today
    const errorPredicted = normalizePredictedFromBody(errorBody);
    const stub = await buildStubResponse({
      track: null,
      date: errorDateIso,
      raceNo: null,
      predicted: errorPredicted,
    });
    const errorStub = {
      ...stub,
      ok: false,
      step: "verify_race_stub_unexpected_error",
      error: String(err && err.message ? err.message : err),
      summary: "Verify Race stub encountered an unexpected error, but the handler still returned 200.",
      date: errorDateIso,
      predicted: stub.predicted || errorPredicted,
      debug: {
        ...(stub.debug || {}), // Preserve ALL debug fields from stub
        error: String(err && err.message ? err.message : err),
        errorStack: err?.stack || undefined,
        backendVersion: BACKEND_VERSION,
        handlerFile: HANDLER_FILE,
      },
    };
    // Add GreenZone (safe, never throws) - even for error cases
    await addGreenZoneToResponse(errorStub);
    // Don't log error cases (ok: false)
    // CRITICAL: Ensure ok is always boolean (defensive check against type corruption)
    const sanitizedErrorStub = sanitizeResponse(errorStub);
    return res.status(200).json(sanitizedErrorStub);
  }
}
