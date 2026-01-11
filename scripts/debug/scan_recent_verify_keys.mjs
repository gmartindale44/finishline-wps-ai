#!/usr/bin/env node
/**
 * scripts/debug/scan_recent_verify_keys.mjs
 * 
 * Scan Upstash for recent verify keys for specific tracks and dates.
 * Used to verify that Geoff's test races were logged correctly.
 * 
 * Usage:
 *   node scripts/debug/scan_recent_verify_keys.mjs [date] [track1] [track2] ...
 * 
 * Defaults:
 *   date: 2026-01-11 (today)
 *   tracks: meadowlands, charles-town
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
  console.error("[scan_recent] Redis client initialization failed:", err.message);
  console.error("[scan_recent] Ensure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set");
  process.exit(1);
}

// Parse arguments
const args = process.argv.slice(2);
const targetDate = args[0] || "2026-01-11";
const targetTracks = args.length > 1 ? args.slice(1) : ["meadowlands", "charles-town"];

/**
 * Normalize track name for key matching (try multiple formats)
 */
function normalizeTrackForKey(track) {
  const normalized = String(track || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return normalized;
}

/**
 * Get safe payload summary
 */
function summarizePayload(payload, maxLength = 200) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  
  const summary = {
    track: payload.track || null,
    date: payload.date || payload.dateIso || null,
    raceNo: payload.raceNo || null,
    step: payload.step || null,
    ok: payload.ok !== undefined ? payload.ok : null,
    confidence_pct: payload.confidence_pct !== undefined ? payload.confidence_pct : null,
    t3m_pct: payload.t3m_pct !== undefined ? payload.t3m_pct : null,
    created_at: payload.created_at || payload.ts ? (payload.created_at || new Date(payload.ts).toISOString()) : null,
    created_at_ms: payload.created_at_ms || payload.ts || null,
  };
  
  return summary;
}

async function scanTracks() {
  console.log(`[scan_recent] Scanning verify keys for date: ${targetDate}`);
  console.log(`[scan_recent] Tracks: ${targetTracks.join(", ")}\n`);
  
  const results = [];
  
  for (const track of targetTracks) {
    const trackNormalized = normalizeTrackForKey(track);
    
    // Try multiple patterns (exact match first, then fallback)
    const patterns = [
      `fl:verify:${trackNormalized}-${targetDate}*`,  // Exact match
      `fl:verify:*${trackNormalized}*${targetDate}*`, // Contains track and date
      `fl:verify:*${targetDate}*${trackNormalized}*`, // Contains date and track (reversed)
    ];
    
    // Also try with spaces for charles-town -> charles town
    if (trackNormalized.includes("-")) {
      const trackSpaced = trackNormalized.replace(/-/g, " ");
      patterns.push(`fl:verify:*${trackSpaced}*${targetDate}*`);
      patterns.push(`fl:verify:*${targetDate}*${trackSpaced}*`);
    }
    
    // Additional fallback patterns for partial matches
    // For "meadowlands" -> also try "meadow"
    if (trackNormalized.includes("meadow")) {
      patterns.push(`fl:verify:*${targetDate}*meadow*`);
    }
    // For "charles-town" or "charles" -> also try "charles"
    if (trackNormalized.includes("charles")) {
      patterns.push(`fl:verify:*${targetDate}*charles*`);
    }
    
    console.log(`[scan_recent] Scanning track: ${track} (patterns: ${patterns.length})`);
    
    for (const pattern of patterns) {
      try {
        const keys = await redis.keys(pattern);
        
        for (const key of keys) {
          try {
            const rawValue = await redis.get(key);
            if (!rawValue) continue;
            
            let payload;
            try {
              payload = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
            } catch (parseErr) {
              console.warn(`[scan_recent] Failed to parse key ${key}: ${parseErr.message}`);
              continue;
            }
            
            // Get TTL
            let ttl = null;
            try {
              ttl = await redis.ttl(key);
              if (ttl < 0) ttl = null;
            } catch {}
            
            results.push({
              key,
              payload: summarizePayload(payload),
              ttlSeconds: ttl,
            });
          } catch (err) {
            console.warn(`[scan_recent] Error processing key ${key}: ${err.message}`);
          }
        }
      } catch (err) {
        console.warn(`[scan_recent] Error scanning pattern ${pattern}: ${err.message}`);
      }
    }
  }
  
  // Sort by created_at_ms (newest first)
  results.sort((a, b) => {
    const aTs = a.payload.created_at_ms || 0;
    const bTs = b.payload.created_at_ms || 0;
    return bTs - aTs;
  });
  
  // Print results
  console.log(`\n[scan_recent] Found ${results.length} verify keys\n`);
  
  if (results.length === 0) {
    console.log("[scan_recent] No keys found. Trying broader search...");
    // Try scanning all verify keys for the date
    try {
      const allKeys = await redis.keys(`fl:verify:*${targetDate}*`);
      console.log(`[scan_recent] Found ${allKeys.length} total verify keys for ${targetDate}`);
      if (allKeys.length > 0) {
        console.log(`[scan_recent] Sample keys (first 10):`);
        allKeys.slice(0, 10).forEach(key => console.log(`  ${key}`));
      }
    } catch (err) {
      console.warn(`[scan_recent] Error in broader search: ${err.message}`);
    }
  } else {
    console.log("Results (newest first):\n");
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.key}`);
      console.log(`   Track: ${r.payload.track || "N/A"}`);
      console.log(`   Date: ${r.payload.date || "N/A"}`);
      console.log(`   Race No: ${r.payload.raceNo || "N/A"}`);
      console.log(`   Step: ${r.payload.step || "N/A"}`);
      console.log(`   OK: ${r.payload.ok}`);
      console.log(`   Confidence: ${r.payload.confidence_pct !== null ? r.payload.confidence_pct : "N/A"}`);
      console.log(`   T3M: ${r.payload.t3m_pct !== null ? r.payload.t3m_pct : "N/A"}`);
      console.log(`   Created: ${r.payload.created_at || "N/A"}`);
      if (r.ttlSeconds !== null) {
        const days = Math.floor(r.ttlSeconds / (24 * 60 * 60));
        const hours = Math.floor((r.ttlSeconds % (24 * 60 * 60)) / (60 * 60));
        console.log(`   TTL: ${days}d ${hours}h`);
      }
      console.log("");
    });
  }
  
  // Write results to JSON file
  const outputPath = path.join(__dirname, "../../temp_recent_verify_keys.json");
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`[scan_recent] ✓ Results written to ${outputPath}`);
  
  return results;
}

scanTracks().catch(err => {
  console.error("[scan_recent] Fatal error:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
