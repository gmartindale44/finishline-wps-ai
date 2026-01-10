#!/usr/bin/env node
/**
 * Redis/Verify End-to-End Smoke Test
 * 
 * Tests predsnap writing, verify logging, and verify_backfill skip logic
 * Compares Redis fingerprints across endpoints to detect instance mismatches
 * 
 * Usage: node scripts/smoke_redis_verify.mjs <deployment-url>
 * Example: node scripts/smoke_redis_verify.mjs https://finishline-wps-ai-xxx.vercel.app
 */

import fetch from 'node-fetch';

const BASE_URL = process.argv[2] || 'http://localhost:3000';

const TEST_RACE = {
  track: "Fair Grounds",
  date: "2026-01-10",
  raceNo: "1",
  surface: "dirt",
  distance_input: "6f",
  horses: [
    { name: "Test Horse A", odds: "2/1", post: 1 },
    { name: "Test Horse B", odds: "3/1", post: 2 },
    { name: "Test Horse C", odds: "4/1", post: 3 },
  ]
};

async function fetchJSON(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const json = await res.json();
    return { status: res.status, json, error: null };
  } catch (error) {
    return { status: 0, json: null, error: error.message || String(error) };
  }
}

async function testPredictWps() {
  console.log('\n=== TEST 1: /api/predict_wps ===');
  const url = `${BASE_URL}/api/predict_wps`;
  console.log(`POST ${url}`);
  
  const { status, json, error } = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_RACE),
  });

  if (error) {
    console.error(`❌ Network error: ${error}`);
    return null;
  }

  console.log(`HTTP ${status}`);
  console.log(`OK: ${json?.ok}`);
  
  if (json?.predsnap_debug) {
    const pd = json.predsnap_debug;
    console.log('\nPredSnap Debug:');
    console.log(`  predsnapAttempted: ${pd.predsnapAttempted}`);
    console.log(`  predsnapWritten: ${pd.predsnapWritten}`);
    console.log(`  predsnapKey: ${pd.predsnapKey || 'null'}`);
    console.log(`  predsnapSkipReason: ${pd.predsnapSkipReason || 'null'}`);
    console.log(`  predsnapError: ${pd.predsnapError || 'null'}`);
    console.log(`  allowAny: ${pd.allowAny}`);
    console.log(`  confidenceHigh: ${pd.confidenceHigh}`);
    console.log(`  confidenceValue: ${pd.confidenceValue || 'null'}`);
    console.log(`  raceIdPresent: ${pd.raceIdPresent}`);
    console.log(`  forceOverride: ${pd.forceOverride || false}`);
    
    if (pd.redisFingerprint) {
      console.log(`  redisFingerprint:`);
      console.log(`    vercelEnv: ${pd.redisFingerprint.vercelEnv || 'null'}`);
      console.log(`    vercelGitCommitSha: ${pd.redisFingerprint.vercelGitCommitSha || 'null'}`);
      console.log(`    urlFingerprint: ${pd.redisFingerprint.urlFingerprint || 'null'}`);
      console.log(`    tokenFingerprint: ${pd.redisFingerprint.tokenFingerprint || 'null'}`);
    }
    console.log(`  redisClientType: ${pd.redisClientType || 'N/A'}`);
    
    if (pd.predsnapWritten) {
      console.log(`\n✅ Predsnap written: ${pd.predsnapKey}`);
    } else {
      console.log(`\n⚠️ Predsnap NOT written. Reason: ${pd.predsnapSkipReason}`);
    }
  } else {
    console.log('⚠️ No predsnap_debug field in response');
  }

  return json;
}

