#!/usr/bin/env node
/**
 * scripts/debug/test_manual_verify_no_predmeta_error.mjs
 * 
 * Regression test to ensure manual verify never returns "predmeta is not defined" error.
 * 
 * Usage:
 *   node scripts/debug/test_manual_verify_no_predmeta_error.mjs <url>
 * 
 * Exit codes:
 *   0: All checks passed (no predmeta ReferenceError found)
 *   1: predmeta ReferenceError detected or other failure
 */

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.error("[regression_test] Error: URL required");
  console.error("[regression_test] Usage: node scripts/debug/test_manual_verify_no_predmeta_error.mjs <url>");
  process.exit(1);
}

const API_URL = `${TARGET_URL}/api/verify_race`;

async function regressionTest() {
  console.log(`[regression_test] Testing manual verify for predmeta ReferenceError on: ${TARGET_URL}\n`);
  
  const todayIso = new Date().toISOString().slice(0, 10);
  
  const testPayload = {
    track: "Parx Racing",
    raceNo: "3",
    dateIso: todayIso,
    dateRaw: todayIso,
    mode: "manual",
    outcome: {
      win: "Test Winner",
      place: "Test Place",
      show: "Test Show"
    },
    predicted: {
      win: "",
      place: "",
      show: ""
    },
    provider: "TwinSpires"
  };
  
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
      console.error(`[regression_test] ❌ FAILED: Response is not valid JSON`);
      console.error(`[regression_test] HTTP Status: ${response.status}`);
      process.exit(1);
    }
    
    // Check 1: HTTP status must be 200
    if (response.status !== 200) {
      console.error(`[regression_test] ❌ FAILED: HTTP status ${response.status} (expected 200)`);
      process.exit(1);
    }
    console.log(`[regression_test] ✅ HTTP Status: ${response.status}`);
    
    // Check 2: ok must be boolean
    if (typeof responseJson.ok !== 'boolean') {
      console.error(`[regression_test] ❌ FAILED: ok is not boolean (type: ${typeof responseJson.ok}, value: ${JSON.stringify(responseJson.ok)})`);
      process.exit(1);
    }
    console.log(`[regression_test] ✅ ok is boolean: ${responseJson.ok}`);
    
    // Check 3: responseMeta.buildStamp must exist
    if (!responseJson.responseMeta || !responseJson.responseMeta.buildStamp) {
      console.error(`[regression_test] ❌ FAILED: responseMeta.buildStamp missing`);
      console.error(`[regression_test] responseMeta:`, JSON.stringify(responseJson.responseMeta, null, 2));
      process.exit(1);
    }
    console.log(`[regression_test] ✅ responseMeta.buildStamp: ${responseJson.responseMeta.buildStamp}`);
    
    // Check 4: NO "predmeta is not defined" anywhere in response
    const responseStr = JSON.stringify(responseJson);
    if (responseStr.includes("predmeta is not defined")) {
      console.error(`[regression_test] ❌ FAILED: Response contains "predmeta is not defined"`);
      console.error(`[regression_test] Error details:`);
      if (responseJson.debug?.error) {
        console.error(`[regression_test]   debug.error: ${responseJson.debug.error}`);
      }
      if (responseJson.debug?.name) {
        console.error(`[regression_test]   debug.name: ${responseJson.debug.name}`);
      }
      if (responseJson.debug?.stack) {
        console.error(`[regression_test]   debug.stack (first 500 chars):`);
        console.error(responseJson.debug.stack.slice(0, 500));
      }
      if (responseJson.error) {
        console.error(`[regression_test]   error: ${responseJson.error}`);
      }
      if (responseJson.message) {
        console.error(`[regression_test]   message: ${responseJson.message}`);
      }
      process.exit(1);
    }
    console.log(`[regression_test] ✅ No "predmeta is not defined" error found`);
    
    // Check 5: If ok is false, check that error details are present (for debugging)
    if (responseJson.ok === false) {
      console.warn(`[regression_test] ⚠️  ok: false (manual verify failed, but no predmeta ReferenceError)`);
      if (responseJson.debug?.error) {
        console.warn(`[regression_test]   debug.error: ${responseJson.debug.error}`);
      }
      if (responseJson.debug?.name) {
        console.warn(`[regression_test]   debug.name: ${responseJson.debug.name}`);
      }
      // This is not a failure - manual verify can fail for valid reasons
      // The key is that it didn't throw predmeta ReferenceError
    }
    
    console.log(`\n[regression_test] ✅ PASSED: No predmeta ReferenceError detected`);
    if (responseJson.responseMeta?.buildStamp) {
      console.log(`[regression_test] Deployment: ${responseJson.responseMeta.buildStamp}`);
    }
    
  } catch (err) {
    console.error(`[regression_test] ❌ FAILED: Network or parsing error: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

regressionTest().catch(err => {
  console.error("[regression_test] ❌ FATAL ERROR:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
