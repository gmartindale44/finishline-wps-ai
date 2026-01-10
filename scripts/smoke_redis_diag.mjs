#!/usr/bin/env node
/**
 * Smoke test for Redis diagnostics and predsnap/verify consistency
 * 
 * Usage:
 *   node scripts/smoke_redis_diag.mjs [baseUrl]
 * 
 * Example:
 *   node scripts/smoke_redis_diag.mjs http://localhost:3000
 *   node scripts/smoke_redis_diag.mjs https://finishline-wps-ai-preview.vercel.app
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const TEST_RACE = {
  track: 'Aqueduct',
  date: '2026-01-09',
  raceNo: '9',
  horses: [
    { name: 'Test Horse 1', odds: '3/1', post: 1 },
    { name: 'Test Horse 2', odds: '5/2', post: 2 },
    { name: 'Test Horse 3', odds: '7/2', post: 3 },
  ],
  surface: 'dirt',
  distance_input: '6f',
  speedFigs: {
    'Test Horse 1': 95,
    'Test Horse 2': 92,
    'Test Horse 3': 88,
  },
};

async function fetchJSON(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON: ${text.slice(0, 200)}`);
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: null, error: err.message };
  }
}

async function testPredictWps() {
  console.log('\n=== TEST 1: /api/predict_wps ===');
  console.log(`POST ${BASE_URL}/api/predict_wps`);
  
  const { status, json, error } = await fetchJSON(`${BASE_URL}/api/predict_wps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_RACE),
  });
  
  if (error || !json) {
    console.error(`❌ FAILED: ${error || 'No response'}`);
    return null;
  }
  
  console.log(`Status: ${status}`);
  console.log(`OK: ${json.ok}`);
  
  if (json.snapshot_debug) {
    const sd = json.snapshot_debug;
    console.log('\nSnapshot Debug:');
    console.log(`  enablePredSnapshots: ${sd.enablePredSnapshots}`);
    console.log(`  redisConfigured: ${sd.redisConfigured}`);
    console.log(`  shouldSnapshot: ${sd.shouldSnapshot}`);
    console.log(`  snapshotAttempted: ${sd.snapshotAttempted}`);
    console.log(`  snapshotWriteOk: ${sd.snapshotWriteOk}`);
    console.log(`  allowAny: ${sd.allowAny}`);
    console.log(`  confidenceHigh: ${sd.confidenceHigh}`);
    console.log(`  gatingReason: ${sd.gatingReason || 'N/A'}`);
    console.log(`  snapshotKey: ${sd.snapshotKey || 'null'}`);
    if (sd.redisFingerprint) {
      console.log(`  redisFingerprint:`);
      console.log(`    urlFingerprint: ${sd.redisFingerprint.urlFingerprint || 'null'}`);
      console.log(`    tokenFingerprint: ${sd.redisFingerprint.tokenFingerprint || 'null'}`);
      console.log(`    env: ${sd.redisFingerprint.env || 'null'}`);
    }
    console.log(`  redisClientType: ${sd.redisClientType || 'N/A'}`);
  }
  
  if (json.meta) {
    console.log(`\nMeta:`);
    console.log(`  raceId: ${json.meta.raceId || 'null'}`);
    console.log(`  asOf: ${json.meta.asOf || 'null'}`);
  }
  
  return json;
}

async function testVerifyRace() {
  console.log('\n=== TEST 2: /api/verify_race (manual) ===');
  console.log(`POST ${BASE_URL}/api/verify_race`);
  
  const payload = {
    track: TEST_RACE.track,
    date: TEST_RACE.date,
    raceNo: TEST_RACE.raceNo,
    mode: 'manual',
    outcome: {
      win: 'Test Horse 1',
      place: 'Test Horse 2',
      show: 'Test Horse 3',
    },
  };
  
  const { status, json, error } = await fetchJSON(`${BASE_URL}/api/verify_race`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  
  if (error || !json) {
    console.error(`❌ FAILED: ${error || 'No response'}`);
    return null;
  }
  
  console.log(`Status: ${status}`);
  console.log(`OK: ${json.ok}`);
  
  if (json.predmeta && json.predmeta.debug) {
    const pd = json.predmeta.debug;
    console.log('\nPredmeta Debug:');
    console.log(`  snapshotPattern: ${pd.snapshotPattern || 'N/A'}`);
    console.log(`  snapshotKeysFoundCount: ${pd.snapshotKeysFoundCount || 0}`);
    console.log(`  snapshotSelectedAsOf: ${pd.snapshotSelectedAsOf || 'null'}`);
    if (pd.redisFingerprint) {
      console.log(`  redisFingerprint:`);
      console.log(`    urlFingerprint: ${pd.redisFingerprint.urlFingerprint || 'null'}`);
      console.log(`    tokenFingerprint: ${pd.redisFingerprint.tokenFingerprint || 'null'}`);
    }
    console.log(`  redisClientType: ${pd.redisClientType || 'N/A'}`);
    console.log(`  joinKey: ${pd.joinKey || 'N/A'}`);
  }
  
  if (json.debug && json.debug.redisFingerprint) {
    console.log('\nVerify Log Debug:');
    const vf = json.debug.redisFingerprint;
    console.log(`  verifyLogKey: ${json.debug.verifyLogKey || 'N/A'}`);
    console.log(`  redisFingerprint:`);
    console.log(`    urlFingerprint: ${vf.urlFingerprint || 'null'}`);
    console.log(`    tokenFingerprint: ${vf.tokenFingerprint || 'null'}`);
  }
  
  return json;
}

async function testVerifyBackfill() {
  console.log('\n=== TEST 3: /api/verify_backfill ===');
  console.log(`POST ${BASE_URL}/api/verify_backfill`);
  
  const payload = {
    races: [{
      track: TEST_RACE.track,
      date: TEST_RACE.date,
      dateIso: TEST_RACE.date,
      raceNo: TEST_RACE.raceNo,
    }],
  };
  
  const { status, json, error } = await fetchJSON(`${BASE_URL}/api/verify_backfill?force=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  
  if (error || !json) {
    console.error(`❌ FAILED: ${error || 'No response'}`);
    return null;
  }
  
  console.log(`Status: ${status}`);
  console.log(`OK: ${json.ok}`);
  console.log(`Successes: ${json.successes || 0}`);
  console.log(`Failures: ${json.failures || 0}`);
  console.log(`Skipped: ${json.skipped || 0}`);
  
  if (json.debug) {
    console.log('\nTop-Level Debug:');
    console.log(`  usedDeployment: ${json.debug.usedDeployment || 'null'}`);
    console.log(`  usedEnv: ${json.debug.usedEnv || 'null'}`);
    console.log(`  redisConfigured: ${json.debug.redisConfigured}`);
    if (json.debug.redisFingerprint) {
      const vf = json.debug.redisFingerprint;
      console.log(`  redisFingerprint:`);
      console.log(`    urlFingerprint: ${vf.urlFingerprint || 'null'}`);
      console.log(`    tokenFingerprint: ${vf.tokenFingerprint || 'null'}`);
      console.log(`    env: ${vf.env || 'null'}`);
    }
    console.log(`  redisClientType: ${json.debug.redisClientType || 'N/A'}`);
    console.log(`  forceOverride: ${json.debug.forceOverride || false}`);
  }
  
  if (json.results && json.results.length > 0) {
    const r = json.results[0];
    console.log('\nFirst Result:');
    console.log(`  OK: ${r.ok}`);
    console.log(`  Skipped: ${r.skipped || false}`);
    if (r.verifiedRedisKeyChecked) {
      console.log(`  verifiedRedisKeyChecked: ${r.verifiedRedisKeyChecked}`);
      console.log(`  verifiedRedisKeyExists: ${r.verifiedRedisKeyExists}`);
      console.log(`  verifiedRedisKeyType: ${r.verifiedRedisKeyType || 'none'}`);
      if (r.normalization) {
        const n = r.normalization;
        console.log(`  normalization:`);
        console.log(`    trackIn: ${n.trackIn}, trackSlug: ${n.trackSlug}`);
        console.log(`    raceNoIn: ${n.raceNoIn}, raceNoNormalized: ${n.raceNoNormalized}`);
        console.log(`    dateIn: ${n.dateIn}, dateIso: ${n.dateIso}`);
      }
    }
  }
  
  return json;
}

async function testDebugVerifyKey() {
  console.log('\n=== TEST 4: /api/debug_verify_key ===');
  const url = `${BASE_URL}/api/debug_verify_key?track=${encodeURIComponent(TEST_RACE.track)}&date=${TEST_RACE.date}&raceNo=${TEST_RACE.raceNo}`;
  console.log(`GET ${url}`);
  
  const { status, json, error } = await fetchJSON(url);
  
  if (error || !json) {
    console.error(`❌ FAILED: ${error || 'No response'}`);
    return null;
  }
  
  console.log(`Status: ${status}`);
  console.log(`OK: ${json.ok}`);
  
  if (json.computed) {
    console.log('\nComputed:');
    console.log(`  raceId: ${json.computed.raceId || 'null'}`);
    console.log(`  key: ${json.computed.key || 'null'}`);
  }
  
  if (json.redis) {
    console.log('\nRedis:');
    console.log(`  configured: ${json.redis.configured}`);
    console.log(`  keyExists: ${json.redis.keyExists}`);
    console.log(`  keyType: ${json.redis.keyType || 'none'}`);
    if (json.redis.redisFingerprint) {
      console.log(`  urlFingerprint: ${json.redis.redisFingerprint.urlFingerprint || 'null'}`);
    }
  }
  
  return json;
}

async function compareFingerprints(predictResp, verifyResp, backfillResp) {
  console.log('\n=== FINGERPRINT COMPARISON ===');
  
  const fingerprints = [];
  
  if (predictResp?.snapshot_debug?.redisFingerprint) {
    fingerprints.push({
      endpoint: 'predict_wps',
      fingerprint: predictResp.snapshot_debug.redisFingerprint,
    });
  }
  
  if (verifyResp?.predmeta?.debug?.redisFingerprint) {
    fingerprints.push({
      endpoint: 'verify_race (predmeta)',
      fingerprint: verifyResp.predmeta.debug.redisFingerprint,
    });
  }
  
  if (verifyResp?.debug?.redisFingerprint) {
    fingerprints.push({
      endpoint: 'verify_race (log)',
      fingerprint: verifyResp.debug.redisFingerprint,
    });
  }
  
  if (backfillResp?.debug?.redisFingerprint) {
    fingerprints.push({
      endpoint: 'verify_backfill',
      fingerprint: backfillResp.debug.redisFingerprint,
    });
  }
  
  if (fingerprints.length === 0) {
    console.log('⚠️  No fingerprints found in responses');
    return;
  }
  
  // Extract unique fingerprints
  const unique = new Map();
  fingerprints.forEach(({ endpoint, fingerprint }) => {
    const key = `${fingerprint.urlFingerprint}-${fingerprint.tokenFingerprint}`;
    if (!unique.has(key)) {
      unique.set(key, { fingerprint, endpoints: [] });
    }
    unique.get(key).endpoints.push(endpoint);
  });
  
  console.log(`Found ${unique.size} unique Redis fingerprint(s):\n`);
  
  unique.forEach(({ fingerprint, endpoints }) => {
    console.log(`Fingerprint (${endpoints.length} endpoint(s)):`);
    console.log(`  Endpoints: ${endpoints.join(', ')}`);
    console.log(`  urlFingerprint: ${fingerprint.urlFingerprint || 'null'}`);
    console.log(`  tokenFingerprint: ${fingerprint.tokenFingerprint || 'null'}`);
    console.log(`  env: ${fingerprint.env || 'null'}`);
    console.log(`  configured: ${fingerprint.configured}`);
    console.log('');
  });
  
  if (unique.size > 1) {
    console.log('⚠️  WARNING: Multiple Redis fingerprints detected!');
    console.log('   This suggests different Redis instances are being used.');
    console.log('   Check Vercel env vars (Preview vs Production).\n');
  } else {
    console.log('✅ All endpoints use the same Redis instance.\n');
  }
}

async function main() {
  console.log('Redis Diagnostic Smoke Test');
  console.log(`Base URL: ${BASE_URL}\n`);
  
  const predictResp = await testPredictWps();
  const verifyResp = await testVerifyRace();
  const backfillResp = await testVerifyBackfill();
  const debugResp = await testDebugVerifyKey();
  
  await compareFingerprints(predictResp, verifyResp, backfillResp);
  
  console.log('\n=== SUMMARY ===');
  console.log('✅ Smoke test complete');
  console.log('\nNext steps:');
  console.log('1. Compare fingerprints across endpoints (should match)');
  console.log('2. Check predsnap gatingReason if snapshots not writing');
  console.log('3. Verify key formats match between write/read paths');
  console.log('4. Confirm verify_backfill skip logic works correctly\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
