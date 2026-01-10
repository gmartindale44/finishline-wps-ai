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
    
    // HRN-specific debug fields - check if HRN was attempted (hrnAttempted or hrnParsedBy exists)
    if (json.debug.hrnAttempted === true || json.debug.hrnParsedBy !== undefined) {
      console.log(`\nHRN Parsing Debug:`);
      console.log(`  hrnAttempted: ${json.debug.hrnAttempted !== undefined ? json.debug.hrnAttempted : 'null'}`);
      console.log(`  hrnUrl: ${json.debug.hrnUrl || 'null'}`);
      console.log(`  hrnHttpStatus: ${json.debug.hrnHttpStatus || 'null'}`);
      console.log(`  hrnParsedBy: ${json.debug.hrnParsedBy || 'null'}`);
      console.log(`  hrnRegionFound: ${json.debug.hrnRegionFound !== undefined ? json.debug.hrnRegionFound : 'null'}`);
      if (json.debug.hrnRegionSnippet) {
        console.log(`  hrnRegionSnippet: ${json.debug.hrnRegionSnippet.substring(0, 200)}...`);
      }
      if (json.debug.hrnFoundMarkers) {
        console.log(`  hrnFoundMarkers:`, JSON.stringify(json.debug.hrnFoundMarkers));
      }
      if (json.debug.hrnOutcomeRaw) {
        console.log(`  hrnOutcomeRaw:`, JSON.stringify(json.debug.hrnOutcomeRaw));
      }
      if (json.debug.hrnOutcomeNormalized) {
        console.log(`  hrnOutcomeNormalized:`, JSON.stringify(json.debug.hrnOutcomeNormalized));
      }
      if (json.debug.hrnCandidateRejectedReasons && json.debug.hrnCandidateRejectedReasons.length > 0) {
        console.log(`  hrnCandidateRejectedReasons:`, JSON.stringify(json.debug.hrnCandidateRejectedReasons));
      }
      if (json.debug.hrnParseError) {
        console.log(`  hrnParseError: ${json.debug.hrnParseError}`);
      }
    } else if (json.debug.source === 'hrn') {
      // If source is HRN but debug fields are missing, this is a bug
      console.log(`\n⚠️ WARNING: debug.source='hrn' but HRN debug fields are missing!`);
      console.log(`  This indicates debug fields were lost/overwritten.`);
      console.log(`  Available debug fields:`, Object.keys(json.debug || {}));
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

// Helper to validate horse name is not garbage/JS token
function isGarbageHorseName(name) {
  if (!name || name.length === 0) return false; // Empty is OK (no result)
  
  // Check for JS tokens
  const jsKeywords = ['datalayer', 'dow', 'window', 'document', 'function', 'var', 'let', 'const',
    'this', 'place', 'win', 'show', 'true', 'false', 'null', 'undefined'];
  const nameLower = name.toLowerCase().trim();
  if (jsKeywords.includes(nameLower)) return true;
  
  // Check for dots (JS property access like "dow.dataLayer")
  if (name.includes('.')) return true;
  
  // Check for generic tokens
  const genericTokens = ['this', 'place', 'win', 'show', 'the', 'a', 'an'];
  if (genericTokens.includes(nameLower)) return true;
  
  // Check for suspicious patterns
  if (/[{}()=>]/.test(name)) return true;
  if (name.length < 3) return true; // Too short to be a real horse name
  
  return false;
}

async function testHrnParsing() {
  console.log('\n=== HRN PARSING TESTS ===');
  
  // Test 1: Fair Grounds 2026-01-10 raceNo=5 (the failing case - should NOT return garbage)
  console.log('\n--- Test Case 1: Fair Grounds 2026-01-10 R5 (previously returned garbage) ---');
  const test1 = await testVerifyRace("Fair Grounds", "2026-01-10", "5");
  
  // Test 2: Fair Grounds 2026-01-09 raceNo=5 (known good case)
  console.log('\n--- Test Case 2: Fair Grounds 2026-01-09 R5 (known good case) ---');
  const test2 = await testVerifyRace("Fair Grounds", "2026-01-09", "5");
  
  // Detailed assertions for Test 1
  console.log('\n=== Test 1 Assertions (2026-01-10 R5) ===');
  const hd1 = test1?.debug || {};
  
  console.log(`hrnParsedBy: ${hd1.hrnParsedBy || 'null'}`);
  console.log(`hrnRegionFound: ${hd1.hrnRegionFound !== undefined ? hd1.hrnRegionFound : 'null'}`);
  if (hd1.hrnRegionSnippet) {
    console.log(`hrnRegionSnippet (first 200 chars): ${hd1.hrnRegionSnippet.substring(0, 200)}`);
  }
  if (hd1.hrnCandidateRejectedReasons && hd1.hrnCandidateRejectedReasons.length > 0) {
    console.log(`hrnCandidateRejectedReasons: ${JSON.stringify(hd1.hrnCandidateRejectedReasons)}`);
  }
  if (hd1.hrnFoundMarkers) {
    console.log(`hrnFoundMarkers: ${JSON.stringify(hd1.hrnFoundMarkers)}`);
  }
  
  const outcome1 = test1?.outcome || {};
  console.log(`Outcome - Win: "${outcome1.win || ''}", Place: "${outcome1.place || ''}", Show: "${outcome1.show || ''}"`);
  
  // Assertions
  let test1Pass = true;
  const issues1 = [];
  
  // REQUIRED: Assert outcome.win does NOT match garbage patterns
  if (outcome1.win && /dow\.dataLayer|^THIS$|^place$/i.test(outcome1.win)) {
    issues1.push(`Win matches garbage pattern: "${outcome1.win}" (should not match /dow\\.dataLayer|^THIS$|^place$/i)`);
    test1Pass = false;
  }
  
  // Check for garbage in outcome (comprehensive)
  if (isGarbageHorseName(outcome1.win)) {
    issues1.push(`Win contains garbage: "${outcome1.win}"`);
    test1Pass = false;
  }
  if (isGarbageHorseName(outcome1.place)) {
    issues1.push(`Place contains garbage: "${outcome1.place}"`);
    test1Pass = false;
  }
  if (isGarbageHorseName(outcome1.show)) {
    issues1.push(`Show contains garbage: "${outcome1.show}"`);
    test1Pass = false;
  }
  
  // REQUIRED: Assert hrnAttempted === true
  if (hd1.hrnAttempted !== true) {
    issues1.push(`hrnAttempted is not true (got: ${hd1.hrnAttempted})`);
    test1Pass = false;
  }
  
  // REQUIRED: Assert hrnParsedBy is defined (even if "none")
  if (hd1.hrnParsedBy === undefined || hd1.hrnParsedBy === null) {
    issues1.push(`hrnParsedBy is not defined (got: ${hd1.hrnParsedBy})`);
    test1Pass = false;
  }
  
  // REQUIRED: Assert hrnUrl is defined when hrnAttempted=true
  if (hd1.hrnAttempted === true && !hd1.hrnUrl) {
    issues1.push(`hrnAttempted=true but hrnUrl is not defined`);
    test1Pass = false;
  }
  
  // If hrnParsedBy="none", outcome should be empty OR ok=false
  if (hd1.hrnParsedBy === 'none') {
    if (test1.ok && (outcome1.win || outcome1.place || outcome1.show)) {
      issues1.push(`hrnParsedBy="none" but outcome is non-empty and ok=true`);
      test1Pass = false;
    }
  }
  
  // If ok=true and outcome exists, ensure no JS tokens
  if (test1.ok) {
    const hasOutcome = outcome1.win || outcome1.place || outcome1.show;
    if (hasOutcome) {
      // If we have outcome, all values should be valid horse names (or empty)
      if (outcome1.win && isGarbageHorseName(outcome1.win)) {
        issues1.push(`ok=true but win is garbage: "${outcome1.win}"`);
        test1Pass = false;
      }
      if (outcome1.place && isGarbageHorseName(outcome1.place)) {
        issues1.push(`ok=true but place is garbage: "${outcome1.place}"`);
        test1Pass = false;
      }
      if (outcome1.show && isGarbageHorseName(outcome1.show)) {
        issues1.push(`ok=true but show is garbage: "${outcome1.show}"`);
        test1Pass = false;
      }
    }
  }
  
  if (test1Pass) {
    console.log('✅ Test 1 PASSED: No garbage detected, assertions met');
  } else {
    console.log('❌ Test 1 FAILED:');
    issues1.forEach(issue => console.log(`  - ${issue}`));
  }
  
  // Summary for Test 2 (known good case)
  console.log('\n=== Test 2 Assertions (2026-01-09 R5) ===');
  const hd2 = test2?.debug || {};
  console.log(`hrnAttempted: ${hd2.hrnAttempted}`);
  console.log(`hrnParsedBy: ${hd2.hrnParsedBy || 'null'}`);
  console.log(`hrnUrl: ${hd2.hrnUrl || 'null'}`);
  console.log(`hrnHttpStatus: ${hd2.hrnHttpStatus || 'null'}`);
  if (hd2.hrnFoundMarkers) {
    console.log(`hrnFoundMarkers: ${JSON.stringify(hd2.hrnFoundMarkers)}`);
  }
  const outcome2 = test2?.outcome || {};
  console.log(`Outcome - Win: "${outcome2.win || ''}", Place: "${outcome2.place || ''}", Show: "${outcome2.show || ''}"`);
  
  let test2Pass = true;
  const issues2 = [];
  
  // REQUIRED: Assert hrnParsedBy is defined (even if "none") when outcome exists or ok=true
  // Note: If Google parsing succeeded, hrnAttempted might be false, which is fine
  if (test2.ok || (outcome2.win || outcome2.place || outcome2.show)) {
    // If we have outcome, HRN was likely attempted, so check debug fields
    if (hd2.hrnAttempted === true) {
      // REQUIRED: If hrnAttempted=true, hrnParsedBy must be defined
      if (hd2.hrnParsedBy === undefined || hd2.hrnParsedBy === null) {
        issues2.push(`hrnAttempted=true but hrnParsedBy is not defined`);
        test2Pass = false;
      }
      // REQUIRED: If hrnAttempted=true, hrnUrl must be defined
      if (!hd2.hrnUrl) {
        issues2.push(`hrnAttempted=true but hrnUrl is not defined`);
        test2Pass = false;
      }
    }
  }
  
  if (test2.ok && (outcome2.win || outcome2.place || outcome2.show)) {
    // Should have valid horse names (expected outcome)
    if (isGarbageHorseName(outcome2.win) || isGarbageHorseName(outcome2.place) || isGarbageHorseName(outcome2.show)) {
      issues2.push('Contains garbage in known good case!');
      test2Pass = false;
    }
    
    // Assert we got expected outcome - all three should be present for ok=true
    if (!outcome2.win || !outcome2.place || !outcome2.show) {
      issues2.push(`ok=true but outcome is incomplete (win:${!!outcome2.win}, place:${!!outcome2.place}, show:${!!outcome2.show})`);
      test2Pass = false;
    }
    
    if (test2Pass && issues2.length === 0) {
      console.log('✅ Test 2 PASSED: Known good case still works with expected outcome and debug fields');
    } else {
      console.log('❌ Test 2 FAILED:');
      issues2.forEach(issue => console.log(`  - ${issue}`));
    }
  } else {
    console.log('⚠️ Test 2: ok=false or empty outcome (may be expected if race not yet finished)');
    if (hd2.hrnAttempted === true) {
      // If HRN was attempted, ensure debug fields are present
      if (hd2.hrnParsedBy === undefined || hd2.hrnParsedBy === null) {
        issues2.push('hrnAttempted=true but hrnParsedBy is not defined');
        test2Pass = false;
      }
      if (!hd2.hrnUrl) {
        issues2.push('hrnAttempted=true but hrnUrl is not defined');
        test2Pass = false;
      }
      if (issues2.length > 0) {
        console.log('❌ Test 2 FAILED (debug fields missing):');
        issues2.forEach(issue => console.log(`  - ${issue}`));
      } else {
        console.log('  (hrnParsedBy is defined, which is correct)');
      }
    }
  }
  
  console.log('\n=== HRN Parsing Summary ===');
  console.log(`Test 1 (2026-01-10 R5): ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (2026-01-09 R5): ${test2Pass ? '✅ PASS' : test2.ok ? '✅ OK' : '⚠️ No outcome'}`);
  
  return { test1, test2, test1Pass, test2Pass };
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
  console.log(`HRN Parsing Test 1: ${hrnTests?.test1Pass ? '✅ PASS (no garbage)' : '❌ FAIL (garbage detected)'}`);
  console.log(`HRN Parsing Test 2: ${hrnTests?.test2Pass ? '✅ PASS' : hrnTests?.test2?.ok ? '✅ OK' : '⚠️ No outcome'}`);
  console.log('\n=== Smoke Test Complete ===\n');
}

runSmokeTest().catch(console.error);