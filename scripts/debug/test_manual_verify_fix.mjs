#!/usr/bin/env node
/**
 * scripts/debug/test_manual_verify_fix.mjs
 * 
 * Regression test for manual verify predmeta ReferenceError fix.
 * Tests that manual verify no longer throws "predmeta is not defined" error.
 * 
 * Usage:
 *   node scripts/debug/test_manual_verify_fix.mjs [preview-url]
 * 
 * If preview-url is provided, tests against deployed preview endpoint.
 * Otherwise, tests by checking code (no runtime test).
 */

const PREVIEW_URL = process.argv[2] || null;

async function testManualVerifyFix() {
  console.log("[test_manual_verify] Testing manual verify predmeta fix...\n");
  
  // Test payload that previously triggered "predmeta is not defined" error
  const testPayload = {
    mode: "manual",
    track: "Meadowlands",
    date: "2026-01-11",
    raceNo: "7",
    outcome: {
      win: "Test Winner",
      place: "Test Place",
      show: "Test Show"
    }
  };
  
  if (PREVIEW_URL) {
    // Test against deployed preview endpoint
    console.log(`[test_manual_verify] Testing against preview URL: ${PREVIEW_URL}`);
    
    try {
      const response = await fetch(`${PREVIEW_URL}/api/verify_race`, {
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
      } catch {
        console.error(`[test_manual_verify] ❌ Failed to parse response as JSON`);
        console.error(`[test_manual_verify] Response status: ${response.status}`);
        console.error(`[test_manual_verify] Response body: ${responseText.slice(0, 500)}`);
        process.exit(1);
      }
      
      // Check for ReferenceError
      if (responseJson.summary && responseJson.summary.includes("predmeta is not defined")) {
        console.error(`[test_manual_verify] ❌ FAILED: Response contains "predmeta is not defined"`);
        console.error(`[test_manual_verify] Summary: ${responseJson.summary}`);
        console.error(`[test_manual_verify] Error: ${responseJson.error}`);
        process.exit(1);
      }
      
      if (responseJson.debug && responseJson.debug.error && responseJson.debug.error.includes("predmeta is not defined")) {
        console.error(`[test_manual_verify] ❌ FAILED: Debug.error contains "predmeta is not defined"`);
        console.error(`[test_manual_verify] Debug.error: ${responseJson.debug.error}`);
        process.exit(1);
      }
      
      // Check for success
      if (response.status === 200 && responseJson.ok === true) {
        console.log(`[test_manual_verify] ✅ PASSED: Manual verify succeeded (ok: true)`);
        console.log(`[test_manual_verify] Step: ${responseJson.step}`);
        console.log(`[test_manual_verify] Summary: ${responseJson.summary}`);
        return;
      }
      
      if (response.status !== 200) {
        console.error(`[test_manual_verify] ❌ FAILED: Response status ${response.status} (expected 200)`);
        console.error(`[test_manual_verify] Response: ${JSON.stringify(responseJson, null, 2)}`);
        process.exit(1);
      }
      
      if (responseJson.ok !== true) {
        console.warn(`[test_manual_verify] ⚠️  WARNING: Manual verify returned ok: false`);
        console.warn(`[test_manual_verify] Step: ${responseJson.step}`);
        console.warn(`[test_manual_verify] Summary: ${responseJson.summary}`);
        // This is not a failure - manual verify can fail for valid reasons
        // The key is that it didn't throw ReferenceError
        console.log(`[test_manual_verify] ✅ PASSED: No ReferenceError (ok: false is acceptable)`);
        return;
      }
      
    } catch (err) {
      console.error(`[test_manual_verify] ❌ FAILED: Network or parsing error: ${err.message}`);
      if (err.stack) console.error(err.stack);
      process.exit(1);
    }
  } else {
    // Code-based test (check that predmeta is initialized)
    console.log("[test_manual_verify] Code-based test: Checking that predmeta is initialized in manual verify branch");
    
    const fs = await import('fs');
    const verifyRaceCode = fs.readFileSync('pages/api/verify_race.js', 'utf8');
    
    // Check for manual verify branch
    const manualVerifyMatch = verifyRaceCode.match(/\/\/ Manual verify branch[\s\S]{0,500}/);
    if (!manualVerifyMatch) {
      console.error("[test_manual_verify] ❌ FAILED: Could not find manual verify branch in code");
      process.exit(1);
    }
    
    const manualVerifyCode = manualVerifyMatch[0];
    
    // Check that predmeta is initialized (const predmeta = null; or let predmeta = null;)
    if (!/const\s+predmeta\s*=\s*null\s*;|let\s+predmeta\s*=\s*null\s*;/.test(manualVerifyCode)) {
      console.error("[test_manual_verify] ❌ FAILED: predmeta is not initialized in manual verify branch");
      console.error("[test_manual_verify] Expected: 'const predmeta = null;' or 'let predmeta = null;' in manual verify branch");
      process.exit(1);
    }
    
    // Check that predmeta is used with guard (if (predmeta && ...))
    if (!/if\s*\(\s*predmeta\s*&&/.test(manualVerifyCode)) {
      console.warn("[test_manual_verify] ⚠️  WARNING: predmeta usage may not be guarded (but initialization prevents ReferenceError)");
    }
    
    console.log("[test_manual_verify] ✅ PASSED: predmeta is initialized in manual verify branch");
    console.log("[test_manual_verify] Code check: predmeta is defined before use (prevents ReferenceError)");
  }
}

testManualVerifyFix().catch(err => {
  console.error("[test_manual_verify] ❌ FATAL ERROR:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
