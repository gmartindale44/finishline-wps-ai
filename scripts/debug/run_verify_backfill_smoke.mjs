#!/usr/bin/env node
/**
 * Smoke test for /api/verify_backfill endpoint
 * Tests that the backfill endpoint works correctly
 */

const BASE = process.env.FINISHLINE_VERIFY_BASE_URL || "https://finishline-wps-ai.vercel.app";

async function testBackfill() {
  const url = `${BASE}/api/verify_backfill`;
  
  // Test with a single race: Turf Paradise R5 2025-12-02
  const payload = {
    track: "Turf Paradise",
    date: "2025-12-02",
    raceNo: "5",
    maxRaces: 1,
    dryRun: true,
  };
  
  console.log("\n==============================");
  console.log("Testing /api/verify_backfill");
  console.log("URL:", url);
  console.log("Payload:", JSON.stringify(payload, null, 2));
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    const txt = await res.text();
    console.log("HTTP Status:", res.status);
    
    let json;
    try {
      json = JSON.parse(txt);
    } catch (e) {
      console.error("❌ Not JSON:", e.message);
      console.error("Raw response:", txt.substring(0, 500));
      process.exit(1);
    }
    
    console.log("\nResponse:");
    console.log("  ok:", json.ok);
    console.log("  step:", json.step);
    console.log("  mode:", json.mode);
    console.log("  count:", json.count);
    console.log("  successes:", json.successes);
    console.log("  failures:", json.failures);
    console.log("  skipped:", json.skipped || 0);
    console.log("  processed:", json.processed || json.count);
    
    if (json.summary) {
      console.log("  summary:", json.summary);
    }
    
    if (json.sample) {
      console.log("\nSample result:");
      console.log("  track:", json.sample.track);
      console.log("  date:", json.sample.date);
      console.log("  raceNo:", json.sample.raceNo);
      console.log("  ok:", json.sample.ok);
      console.log("  step:", json.sample.step);
      console.log("  outcome:", json.sample.outcome);
    }
    
    if (json.error) {
      console.error("  error:", json.error);
    }
    
    if (json.ok && json.count > 0) {
      console.log("\n✅ SUCCESS: Backfill endpoint working");
    } else {
      console.log("\n⚠️  WARNING: Backfill returned ok=false or count=0");
      process.exit(1);
    }
    
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

async function testDefaultRaces() {
  const url = `${BASE}/api/verify_backfill`;
  
  console.log("\n==============================");
  console.log("Testing /api/verify_backfill with default races (no filters)");
  console.log("URL:", url);
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    
    const txt = await res.text();
    const json = JSON.parse(txt);
    
    console.log("HTTP Status:", res.status);
    console.log("ok:", json.ok);
    console.log("count:", json.count);
    console.log("successes:", json.successes);
    console.log("failures:", json.failures);
    console.log("summary:", json.summary);
    
    if (json.ok && json.count >= 4) {
      console.log("\n✅ SUCCESS: Default races test passed");
    } else {
      console.log("\n⚠️  WARNING: Default races test had issues");
    }
    
  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
}

async function main() {
  console.log("[run_verify_backfill_smoke] Testing /api/verify_backfill endpoint");
  console.log("Base URL:", BASE);
  
  await testBackfill();
  await testDefaultRaces();
  
  console.log("\n🎉 Smoke test finished\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