async function testVerifyRace(track = TEST_RACE.track, date = TEST_RACE.date, raceNo = TEST_RACE.raceNo) {
  console.log(`\n=== TEST 2: /api/verify_race (${track} ${date} R${raceNo}) ===`);
  const url = `${BASE_URL}/api/verify_race`;
  console.log(`POST ${url}`);
  
  const { status, json, error } = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track,
      date,
      raceNo,
      // No outcome provided - let it fetch from HRN
    }),
  });

  if (error) {
    console.error(`❌ Network error: ${error}`);
    return null;
  }

  console.log(`HTTP ${status}`);
  console.log(`OK: ${json?.ok}`);
  console.log(`Step: ${json?.step || 'N/A'}`);
  console.log(`Source: ${json?.debug?.source || 'N/A'}`);
  
  if (json?.outcome) {
    console.log('\nOutcome:');
    console.log(`  Win: ${json.outcome.win || '(empty)'}`);
    console.log(`  Place: ${json.outcome.place || '(empty)'}`);
    console.log(`  Show: ${json.outcome.show || '(empty)'}`);
  }
  
  if (json?.debug) {
    console.log('\nVerify Log Debug:');
    console.log(`  verifyLogKey: ${json.debug.verifyLogKey || 'N/A'}`);
    console.log(`  raceId: ${json.debug.raceId || 'N/A'}`);
    console.log(`  verifyWriteOk: ${json.debug.verifyWriteOk !== undefined ? json.debug.verifyWriteOk : 'N/A'}`);
    console.log(`  verifyWriteError: ${json.debug.verifyWriteError || 'null'}`);
    
    // HRN-specific debug fields
    if (json.debug.hrnParsedBy) {
      console.log(`\nHRN Parsing Debug:`);
      console.log(`  hrnParsedBy: ${json.debug.hrnParsedBy}`);
      if (json.debug.hrnFoundMarkers) {
        console.log(`  hrnFoundMarkers:`, json.debug.hrnFoundMarkers);
      }
      if (json.debug.hrnOutcomeRaw) {
        console.log(`  hrnOutcomeRaw:`, json.debug.hrnOutcomeRaw);
      }
      if (json.debug.hrnOutcomeNormalized) {
        console.log(`  hrnOutcomeNormalized:`, json.debug.hrnOutcomeNormalized);
      }
    }
    if (json.debug.hrnParseError) {
      console.log(`  hrnParseError: ${json.debug.hrnParseError}`);
    }
    if (json.debug.hrnUrl) {
      console.log(`  hrnUrl: ${json.debug.hrnUrl}`);
    }
    
    if (json.debug.redisFingerprint) {
      const rf = json.debug.redisFingerprint;
      console.log(`  redisFingerprint:`);
      console.log(`    vercelEnv: ${rf.vercelEnv || 'null'}`);
      console.log(`    vercelGitCommitSha: ${rf.vercelGitCommitSha || 'null'}`);
      console.log(`    urlFingerprint: ${rf.urlFingerprint || 'null'}`);
      console.log(`    tokenFingerprint: ${rf.tokenFingerprint || 'null'}`);
    }
    console.log(`  redisClientType: ${json.debug.redisClientType || 'N/A'}`);
    
    if (json.debug.verifyWriteOk) {
      console.log(`\n✅ Verify log written: ${json.debug.verifyLogKey}`);
    } else {
      console.log(`\n⚠️ Verify log NOT written. Error: ${json.debug.verifyWriteError}`);
    }
  }

  return json;
}

async function testVerifyBackfill() {
  console.log('\n=== TEST 3: /api/verify_backfill ===');
  const url = `${BASE_URL}/api/verify_backfill`;
  console.log(`POST ${url}`);
  
  const { status, json, error } = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ races: [TEST_RACE] }),
  });

  if (error) {
    console.error(`❌ Network error: ${error}`);
    return null;
  }

  console.log(`HTTP ${status}`);
  console.log(`OK: ${json?.ok}`);
  console.log(`Successes: ${json?.successes || 0}`);
  console.log(`Failures: ${json?.failures || 0}`);
  console.log(`Skipped: ${json?.skipped || 0}`);
  
  if (json?.debug) {
    console.log('\nTop-Level Debug:');
    console.log(`  usedDeployment: ${json.debug.usedDeployment || 'null'}`);
    console.log(`  usedEnv: ${json.debug.usedEnv || 'null'}`);
    console.log(`  redisConfigured: ${json.debug.redisConfigured}`);
    console.log(`  forceOverride: ${json.debug.forceOverride || false}`);
    
    if (json.debug.redisFingerprint) {
      const rf = json.debug.redisFingerprint;
      console.log(`  redisFingerprint:`);
      console.log(`    vercelEnv: ${rf.vercelEnv || 'null'}`);
      console.log(`    vercelGitCommitSha: ${rf.vercelGitCommitSha || 'null'}`);
      console.log(`    urlFingerprint: ${rf.urlFingerprint || 'null'}`);
      console.log(`    tokenFingerprint: ${rf.tokenFingerprint || 'null'}`);
    }
    console.log(`  redisClientType: ${json.debug.redisClientType || 'N/A'}`);
  }
  
  if (json?.results && json.results.length > 0) {
    const r = json.results[0];
    console.log('\nFirst Result:');
    console.log(`  OK: ${r.ok}`);
    console.log(`  Skipped: ${r.skipped || false}`);
    console.log(`  verifyKeyChecked: ${r.verifyKeyChecked || 'null'}`);
    console.log(`  verifyKeyExists: ${r.verifyKeyExists !== undefined ? r.verifyKeyExists : 'null'}`);
    console.log(`  verifyKeyValuePreview: ${r.verifyKeyValuePreview || 'null'}`);
    console.log(`  raceIdDerived: ${r.raceIdDerived || 'null'}`);
    console.log(`  skipReason: ${r.skipReason || 'null'}`);
    
    if (r.skipped && r.skipReason === 'already_verified_in_redis') {
      console.log(`\n⚠️ Backfill skipped as expected. Key: ${r.verifyKeyChecked}`);
    } else if (r.skipped) {
      console.log(`\n⚠️ Backfill skipped. Reason: ${r.skipReason}`);
    } else {
      console.log(`\n✅ Backfill did NOT skip. Processed: ${json.processed}`);
    }
  }

  return json;
}

