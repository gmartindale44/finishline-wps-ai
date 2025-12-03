#!/usr/bin/env node
/**
 * QA script for /api/verify_race endpoint
 * Tests canonical races to ensure verify functionality works correctly
 */

const FINISHLINE_VERIFY_BASE_URL = process.env.FINISHLINE_VERIFY_BASE_URL || "https://finishline-wps-ai.vercel.app";

const TEST_CASES = [
  { track: "Laurel Park", raceNo: "1", date: "2025-11-30" },
  { track: "Parx Racing", raceNo: "3", date: "2025-12-01" },
  { track: "Turf Paradise", raceNo: "2", date: "2025-12-02" },
  { track: "Zia Park", raceNo: "2", date: "2025-12-02" },
];

async function testVerifyRace(track, raceNo, date) {
  const url = `${FINISHLINE_VERIFY_BASE_URL}/api/verify_race`;
  const dateRaw = date.replace(/-/g, "/");
  
  const payload = {
    track,
    raceNo,
    date,
    dateIso: date,
    dateRaw,
  };
  
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`${track} — Race ${raceNo} — ${date}`);
    console.log(`URL: ${url}`);
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    console.log(`HTTP Status: ${response.status}`);
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ HTTP Error: ${response.status}`);
      console.error(`Response: ${text.substring(0, 500)}`);
      return false;
    }
    
    const result = await response.json();
    
    console.log(`ok: ${result.ok}`);
    console.log(`step: ${result.step || "(missing)"}`);
    
    if (result.outcome) {
      console.log(`outcome:`);
      console.log(`  Win: ${result.outcome.win || "-"}`);
      console.log(`  Place: ${result.outcome.place || "-"}`);
      console.log(`  Show: ${result.outcome.show || "-"}`);
    } else {
      console.log(`outcome: (missing)`);
    }
    
    if (result.hits) {
      console.log(`hits:`);
      console.log(`  winHit: ${result.hits.winHit || false}`);
      console.log(`  placeHit: ${result.hits.placeHit || false}`);
      console.log(`  showHit: ${result.hits.showHit || false}`);
      console.log(`  top3Hit: ${result.hits.top3Hit || false}`);
    } else {
      console.log(`hits: (missing)`);
    }
    
    // Check if this is a successful verify
    const isSuccess = result.ok === true && result.step && 
      (result.step === "verify_race" || 
       result.step === "verify_race_fallback_hrn" || 
       result.step === "verify_race_fallback_equibase");
    
    if (isSuccess) {
      console.log(`✅ SUCCESS`);
    } else {
      console.log(`⚠️  WARNING: ok=${result.ok}, step=${result.step}`);
      if (result.debug && result.debug.hrnParseError) {
        console.log(`   HRN Parse Error: ${result.debug.hrnParseError}`);
      }
    }
    
    return isSuccess;
    
  } catch (err) {
    console.error(`❌ ERROR: ${err.message}`);
    console.error(err.stack);
    return false;
  }
}

async function main() {
  console.log(`[qa_verify_races] Testing /api/verify_race endpoint`);
  console.log(`Base URL: ${FINISHLINE_VERIFY_BASE_URL}`);
  console.log(`Test cases: ${TEST_CASES.length}`);
  
  const results = [];
  
  for (const testCase of TEST_CASES) {
    const success = await testVerifyRace(
      testCase.track,
      testCase.raceNo,
      testCase.date
    );
    results.push({ ...testCase, success });
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Summary:`);
  const passed = results.filter(r => r.success).length;
  const total = results.length;
  console.log(`Passed: ${passed}/${total}`);
  
  results.forEach(r => {
    const status = r.success ? "✅" : "❌";
    console.log(`  ${status} ${r.track} R${r.raceNo} ${r.date}`);
  });
  
  if (passed < total) {
    console.error(`\n❌ Some tests failed`);
    process.exit(1);
  } else {
    console.log(`\n✅ All tests passed`);
  }
}

main().catch(err => {
  console.error(`Fatal error:`, err);
  process.exit(1);
});

