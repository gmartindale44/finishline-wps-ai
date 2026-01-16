#!/usr/bin/env node
/**
 * scripts/debug/check_verify_key_prod.mjs
 * 
 * Check if a verify key exists in production Redis
 * 
 * Usage:
 *   node scripts/debug/check_verify_key_prod.mjs <baseUrl> "Mahoning Valley" "2026-01-13" "7"
 */

const BASE_URL = process.argv[2] || "https://finishline-wps-ai.vercel.app";
const TRACK = process.argv[3] || "";
const DATE = process.argv[4] || "";
const RACE_NO = process.argv[5] || "";

if (!TRACK || !DATE || !RACE_NO) {
  console.error("Usage: node scripts/debug/check_verify_key_prod.mjs <baseUrl> <track> <date> <raceNo>");
  console.error("Example: node scripts/debug/check_verify_key_prod.mjs https://finishline-wps-ai.vercel.app \"Mahoning Valley\" \"2026-01-13\" \"7\"");
  process.exit(1);
}

async function main() {
  try {
    const url = new URL(`${BASE_URL}/api/debug_verify_key`);
    url.searchParams.set("track", TRACK);
    url.searchParams.set("date", DATE);
    url.searchParams.set("raceNo", RACE_NO);
    
    console.log(`[check_verify_key] Checking Redis for verify key...`);
    console.log(`  Track: ${TRACK}`);
    console.log(`  Date: ${DATE}`);
    console.log(`  Race No: ${RACE_NO}`);
    console.log(`  URL: ${url.toString()}`);
    console.log("");
    
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });
    
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error(`[check_verify_key] Failed to parse response as JSON:`);
      console.error(`  HTTP Status: ${response.status}`);
      console.error(`  Response: ${text.slice(0, 200)}`);
      process.exit(1);
    }
    
    if (!json.ok) {
      console.error(`[check_verify_key] Request failed:`);
      console.error(`  Error: ${json.error || "Unknown error"}`);
      console.error(`  Message: ${json.message || "No message"}`);
      if (json.computed) {
        console.error(`  Computed key: ${json.computed.key || "N/A"}`);
      }
      process.exit(1);
    }
    
    console.log(`[check_verify_key] ✓ Request successful`);
    console.log("");
    console.log(`Computed Verify Key:`);
    console.log(`  Race ID: ${json.computed.raceId || "N/A"}`);
    console.log(`  Full Key: ${json.computed.key || "N/A"}`);
    console.log("");
    console.log(`Redis Status:`);
    console.log(`  Configured: ${json.redis.configured ? "Yes" : "No"}`);
    console.log(`  Key Exists: ${json.redis.keyExists ? "✓ YES" : "✗ NO"}`);
    console.log(`  Key Type: ${json.redis.keyType || "none"}`);
    if (json.redis.valuePreview) {
      console.log(`  Value Preview: ${json.redis.valuePreview}`);
    }
    if (json.redis.urlFingerprint) {
      console.log(`  Redis URL Fingerprint: ${json.redis.urlFingerprint}`);
    }
    console.log("");
    console.log(`Deployment Info:`);
    console.log(`  Environment: ${json.debug.usedEnv || "N/A"}`);
    console.log(`  Commit: ${json.debug.usedDeployment || "N/A"}`);
    console.log("");
    
    if (json.redis.keyExists) {
      console.log(`✅ VERIFICATION SUCCESS: Verify key exists in Redis`);
      console.log(`   Key: ${json.computed.key}`);
    } else {
      console.log(`⚠️  VERIFICATION WARNING: Verify key NOT found in Redis`);
      console.log(`   Expected key: ${json.computed.key}`);
      console.log(`   This may indicate:`);
      console.log(`   - Race was not verified yet`);
      console.log(`   - Key expired (TTL: 90 days)`);
      console.log(`   - Different Redis instance`);
    }
    
  } catch (err) {
    console.error(`[check_verify_key] Fatal error:`, err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