async function testDebugRedisKeys() {
  console.log('\n=== TEST 4: /api/debug_redis_keys ===');
  const url = `${BASE_URL}/api/debug_redis_keys?track=${encodeURIComponent(TEST_RACE.track)}&date=${TEST_RACE.date}&raceNo=${TEST_RACE.raceNo}`;
  console.log(`GET ${url}`);
  
  const { status, json, error } = await fetchJSON(url);

  if (error) {
    console.error(`❌ Network error: ${error}`);
    return null;
  }

  console.log(`HTTP ${status}`);
  console.log(`OK: ${json?.ok}`);
  
  if (json?.normalization) {
    console.log('\nNormalization:');
    const n = json.normalization;
    console.log(`  trackIn: "${n.trackIn}" -> trackSlug: "${n.trackSlug}"`);
    console.log(`  dateIn: "${n.dateIn}" -> dateIso: "${n.dateIso}"`);
    console.log(`  raceNoIn: "${n.raceNoIn}" -> raceNoNormalized: "${n.raceNoNormalized}"`);
  }
  
  console.log(`\nComputed Keys:`);
  console.log(`  predsnapRaceId: ${json.predsnapRaceId || 'null'}`);
  console.log(`  predsnapPattern: ${json.predsnapPattern || 'null'}`);
  console.log(`  verifyRaceId: ${json.verifyRaceId || 'null'}`);
  console.log(`  verifyKey: ${json.verifyKey || 'null'}`);
  
  console.log(`\nExistence Checks:`);
  console.log(`  predsnapKeyExists: ${json.predsnapKeyExists}`);
  console.log(`  predsnapKeysFound: ${json.predsnapKeysFound?.length || 0} key(s)`);
  if (json.predsnapKeysFound?.length > 0) {
    console.log(`    First key: ${json.predsnapKeysFound[0]}`);
  }
  console.log(`  verifyKeyExists: ${json.verifyKeyExists}`);
  console.log(`  verifyKeyType: ${json.verifyKeyType || 'none'}`);
  console.log(`  verifyKeyValuePreview: ${json.verifyKeyValuePreview ? json.verifyKeyValuePreview.slice(0, 80) + '...' : 'null'}`);

  return json;
}

async function compareFingerprints(predictResp, verifyResp, backfillResp) {
  console.log('\n=== FINGERPRINT COMPARISON ===');
  
  const fingerprints = [];
  
  if (predictResp?.predsnap_debug?.redisFingerprint) {
    fingerprints.push({
      endpoint: 'predict_wps (predsnap)',
      fingerprint: predictResp.predsnap_debug.redisFingerprint,
      clientType: predictResp.predsnap_debug.redisClientType || 'unknown',
    });
  }
  
  if (verifyResp?.debug?.redisFingerprint) {
    fingerprints.push({
      endpoint: 'verify_race (log)',
      fingerprint: verifyResp.debug.redisFingerprint,
      clientType: verifyResp.debug.redisClientType || 'unknown',
    });
  }
  
  if (backfillResp?.debug?.redisFingerprint) {
    fingerprints.push({
      endpoint: 'verify_backfill',
      fingerprint: backfillResp.debug.redisFingerprint,
      clientType: backfillResp.debug.redisClientType || 'unknown',
    });
  }
  
  if (fingerprints.length === 0) {
    console.log('⚠️ No fingerprints found in responses');
    return;
  }
  
  // Extract unique fingerprints
  const unique = new Map();
  fingerprints.forEach(({ endpoint, fingerprint, clientType }) => {
    const key = `${fingerprint.urlFingerprint}-${fingerprint.tokenFingerprint}`;
    if (!unique.has(key)) {
      unique.set(key, { fingerprint, endpoints: [], clientTypes: [] });
    }
    unique.get(key).endpoints.push(endpoint);
    if (clientType) {
      unique.get(key).clientTypes.push(clientType);
    }
  });
  
  console.log(`Found ${unique.size} unique Redis fingerprint(s):\n`);
  
  unique.forEach(({ fingerprint, endpoints, clientTypes }) => {
    console.log(`Fingerprint (${endpoints.length} endpoint(s)):`);
    console.log(`  Endpoints: ${endpoints.join(', ')}`);
    if (clientTypes.length > 0) {
      console.log(`  Client Types: ${[...new Set(clientTypes)].join(', ')}`);
    }
    console.log(`  vercelEnv: ${fingerprint.vercelEnv || 'null'}`);
    console.log(`  vercelGitCommitSha: ${fingerprint.vercelGitCommitSha || 'null'}`);
    console.log(`  urlFingerprint: ${fingerprint.urlFingerprint || 'null'}`);
    console.log(`  tokenFingerprint: ${fingerprint.tokenFingerprint || 'null'}`);
    console.log(`  env: ${fingerprint.env || 'null'}`);
    console.log(`  configured: ${fingerprint.configured}`);
    console.log('');
  });
  
  if (unique.size > 1) {
    console.log('⚠️ WARNING: Multiple unique fingerprints detected!');
    console.log('This indicates different Redis instances or different env vars.');
    console.log('Verify that Preview and Production use the same Upstash instance.\n');
  } else {
    console.log('✅ All endpoints use the same Redis fingerprint.\n');
  }
}

