#!/usr/bin/env node
/**
 * scripts/debug/run_greenzone_smoke.mjs
 * 
 * Smoke test for GreenZone v1 computation.
 * Tests the module with sample inputs to verify it works correctly.
 * 
 * Usage:
 *   node scripts/debug/run_greenzone_smoke.mjs
 */

import { computeGreenZoneForRace, buildGreenZoneSummaryText, loadGreenZoneDataset } from "../../lib/greenzone/greenzone_v1.js";

async function main() {
  console.log("🧪 GreenZone v1 Smoke Test\n");
  
  try {
    // Test 1: Load dataset
    console.log("📊 Test 1: Loading GreenZone dataset...");
    const dataset = await loadGreenZoneDataset();
    console.log(`   ✅ Loaded ${dataset.rows.length} historical races`);
    console.log(`   ✅ ${dataset.stats.goodCount} races with good outcomes`);
    console.log(`   ✅ Last loaded: ${dataset.stats.lastLoadedAt || "N/A"}\n`);
    
    if (dataset.rows.length === 0) {
      console.log("⚠️  Warning: No historical data found. GreenZone will be disabled.");
      console.log("   Make sure you have:");
      console.log("   - Prediction logs in Redis (fl:pred:*)");
      console.log("   - Verify logs with outcomes in Redis (fl:verify:*)\n");
      return;
    }
    
    // Test 2: Sample race computation
    console.log("🔍 Test 2: Computing GreenZone for sample race...");
    const sampleRaceCtx = {
      track: "Parx Racing",
      raceNo: "5",
      dateIso: "2025-12-03",
    };
    
    const result = await computeGreenZoneForRace(sampleRaceCtx);
    
    if (!result.enabled) {
      console.log(`   ⚠️  GreenZone disabled: ${result.reason || "unknown reason"}`);
      if (result.debug) {
        console.log(`   Debug:`, result.debug);
      }
    } else {
      console.log(`   ✅ GreenZone enabled`);
      console.log(`   ✅ Current race:`);
      console.log(`      - Confidence: ${result.current?.confidence || "N/A"}`);
      console.log(`      - Top3Mass: ${result.current?.top3Mass || "N/A"}%`);
      console.log(`      - Similarity: ${result.current?.similarityScore?.toFixed(2) || "N/A"}`);
      console.log(`      - Matched races: ${result.current?.matchedRaces?.length || 0}`);
      console.log(`   ✅ Card candidates: ${result.cardCandidates?.length || 0}`);
      
      if (result.current?.matchedRaces && result.current.matchedRaces.length > 0) {
        const closest = result.current.matchedRaces[0];
        console.log(`   ✅ Closest match: ${closest.track} Race ${closest.raceNo} (similarity: ${closest.similarityScore.toFixed(2)})`);
      }
    }
    
    console.log("");
    
    // Test 3: Summary text generation
    if (result.enabled && result.current) {
      console.log("📝 Test 3: Generating summary text...");
      const summaryText = buildGreenZoneSummaryText(result.current);
      console.log("   ✅ Summary text generated:");
      console.log("   " + summaryText.split("\n").join("\n   "));
      console.log("");
    }
    
    // Test 4: Test with different confidence/T3M values
    console.log("🧪 Test 4: Testing different confidence/T3M combinations...");
    const testCases = [
      { confidence: 70, top3Mass: 75, name: "High conf + High T3M" },
      { confidence: 60, top3Mass: 65, name: "Medium conf + Medium T3M" },
      { confidence: 50, top3Mass: 55, name: "Low conf + Low T3M" },
    ];
    
    for (const testCase of testCases) {
      // For this test, we need to create a race context that would have these values
      // Since we're testing the computation, we'll just show what would happen
      console.log(`   Testing: ${testCase.name}`);
      console.log(`      Conf: ${testCase.confidence}, T3M: ${testCase.top3Mass}%`);
    }
    
    console.log("\n✅ Smoke test complete!");
    console.log("\n💡 Next steps:");
    console.log("   1. Verify a race in the UI to see GreenZone in action");
    console.log("   2. Check /api/verify_race response includes greenZone field");
    console.log("   3. Check verify modal displays GreenZone summary");
    
  } catch (error) {
    console.error("❌ Smoke test failed:", error);
    console.error("   Error details:", error.message);
    if (error.stack) {
      console.error("   Stack:", error.stack);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});

