// pages/api/debug_verify_key.js
// Diagnostic endpoint to test verify key computation and existence
// Safe: no secrets exposed, read-only operations

export const config = {
  runtime: "nodejs",
};

import { buildVerifyRaceId } from "../../lib/verify_normalize.js";
import { buildVerifyKey } from "../../utils/finishline/backfill_helpers.js";
import { getRedis } from "../../utils/finishline/backfill_helpers.js";
import { getRedisEnv } from "../../lib/redis.js";

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  
  // Only allow GET for safety (read-only)
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
      message: "This endpoint only supports GET",
    });
  }
  
  const { track, date, raceNo, surface } = req.query;
  
  if (!track || !date || !raceNo) {
    return res.status(400).json({
      ok: false,
      error: "Missing required parameters",
      message: "Required: track, date, raceNo (all query params)",
      example: "/api/debug_verify_key?track=Aqueduct&date=2026-01-09&raceNo=7",
    });
  }
  
  try {
    // Use centralized normalization (same as verify_race and verify_backfill)
    const raceId = buildVerifyRaceId(track, date, raceNo, surface || "unknown");
    const key = buildVerifyKey(raceId);
    
    // Check if key exists in Redis
    let exists = false;
    let keyType = null;
    let valuePreview = null;
    let redisConfigured = false;
    
    const redis = getRedis();
    redisConfigured = Boolean(redis);
    
    if (redis) {
      try {
        keyType = await redis.type(key);
        exists = keyType === "string" || keyType === "hash";
        
        if (exists) {
          if (keyType === "string") {
            const value = await redis.get(key);
            if (value) {
              valuePreview = String(value).slice(0, 80);
            }
          } else if (keyType === "hash") {
            const hash = await redis.hgetall(key);
            if (hash && Object.keys(hash).length > 0) {
              valuePreview = JSON.stringify(hash).slice(0, 80);
            }
          }
        }
      } catch (redisErr) {
        // Non-fatal: include error in response
        return res.status(200).json({
          ok: false,
          error: "Redis check failed",
          message: redisErr?.message || String(redisErr),
          computed: {
            raceId,
            key,
            track,
            date,
            raceNo,
            surface: surface || "unknown",
          },
          redisConfigured: true,
        });
      }
    }
    
    // Get safe Redis URL fingerprint
    let redisUrlFingerprint = null;
    try {
      const redisEnv = getRedisEnv();
      if (redisEnv.url) {
        const urlObj = new URL(redisEnv.url);
        const host = urlObj.hostname;
        redisUrlFingerprint = host.length > 6 ? host.slice(-6) : host;
      }
    } catch {}
    
    return res.status(200).json({
      ok: true,
      computed: {
        raceId,
        key,
        track,
        date,
        raceNo,
        surface: surface || "unknown",
      },
      redis: {
        configured: redisConfigured,
        keyExists: exists,
        keyType: keyType || "none",
        valuePreview: valuePreview || null,
        urlFingerprint: redisUrlFingerprint,
      },
      debug: {
        usedDeployment: process.env.VERCEL_GIT_COMMIT_SHA || null,
        usedEnv: process.env.VERCEL_ENV || null,
        prefix: "fl:verify:",
      },
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: "Computation failed",
      message: err?.message || String(err),
      input: { track, date, raceNo, surface: surface || "unknown" },
    });
  }
}
