#!/usr/bin/env node
/**
 * scripts/debug/repro_manual_verify_ui_payload.mjs
 * 
 * Reproduce manual verify using the EXACT payload structure the UI sends.
 * This helps debug payload-dependent issues (e.g., predmeta ReferenceError).
 * 
 * Usage:
 *   node scripts/debug/repro_manual_verify_ui_payload.mjs <url>
 * 
 * Example:
 *   node scripts/debug/repro_manual_verify_ui_payload.mjs https://finishline-wps-ai-git-chore-preview-smoke-man-d7dd3ae-hired-hive.vercel.app
 */

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.error("[repro_ui] Error: URL required");
  console.error("[repro_ui] Usage: node scripts/debug/repro_manual_verify_ui_payload.mjs <url>");
  process.exit(1);
}

const API_URL = `${TARGET_URL}/api/verify_race`;

async function reproTest() {
  console.log(`[repro_ui] Reproducing UI manual verify payload on: ${TARGET_URL}\n`);
  
  // Match EXACT UI payload structure (from public/js/verify-modal.js lines 1518-1531)
  const todayIso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  
  const testPayload = {
    track: "Parx Racing",
    raceNo: "3",
    dateIso: todayIso, // UI sends canonicalDate || todayIso
    dateRaw: todayIso, // UI sends uiDateRaw || todayIso
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
  
  console.log("[repro_ui] Request payload (matching UI structure):");
  console.log(JSON.stringify(testPayload, null, 2));
  console.log("\n[repro_ui] Sending request...\n");
  
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
      console.error(`[repro_ui] ❌ FAILED: Response is not valid JSON`);
      console.error(`[repro_ui] HTTP Status: ${response.status}`);
      console.error(`[repro_ui] Response body (first 500 chars):`);
      console.error(responseText.slice(0, 500));
      process.exit(1);
    }
    
    console.log("[repro_ui] Response JSON:");
    console.log(JSON.stringify(responseJson, null, 2));
    console.log("\n[repro_ui] Analysis:\n");
    
    // Check for ReferenceError (fail immediately if found anywhere in response)
    const responseStr = JSON.stringify(responseJson);
    if (responseStr.includes("predmeta is not defined")) {
      console.error(`[repro_ui] ❌ FAILED: Response contains "predmeta is not defined"`);
      if (responseJson.summary && responseJson.summary.includes("predmeta is not defined")) {
        console.error(`[repro_ui] Summary: ${responseJson.summary}`);
      }
      if (responseJson.debug?.error && responseJson.debug.error.includes("predmeta is not defined")) {
        console.error(`[repro_ui] Debug.error: ${responseJson.debug.error}`);
      }
      if (responseJson.error && responseJson.error.includes("predmeta is not defined")) {
        console.error(`[repro_ui] Error: ${responseJson.error}`);
      }
      process.exit(1);
    }
    
    // Check HTTP status
    if (response.status !== 200) {
      console.error(`[repro_ui] ❌ FAILED: HTTP status ${response.status} (expected 200)`);
      process.exit(1);
    }
    console.log(`[repro_ui] ✅ HTTP Status: ${response.status} (OK)`);
    
    // Check responseMeta fields (deployment proof)
    if (responseJson.responseMeta) {
      console.log(`[repro_ui] ✅ responseMeta present`);
      if (responseJson.responseMeta.vercelCommit || responseJson.responseMeta.vercelGitCommitSha) {
        const commit = responseJson.responseMeta.vercelCommit || responseJson.responseMeta.vercelGitCommitSha;
        console.log(`[repro_ui] ✅ responseMeta.vercelCommit/vercelGitCommitSha: ${commit}`);
      } else {
        console.warn(`[repro_ui] ⚠️  responseMeta.vercelCommit and vercelGitCommitSha missing`);
      }
      if (responseJson.responseMeta.buildStamp) {
        console.log(`[repro_ui] ✅ responseMeta.buildStamp: ${responseJson.responseMeta.buildStamp}`);
      } else {
        console.warn(`[repro_ui] ⚠️  responseMeta.buildStamp missing`);
      }
      if (responseJson.responseMeta.vercelEnv !== undefined) {
        console.log(`[repro_ui] ✅ responseMeta.vercelEnv: ${responseJson.responseMeta.vercelEnv}`);
      } else {
        console.warn(`[repro_ui] ⚠️  responseMeta.vercelEnv missing`);
      }
      if (responseJson.responseMeta.nodeEnv !== undefined) {
        console.log(`[repro_ui] ✅ responseMeta.nodeEnv: ${responseJson.responseMeta.nodeEnv}`);
      } else {
        console.warn(`[repro_ui] ⚠️  responseMeta.nodeEnv missing`);
      }
    } else {
      console.warn(`[repro_ui] ⚠️  responseMeta missing`);
    }
    
    // Check debug fields (error diagnostics)
    if (responseJson.debug) {
      if (responseJson.debug.name) {
        console.log(`[repro_ui] Debug.error.name: ${responseJson.debug.name}`);
      }
      if (responseJson.debug.stack) {
        console.log(`[repro_ui] Debug.error.stack (first 500 chars):`);
        console.log(responseJson.debug.stack.slice(0, 500));
      }
    }
    
    // Check for success
    if (responseJson.ok === true) {
      console.log(`[repro_ui] ✅ ok: true (Manual verify succeeded)`);
    } else if (responseJson.ok === false) {
      console.warn(`[repro_ui] ⚠️  ok: false (Manual verify failed, but no ReferenceError)`);
      console.warn(`[repro_ui] Step: ${responseJson.step}`);
      console.warn(`[repro_ui] Summary: ${responseJson.summary}`);
      console.warn(`[repro_ui] Debug.error: ${responseJson.debug?.error || '(none)'}`);
      // This is not a failure - manual verify can fail for valid reasons
      // The key is that it didn't throw ReferenceError
    } else {
      console.warn(`[repro_ui] ⚠️  ok field missing or invalid: ${responseJson.ok}`);
    }
    
    // Check step
    if (responseJson.step === "manual_verify") {
      console.log(`[repro_ui] ✅ step: "manual_verify" (correct)`);
    } else {
      console.warn(`[repro_ui] ⚠️  step: "${responseJson.step}" (expected "manual_verify")`);
    }
    
    console.log(`[repro_ui] ✅ No "predmeta is not defined" error found in response`);
    console.log(`\n[repro_ui] ✅ PASSED: Manual verify fix is working correctly`);
    if (responseJson.responseMeta?.vercelCommit || responseJson.responseMeta?.vercelGitCommitSha) {
      const commit = responseJson.responseMeta.vercelCommit || responseJson.responseMeta.vercelGitCommitSha;
      console.log(`[repro_ui] Deployment commit: ${commit}`);
    }
    
  } catch (err) {
    console.error(`[repro_ui] ❌ FAILED: Network or parsing error: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

reproTest().catch(err => {
  console.error("[repro_ui] ❌ FATAL ERROR:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