async function testHrnParsing() {
  console.log('\n=== HRN PARSING TESTS ===');
  
  // Test 1: Fair Grounds 2026-01-10 raceNo=5 (the failing case)
  console.log('\n--- Test Case 1: Fair Grounds 2026-01-10 R5 (failing case) ---');
  const test1 = await testVerifyRace("Fair Grounds", "2026-01-10", "5");
  
  // Test 2: Fair Grounds 2026-01-09 raceNo=5 (known good case)
  console.log('\n--- Test Case 2: Fair Grounds 2026-01-09 R5 (known good case) ---');
  const test2 = await testVerifyRace("Fair Grounds", "2026-01-09", "5");
  
  // Summary
  console.log('\n=== HRN Parsing Summary ===');
  console.log(`Test 1 (2026-01-10 R5): ${test1?.ok ? '✅ OK' : '❌ Failed'}`);
  if (test1?.outcome) {
    console.log(`  Win: ${test1.outcome.win || '(empty)'}, Place: ${test1.outcome.place || '(empty)'}, Show: ${test1.outcome.show || '(empty)'}`);
  }
  if (test1?.debug?.hrnParsedBy) {
    console.log(`  Parsed by: ${test1.debug.hrnParsedBy}`);
  }
  
  console.log(`Test 2 (2026-01-09 R5): ${test2?.ok ? '✅ OK' : '❌ Failed'}`);
  if (test2?.outcome) {
    console.log(`  Win: ${test2.outcome.win || '(empty)'}, Place: ${test2.outcome.place || '(empty)'}, Show: ${test2.outcome.show || '(empty)'}`);
  }
  if (test2?.debug?.hrnParsedBy) {
    console.log(`  Parsed by: ${test2.debug.hrnParsedBy}`);
  }
  
  return { test1, test2 };
}

async function runSmokeTest() {
  console.log(`\n=== Redis/Verify End-to-End Smoke Test ===`);
  console.log(`Testing against: ${BASE_URL}\n`);
  
  const predictResp = await testPredictWps();
  const verifyResp = await testVerifyRace();
  const backfillResp = await testVerifyBackfill();
  const debugResp = await testDebugRedisKeys();
  const hrnTests = await testHrnParsing();
  
  await compareFingerprints(predictResp, verifyResp, backfillResp);
  
  console.log('\n=== SUMMARY ===');
  console.log(`Predict WPS: ${predictResp ? (predictResp.predsnap_debug?.predsnapWritten ? '✅ Written' : '⚠️ Not written') : '❌ Failed'}`);
  console.log(`Verify Race: ${verifyResp ? (verifyResp.debug?.verifyWriteOk ? '✅ Written' : '⚠️ Not written') : '❌ Failed'}`);
  console.log(`Verify Backfill: ${backfillResp ? (backfillResp.ok ? '✅ OK' : '⚠️ Failed') : '❌ Failed'}`);
  console.log(`Debug Keys: ${debugResp ? '✅ OK' : '❌ Failed'}`);
  console.log(`HRN Parsing Test 1: ${hrnTests?.test1?.ok ? '✅ OK' : '❌ Failed'}`);
  console.log(`HRN Parsing Test 2: ${hrnTests?.test2?.ok ? '✅ OK' : '❌ Failed'}`);
  console.log('\n=== Smoke Test Complete ===\n');
}

runSmokeTest().catch(console.error);