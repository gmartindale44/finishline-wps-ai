#!/usr/bin/env node
/**
 * scripts/debug/smoke_verify_suite.mjs
 * 
 * End-to-end smoke test for verify_race endpoint (manual and auto modes).
 * Tests that verify logs are written to Upstash after API calls.
 * 
 * Usage:
 *   node scripts/debug/smoke_verify_suite.mjs <url>
 * 
 * Example:
 *   node scripts/debug/smoke_verify_suite.mjs https://finishline-wps-ai-git-chore-preview-smoke-manual-verify.vercel.app
 */

import { Redis } from "@upstash/redis";
import { buildVerifyRaceId } from "../../lib/verify_normalize.js";

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.error("[smoke_verify] Error: URL required");
  console.error("[smoke_verify] Usage: node scripts/debug/smoke_verify_suite.mjs <url>");
  process.exit(1);
}

const API_URL = `${TARGET_URL}/api/verify_race`;

// Initialize Redis client
let redis;
try {
  redis = Redis.fromEnv();
} catch (err) {
  console.error("[smoke_verify] Redis client initialization failed:", err.message);
  console.error("[smoke_verify] Ensure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set");
  process.exit(1);
}

/**
 * Normalize track name for key matching
 */
function normalizeTrackForKey(track) {
  if (!track) return "";
  return String(track)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build verify key from race details
 */
function buildVerifyKey(track, date, raceNo) {
  const trackNorm = normalizeTrackForKey(track);
  const dateNorm = String(date || "").trim();
  const raceNoNorm = String(raceNo || "").trim();
  
  // Use same normalization as verify_race.js
  const raceId = buildVerifyRaceId(track, date, raceNo);
  return `fl:verify:${raceId}`;
}

/**
 * Check if verify key exists in Redis
 */
async function checkVerifyKey(verifyKey) {
  try {
    const rawValue = await redis.get(verifyKey);
    if (!rawValue) {
      return { exists: false, payload: null, ttl: null };
    }
    
    let payload;
    try {
      payload = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    } catch (parseErr) {
      return { exists: true, payload: null, ttl: null, parseError: parseErr.message };
    }
    
    // Get TTL
    let ttl = null;
    try {
      ttl = await redis.ttl(verifyKey);
      if (ttl < 0) ttl = null;
    } catch {}
    
    return { exists: true, payload, ttl };
  } catch (err) {
    return { exists: false, payload: null, ttl: null, error: err.message };
  }
}

/**
 * Test manual verify
 */
async function testManualVerify() {
  console.log("\n[smoke_verify] === TEST 1: Manual Verify ===\n");
  
  const testPayload = {
    mode: "manual",
    track: "Meadowlands",
    date: "2026-01-11",
    raceNo: "8",
    outcome: {
      win: "Smoke Test Winner",
      place: "Smoke Test Place",
      show: "Smoke Test Show"
    }
  };
  
  console.log("[smoke_verify] Request payload:");
  console.log(JSON.stringify(testPayload, null, 2));
  console.log("\n[smoke_verify] Sending request...\n");
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });
    
    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (parseErr) {
      console.error(`[smoke_verify] ❌ FAILED: Response is not valid JSON`);
      console.error(`[smoke_verify] HTTP Status: ${response.status}`);
      console.error(`[smoke_verify] Response body (first 500 chars):`);
      console.error(responseText.slice(0, 500));
      return { success: false, error: "Invalid JSON response" };
    }
    
    console.log("[smoke_verify] Response JSON:");
    console.log(JSON.stringify(responseJson, null, 2));
    console.log("\n[smoke_verify] Analysis:\n");
    
    // Check for ReferenceError
    if (responseJson.summary && responseJson.summary.includes("predmeta is not defined")) {
      console.error(`[smoke_verify] ❌ FAILED: Response summary contains "predmeta is not defined"`);
      return { success: false, error: "predmeta ReferenceError still present" };
    }
    
    if (responseJson.debug && responseJson.debug.error && responseJson.debug.error.includes("predmeta is not defined")) {
      console.error(`[smoke_verify] ❌ FAILED: Debug.error contains "predmeta is not defined"`);
      return { success: false, error: "predmeta ReferenceError still present" };
    }
    
    // Check HTTP status
    if (response.status !== 200) {
      console.error(`[smoke_verify] ❌ FAILED: HTTP status ${response.status} (expected 200)`);
      return { success: false, error: `HTTP ${response.status}` };
    }
    console.log(`[smoke_verify] ✅ HTTP Status: ${response.status} (OK)`);
    
    // Check for success
    const ok = responseJson.ok === true;
    const step = responseJson.step || "";
    const raceId = responseJson.raceId || "";
    
    console.log(`[smoke_verify] ok: ${ok}`);
    console.log(`[smoke_verify] step: "${step}"`);
    console.log(`[smoke_verify] raceId: "${raceId}"`);
    
    // Check server-side Redis verification from responseMeta
    const responseMeta = responseJson.responseMeta || {};
    const redisMeta = responseMeta.redis || null;
    const redisFingerprint = responseMeta.redisFingerprint || null;
    
    console.log(`[smoke_verify] Server-side Redis verification:`);
    if (redisMeta) {
      console.log(`  verifyKey: ${redisMeta.verifyKey || "N/A"}`);
      console.log(`  writeOk: ${redisMeta.writeOk}`);
      console.log(`  readbackOk: ${redisMeta.readbackOk}`);
      console.log(`  ttlSeconds: ${redisMeta.ttlSeconds !== null ? `${redisMeta.ttlSeconds} (${Math.floor(redisMeta.ttlSeconds / (24 * 60 * 60))}d ${Math.floor((redisMeta.ttlSeconds % (24 * 60 * 60)) / (60 * 60))}h)` : "N/A"}`);
      if (redisMeta.writeErr) {
        console.log(`  writeErr: ${redisMeta.writeErr}`);
      }
      if (redisMeta.readbackErr) {
        console.log(`  readbackErr: ${redisMeta.readbackErr}`);
      }
    } else {
      console.log(`  ⚠️  No Redis metadata in response`);
    }
    
    if (redisFingerprint) {
      console.log(`[smoke_verify] Redis fingerprint:`);
      console.log(`  urlFingerprint: ${redisFingerprint.urlFingerprint || "N/A"}`);
      console.log(`  tokenFingerprint: ${redisFingerprint.tokenFingerprint || "N/A"}`);
    }
    
    // PASS condition: readbackOk must be true
    const readbackOk = redisMeta && redisMeta.readbackOk === true;
    const writeOk = redisMeta && redisMeta.writeOk === true;
    
    if (readbackOk && writeOk) {
      console.log(`[smoke_verify] ✅ PASSED: Server confirms Redis write and readback succeeded`);
      return {
        success: true,
        response: responseJson,
        verifyKey: redisMeta.verifyKey || null,
        writeOk: true,
        readbackOk: true,
        ttlSeconds: redisMeta.ttlSeconds,
        redisFingerprint: redisFingerprint,
      };
    } else {
      console.warn(`[smoke_verify] ⚠️  PARTIAL: writeOk=${writeOk}, readbackOk=${readbackOk}`);
      return {
        success: ok && writeOk,
        response: responseJson,
        verifyKey: redisMeta?.verifyKey || null,
        writeOk: writeOk,
        readbackOk: readbackOk,
        ttlSeconds: redisMeta?.ttlSeconds || null,
        redisFingerprint: redisFingerprint,
        warning: `Redis verification incomplete: writeOk=${writeOk}, readbackOk=${readbackOk}`,
      };
    }
    
  } catch (err) {
    console.error(`[smoke_verify] ❌ FAILED: Network or parsing error: ${err.message}`);
    if (err.stack) console.error(err.stack);
    return { success: false, error: err.message };
  }
}

