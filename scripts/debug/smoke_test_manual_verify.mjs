#!/usr/bin/env node
/**
 * scripts/debug/smoke_test_manual_verify.mjs
 * 
 * Smoke test for manual verify fix on preview/production.
 * Tests that manual verify no longer throws "predmeta is not defined" error.
 * 
 * Usage:
 *   node scripts/debug/smoke_test_manual_verify.mjs <url>
 * 
 * Example:
 *   node scripts/debug/smoke_test_manual_verify.mjs https://finishline-wps-ai.vercel.app
 */

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.error("[smoke_test] Error: URL required");
  console.error("[smoke_test] Usage: node scripts/debug/smoke_test_manual_verify.mjs <url>");
  process.exit(1);
}

const API_URL = `${TARGET_URL}/api/verify_race`;

async function smokeTest() {
  console.log(`[smoke_test] Testing manual verify on: ${TARGET_URL}\n`);
  
  const testPayload = {
    mode: "manual",
    track: "Meadowlands",
    date: "2026-01-11",
    raceNo: "7",
    outcome: {
      win: "Smoke Test Winner",
      place: "Smoke Test Place",
      show: "Smoke Test Show"
    }
  };
  
  console.log("[smoke_test] Request payload:");
  console.log(JSON.stringify(testPayload, null, 2));
  console.log("\n[smoke_test] Sending request...\n");
  
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
      console.error(`[smoke_test] ❌ FAILED: Response is not valid JSON`);
      console.error(`[smoke_test] HTTP Status: ${response.status}`);
      console.error(`[smoke_test] Response body (first 500 chars):`);
      console.error(responseText.slice(0, 500));
      process.exit(1);
    }
    
    console.log("[smoke_test] Response JSON:");
    console.log(JSON.stringify(responseJson, null, 2));
    console.log("\n[smoke_test] Analysis:\n");
    
    // Check for ReferenceError
    if (responseJson.summary && responseJson.summary.includes("predmeta is not defined")) {
      console.error(`[smoke_test] ❌ FAILED: Response summary contains "predmeta is not defined"`);
      console.error(`[smoke_test] Summary: ${responseJson.summary}`);
      process.exit(1);
    }
    
    if (responseJson.debug && responseJson.debug.error && responseJson.debug.error.includes("predmeta is not defined")) {
      console.error(`[smoke_test] ❌ FAILED: Debug.error contains "predmeta is not defined"`);
      console.error(`[smoke_test] Debug.error: ${responseJson.debug.error}`);
      process.exit(1);
    }
    
    if (responseJson.error && responseJson.error.includes("predmeta is not defined")) {
      console.error(`[smoke_test] ❌ FAILED: Error field contains "predmeta is not defined"`);
      console.error(`[smoke_test] Error: ${responseJson.error}`);
      process.exit(1);
    }
    
    // Check HTTP status
    if (response.status !== 200) {
      console.error(`[smoke_test] ❌ FAILED: HTTP status ${response.status} (expected 200)`);
      process.exit(1);
    }
    console.log(`[smoke_test] ✅ HTTP Status: ${response.status} (OK)`);
    
    // Check for success
    if (responseJson.ok === true) {
      console.log(`[smoke_test] ✅ ok: true (Manual verify succeeded)`);
    } else if (responseJson.ok === false) {
      console.warn(`[smoke_test] ⚠️  ok: false (Manual verify failed, but no ReferenceError)`);
      console.warn(`[smoke_test] Step: ${responseJson.step}`);
      console.warn(`[smoke_test] Summary: ${responseJson.summary}`);
      // This is not a failure - manual verify can fail for valid reasons
      // The key is that it didn't throw ReferenceError
    } else {
      console.warn(`[smoke_test] ⚠️  ok field missing or invalid: ${responseJson.ok}`);
    }
    
    // Check step
    if (responseJson.step === "manual_verify") {
      console.log(`[smoke_test] ✅ step: "manual_verify" (correct)`);
    } else {
      console.warn(`[smoke_test] ⚠️  step: "${responseJson.step}" (expected "manual_verify")`);
    }
    
    // Check for ReferenceError in any field
    const responseStr = JSON.stringify(responseJson);
    if (responseStr.includes("predmeta is not defined")) {
      console.error(`[smoke_test] ❌ FAILED: Response contains "predmeta is not defined" somewhere`);
      process.exit(1);
    }
    
    console.log(`[smoke_test] ✅ No "predmeta is not defined" error found in response`);
    console.log(`\n[smoke_test] ✅ PASSED: Manual verify fix is working correctly`);
    console.log(`[smoke_test] Next: Verify key should exist in Upstash for raceId: meadowlands-2026-01-11-unknown-r7`);
    
  } catch (err) {
    console.error(`[smoke_test] ❌ FAILED: Network or parsing error: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

smokeTest().catch(err => {
  console.error("[smoke_test] ❌ FATAL ERROR:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
