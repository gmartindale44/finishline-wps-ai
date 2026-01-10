/**
 * Debug endpoint to delete a specific verify key from Redis
 * PREVIEW ONLY: Must be in preview environment and/or require secret header
 * 
 * Usage: DELETE /api/debug_delete_verify_key?track=<track>&date=<date>&raceNo=<raceNo>
 *        Headers: X-Internal-Debug-Key: <DEBUG_KEY from env>
 */
import { buildVerifyRaceId } from "../../lib/verify_normalize.js";
import { getRedis } from "../../utils/finishline/backfill_helpers.js";
import { getRedisEnv } from "../../lib/redis.js";

const VERIFY_PREFIX = "fl:verify:";

export default async function handler(req, res) {
  // PREVIEW ONLY: Gate to preview environment
  const vercelEnv = process.env.VERCEL_ENV || "";
  const isPreview = vercelEnv === "preview";
  
  // Also require secret header for extra safety
  const debugKeyHeader = req.headers['x-internal-debug-key'] || "";
  const expectedDebugKey = process.env.DEBUG_KEY || "";
  const headerOk = expectedDebugKey && debugKeyHeader === expectedDebugKey;
  
  if (!isPreview && !headerOk) {
    return res.status(403).json({
      ok: false,
      error: "Forbidden",
      message: "This endpoint is only available in preview environment or with valid debug key",
      vercelEnv,
      headerPresent: !!debugKeyHeader,
    });
  }
  
  if (req.method !== "DELETE" && req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
      method: req.method,
      allowed: ["DELETE", "POST"],
    });
  }
  
  const { track, date, raceNo, surface } = req.method === "DELETE" ? req.query : (req.body || {});
  
  if (!track || !date || !raceNo) {
    return res.status(400).json({
      ok: false,
      error: "Missing required parameters",
      required: ["track", "date", "raceNo"],
      received: { track: !!track, date: !!date, raceNo: !!raceNo },
    });
  }
  
  try {
    // Build verify key using same normalization as verify_race
    const raceId = buildVerifyRaceId(track, date, raceNo, surface || "unknown");
    const verifyKey = `${VERIFY_PREFIX}${raceId}`;
    
    // Get Redis client (try SDK first, fallback to REST)
    let redis = getRedis();
    let redisClientType = "SDK";
    
    if (!redis) {
      // Try REST client as fallback
      try {
        const { del: redisDel, type: redisType } = await import("../../lib/redis.js");
        redis = { del: redisDel, type: redisType };
        redisClientType = "REST";
      } catch {
        return res.status(500).json({
          ok: false,
          error: "Redis not configured (both SDK and REST failed)",
          verifyKey,
          raceId,
        });
      }
    }
    
    // Check if key exists first
    let keyType = null;
    let keyExists = false;
    try {
      if (redis.type) {
        keyType = await redis.type(verifyKey);
        keyExists = keyType === "string" || keyType === "hash";
      } else {
        // REST client - try to get to check existence
        const { get: redisGet } = await import("../../lib/redis.js");
        const value = await redisGet(verifyKey);
        keyExists = value !== null && value !== undefined;
        keyType = keyExists ? "string" : null;
      }
    } catch (typeErr) {
      console.error("[debug_delete_verify_key] Error checking key type:", typeErr);
      // Continue anyway - try to delete
    }
    
    let deletedCount = 0;
    if (keyExists && redis.del) {
      try {
        // Delete the key (works for both string and hash types)
        const result = await redis.del(verifyKey);
        deletedCount = typeof result === "number" ? result : (result ? 1 : 0);
      } catch (delErr) {
        console.error("[debug_delete_verify_key] Error deleting key:", delErr);
        // Return error
        return res.status(500).json({
          ok: false,
          error: `Deletion failed: ${delErr?.message || String(delErr)}`,
          verifyKey,
          raceId,
          keyExists,
          keyType,
          redisClientType,
        });
      }
    }
    
    // Get Vercel Git commit SHA if available
    const vercelGitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_REF || null;
    
    return res.status(200).json({
      ok: true,
      verifyKey,
      raceId,
      keyExists,
      keyType: keyExists ? keyType : null,
      deletedCount,
      redisClientType,
      env: vercelEnv,
      vercelGitCommitSha,
      message: deletedCount > 0 
        ? `Successfully deleted verify key: ${verifyKey}`
        : keyExists 
          ? `Key exists but deletion returned 0 (may be a different type or already deleted)`
          : `Key does not exist: ${verifyKey}`,
    });
  } catch (err) {
    console.error("[debug_delete_verify_key] Error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      track,
      date,
      raceNo,
    });
  }
}
