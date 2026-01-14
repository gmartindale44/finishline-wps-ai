#!/usr/bin/env node
/**
 * scripts/debug/fetch_charles_town_keys.mjs
 * 
 * Diagnostic script to fetch Charles Town verify/predmeta/predsnap keys from Upstash.
 * Safe: No secrets exposed, only key names and structured payload summaries.
 * 
 * Usage:
 *   node scripts/debug/fetch_charles_town_keys.mjs
 * 
 * Requires env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { Redis } from "@upstash/redis";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Redis client
let redis;
try {
  redis = Redis.fromEnv();
} catch (err) {
  console.error("[fetch_charles_town] Redis client initialization failed:", err.message);
  console.error("[fetch_charles_town] Ensure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set");
  process.exit(1);
}

/**
 * Get safe payload summary (no secrets, structured)
 */
function summarizePayload(payload, maxLength = 200) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  
  const summary = {};
  
  // Extract key fields
  if (payload.track) summary.track = payload.track;
  if (payload.date || payload.dateIso) summary.date = payload.date || payload.dateIso;
  if (payload.raceNo) summary.raceNo = payload.raceNo;
  if (payload.ok !== undefined) summary.ok = payload.ok;
  
  if (payload.outcome) {
    summary.outcome = {
      win: payload.outcome.win || null,
      place: payload.outcome.place || null,
      show: payload.outcome.show || null,
    };
  }
  
  if (payload.predicted) {
    summary.predicted = {
      win: payload.predicted.win || null,
      place: payload.predicted.place || null,
      show: payload.predicted.show || null,
    };
  }
  
  // Predmeta fields
  if (payload.confidence_pct !== undefined) summary.confidence_pct = payload.confidence_pct;
  if (payload.t3m_pct !== undefined) summary.t3m_pct = payload.t3m_pct;
  if (payload.top3_list) summary.top3_list = payload.top3_list;
  
  // HRN debug fields
  if (payload.debug) {
    const debug = payload.debug;
    summary.debug = {};
    if (debug.hrnParsedBy) summary.debug.hrnParsedBy = debug.hrnParsedBy;
    if (debug.hrnHttpStatus) summary.debug.hrnHttpStatus = debug.hrnHttpStatus;
    if (debug.hrnUrl) summary.debug.hrnUrl = debug.hrnUrl;
    if (debug.hrnRegionFound !== undefined) summary.debug.hrnRegionFound = debug.hrnRegionFound;
    if (debug.hrnFoundMarkers) summary.debug.hrnFoundMarkers = debug.hrnFoundMarkers;
  }
  
  // Meta fields
  if (payload.meta) {
    summary.meta = {};
    if (payload.meta.asOf) summary.meta.asOf = payload.meta.asOf;
    if (payload.meta.raceId) summary.meta.raceId = payload.meta.raceId;
  }
  
  // Step/source
  if (payload.step) summary.step = payload.step;
  if (payload.source) summary.source = payload.source;
  
  return summary;
}

/**
 * Get TTL for a key (seconds remaining)
 */
async function getTTL(key) {
  try {
    const ttl = await redis.ttl(key);
    return ttl >= 0 ? ttl : null; // -1 = no expiration, -2 = key doesn't exist
  } catch (err) {
    return null;
  }
}

/**
 * Format TTL as human-readable
 */