/**
 * Test auto verify (normal verify path)
 */
async function testAutoVerify() {
  console.log("\n[smoke_verify] === TEST 2: Auto Verify (HRN path) ===\n");
  
  // Use Charles Town as it's more likely to have recent data
  const testPayload = {
    track: "Charles Town",
    date: "2026-01-03",
    raceNo: "1",
    // Omit mode to trigger auto verify
  };
  
  console.log("[smoke_verify] Request payload:");
  console.log(JSON.stringify(testPayload, null, 2));
  console.log("\n[smoke_verify] Sending request...\n");
  console.log("[smoke_verify] Note: HRN may block (403), but we'll capture response cleanly\n");
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });
    
    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (parseErr) {
      console.error(`[smoke_verify] ❌ FAILED: Response is not valid JSON`);
      console.error(`[smoke_verify] HTTP Status: ${response.status}`);
      console.error(`[smoke_verify] Response body (first 500 chars):`);
      console.error(responseText.slice(0, 500));
      return { success: false, error: "Invalid JSON response" };
    }
    
    console.log("[smoke_verify] Response JSON:");
    console.log(JSON.stringify(responseJson, null, 2));
    console.log("\n[smoke_verify] Analysis:\n");
    
    // Check HTTP status (200 is expected, even if HRN blocks)
    console.log(`[smoke_verify] HTTP Status: ${response.status}`);
    
    const ok = responseJson.ok === true;
    const step = responseJson.step || "";
    const raceId = responseJson.raceId || "";
    
    console.log(`[smoke_verify] ok: ${ok}`);
    console.log(`[smoke_verify] step: "${step}"`);
    console.log(`[smoke_verify] raceId: "${raceId}"`);
    
    // Build expected verify key
    const verifyKey = buildVerifyKey("Charles Town", "2026-01-03", "1");
    console.log(`[smoke_verify] Expected verify key: ${verifyKey}`);
    
    // Wait a moment for Redis write
    console.log(`[smoke_verify] Waiting 2 seconds for Redis write...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if verify key exists
    console.log(`[smoke_verify] Checking Redis for verify key...`);
    const keyCheck = await checkVerifyKey(verifyKey);
    
    if (keyCheck.exists) {
      console.log(`[smoke_verify] ✅ Verify key exists in Redis`);
      console.log(`[smoke_verify] TTL: ${keyCheck.ttl !== null ? `${keyCheck.ttl} seconds (${Math.floor(keyCheck.ttl / (24 * 60 * 60))}d ${Math.floor((keyCheck.ttl % (24 * 60 * 60)) / (60 * 60))}h)` : "N/A"}`);
      
      if (keyCheck.payload) {
        const p = keyCheck.payload;
        console.log(`[smoke_verify] Key payload summary:`);
        console.log(`  ok: ${p.ok}`);
        console.log(`  step: ${p.step || "N/A"}`);
        console.log(`  track: ${p.track || "N/A"}`);
        console.log(`  date: ${p.date || p.dateIso || "N/A"}`);
        console.log(`  raceNo: ${p.raceNo || "N/A"}`);
        console.log(`  created_at_ms: ${p.created_at_ms || p.ts || "N/A"}`);
        console.log(`  confidence_pct: ${p.confidence_pct !== undefined ? p.confidence_pct : "N/A"}`);
        console.log(`  t3m_pct: ${p.t3m_pct !== undefined ? p.t3m_pct : "N/A"}`);
        
        return {
          success: true,
          response: responseJson,
          verifyKey,
          keyExists: true,
          keyPayload: p,
          ttl: keyCheck.ttl,
        };
      } else {
        return {
          success: true,
          response: responseJson,
          verifyKey,
          keyExists: true,
          keyPayload: null,
          ttl: keyCheck.ttl,
          parseError: keyCheck.parseError,
        };
      }
    } else {
      console.warn(`[smoke_verify] ⚠️  Verify key NOT found in Redis`);
      console.warn(`[smoke_verify] Key: ${verifyKey}`);
      if (keyCheck.error) {
        console.warn(`[smoke_verify] Error: ${keyCheck.error}`);
      }
      
      return {
        success: ok,
        response: responseJson,
        verifyKey,
        keyExists: false,
        keyPayload: null,
        ttl: null,
        warning: "Verify key not found in Redis",
      };
    }
    
  } catch (err) {
    console.error(`[smoke_verify] ❌ FAILED: Network or parsing error: ${err.message}`);
    if (err.stack) console.error(err.stack);
    return { success: false, error: err.message };
  }
}

/**
 * Main test suite
 */
async function runSuite() {
  console.log(`[smoke_verify] === Smoke Verify Suite ===`);
  console.log(`[smoke_verify] Target URL: ${TARGET_URL}`);
  console.log(`[smoke_verify] API URL: ${API_URL}\n`);
  
  const results = {
    manual: null,
    auto: null,
  };
  
  // Test manual verify
  results.manual = await testManualVerify();
  
  // Test auto verify
  results.auto = await testAutoVerify();
  
  // Summary
  console.log("\n[smoke_verify] === SUMMARY ===\n");
  
  console.log("Manual Verify:");
  if (results.manual.success && results.manual.readbackOk) {
    console.log("  ✅ PASSED: Request succeeded and Redis readback confirmed");
  } else if (results.manual.success && !results.manual.readbackOk) {
    console.log("  ⚠️  PARTIAL: Request succeeded but Redis readback failed");
  } else {
    console.log("  ❌ FAILED: Request failed or error occurred");
  }
  
  console.log("Auto Verify:");
  if (results.auto.success && results.auto.readbackOk) {
    console.log("  ✅ PASSED: Request succeeded and Redis readback confirmed");
  } else if (results.auto.success && !results.auto.readbackOk) {
    console.log("  ⚠️  PARTIAL: Request succeeded but Redis readback failed");
  } else {
    console.log("  ❌ FAILED: Request failed or error occurred");
  }
  
  // Save results to JSON
  const fs = await import('fs/promises');
  const resultsPath = 'temp_smoke_verify_results.json';
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n[smoke_verify] Results saved to: ${resultsPath}`);
  
  return results;
}

runSuite().catch(err => {
  console.error("[smoke_verify] ❌ FATAL ERROR:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
