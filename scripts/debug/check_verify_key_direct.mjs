#!/usr/bin/env node
/**
 * scripts/debug/check_verify_key_direct.mjs
 * 
 * Directly check if a specific verify key exists in Redis.
 * 
 * Usage:
 *   node scripts/debug/check_verify_key_direct.mjs <key>
 * 
 * Example:
 *   node scripts/debug/check_verify_key_direct.mjs fl:verify:meadowlands-2026-01-11-unknown-r8
 */

import { Redis } from "@upstash/redis";

const KEY = process.argv[2];

if (!KEY) {
  console.error("[check_key] Error: Key required");
  console.error("[check_key] Usage: node scripts/debug/check_verify_key_direct.mjs <key>");
  process.exit(1);
}

let redis;
try {
  redis = Redis.fromEnv();
} catch (err) {
  console.error("[check_key] Redis client initialization failed:", err.message);
  process.exit(1);
}

async function checkKey() {
  console.log(`[check_key] Checking key: ${KEY}\n`);
  
  try {
    const rawValue = await redis.get(KEY);
    
    if (!rawValue) {
      console.log(`[check_key] ❌ Key NOT found in Redis`);
      console.log(`[check_key] Key: ${KEY}`);
      return;
    }
    
    console.log(`[check_key] ✅ Key EXISTS in Redis\n`);
    
    let payload;
    try {
      payload = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    } catch (parseErr) {
      console.error(`[check_key] ❌ Failed to parse payload: ${parseErr.message}`);
      return;
    }
    
    // Get TTL
    let ttl = null;
    try {
      ttl = await redis.ttl(KEY);
      if (ttl < 0) ttl = null;
    } catch {}
    
    console.log(`[check_key] Key Payload:`);
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\n[check_key] TTL: ${ttl !== null ? `${ttl} seconds (${Math.floor(ttl / (24 * 60 * 60))}d ${Math.floor((ttl % (24 * 60 * 60)) / (60 * 60))}h)` : "N/A"}`);
    
  } catch (err) {
    console.error(`[check_key] ❌ Error: ${err.message}`);
    if (err.stack) console.error(err.stack);
  }
}

checkKey().catch(err => {
  console.error("[check_key] ❌ FATAL ERROR:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