function formatTTL(ttlSeconds) {
  if (ttlSeconds === null || ttlSeconds < 0) return "No expiration";
  
  const days = Math.floor(ttlSeconds / (24 * 60 * 60));
  const hours = Math.floor((ttlSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((ttlSeconds % (60 * 60)) / 60);
  
  if (days > 0) return `${days} days, ${hours} hours`;
  if (hours > 0) return `${hours} hours, ${minutes} minutes`;
  return `${minutes} minutes`;
}

async function main() {
  console.log("[fetch_charles_town] Scanning Upstash for Charles Town keys...\n");
  
  const results = {
    verifyKeys: [],
    predmetaKeys: [],
    predsnapKeys: [],
    errors: [],
  };
  
  try {
    // Scan verify keys: fl:verify:*charles*town*
    console.log("[fetch_charles_town] Scanning verify keys (fl:verify:*charles*town*)...");
    try {
      const verifyPattern = "fl:verify:*charles*town*";
      const verifyKeys = await redis.keys(verifyPattern);
      
      // Get most recent verify keys (limit to 10 most recent)
      const verifyKeysSorted = verifyKeys.sort().reverse().slice(0, 10);
      
      for (const key of verifyKeysSorted) {
        try {
          const rawValue = await redis.get(key);
          if (!rawValue) continue;
          
          // Parse JSON
          let payload;
          try {
            payload = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
          } catch (parseErr) {
            results.errors.push({ key, error: `JSON parse failed: ${parseErr.message}` });
            continue;
          }
          
          const ttl = await getTTL(key);
          
          results.verifyKeys.push({
            key,
            payload: summarizePayload(payload),
            ttlSeconds: ttl,
            ttlHuman: formatTTL(ttl),
            hasPredmeta: payload.confidence_pct !== undefined || payload.t3m_pct !== undefined,
          });
        } catch (err) {
          results.errors.push({ key, error: err.message });
        }
      }
      
      console.log(`[fetch_charles_town] Found ${results.verifyKeys.length} verify keys`);
    } catch (err) {
      results.errors.push({ operation: "verify_scan", error: err.message });
    }
    
    // Scan predmeta keys: fl:predmeta:*charles*town*
    console.log("[fetch_charles_town] Scanning predmeta keys (fl:predmeta:*charles*town*)...");
    try {
      const predmetaPattern = "fl:predmeta:*charles*town*";
      const predmetaKeys = await redis.keys(predmetaPattern);
      
      // Get most recent predmeta keys (limit to 10 most recent)
      const predmetaKeysSorted = predmetaKeys.sort().reverse().slice(0, 10);
      
      for (const key of predmetaKeysSorted) {
        try {
          const rawValue = await redis.get(key);
          if (!rawValue) continue;
          
          // Parse JSON
          let payload;
          try {
            payload = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
          } catch (parseErr) {
            results.errors.push({ key, error: `JSON parse failed: ${parseErr.message}` });
            continue;
          }
          
          const ttl = await getTTL(key);
          
          results.predmetaKeys.push({
            key,
            payload: summarizePayload(payload),
            ttlSeconds: ttl,
            ttlHuman: formatTTL(ttl),
          });
        } catch (err) {
          results.errors.push({ key, error: err.message });
        }
      }
      
      console.log(`[fetch_charles_town] Found ${results.predmetaKeys.length} predmeta keys`);
    } catch (err) {
      results.errors.push({ operation: "predmeta_scan", error: err.message });
    }
    
    // Scan predsnap keys: fl:predsnap:*charles*town*
    console.log("[fetch_charles_town] Scanning predsnap keys (fl:predsnap:*charles*town*)...");
    try {
      const predsnapPattern = "fl:predsnap:*charles*town*";
      const predsnapKeys = await redis.keys(predsnapPattern);
      
      // Get most recent predsnap keys (limit to 10 most recent)
      const predsnapKeysSorted = predsnapKeys.sort().reverse().slice(0, 10);
      
      for (const key of predsnapKeysSorted) {
        try {
          const rawValue = await redis.get(key);
          if (!rawValue) continue;
          
          // Parse JSON
          let payload;
          try {
            payload = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
          } catch (parseErr) {
            results.errors.push({ key, error: `JSON parse failed: ${parseErr.message}` });
            continue;
          }
          
          const ttl = await getTTL(key);
          
          results.predsnapKeys.push({
            key,
            payload: summarizePayload(payload),
            ttlSeconds: ttl,
            ttlHuman: formatTTL(ttl),
          });
        } catch (err) {
          results.errors.push({ key, error: err.message });
        }
      }
      
      console.log(`[fetch_charles_town] Found ${results.predsnapKeys.length} predsnap keys`);
    } catch (err) {
      results.errors.push({ operation: "predsnap_scan", error: err.message });
    }
    
    // Write results to JSON file
    const outputPath = path.join(__dirname, "../../temp_charles_town_keys.json");
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`\n[fetch_charles_town] ✓ Results written to ${outputPath}`);
    
    // Print summary
    console.log("\n[fetch_charles_town] Summary:");
    console.log(`  Verify keys: ${results.verifyKeys.length}`);
    console.log(`  Predmeta keys: ${results.predmetaKeys.length}`);
    console.log(`  Predsnap keys: ${results.predsnapKeys.length}`);
    if (results.errors.length > 0) {
      console.log(`  Errors: ${results.errors.length}`);
    }
    
  } catch (err) {
    console.error("[fetch_charles_town] Fatal error:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
