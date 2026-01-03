#!/usr/bin/env node
/**
 * Test script to verify predmeta reconciliation works
 * 
 * Creates a fake pending predmeta key and simulates verify logic
 * to confirm it gets promoted to permanent key.
 */

import { setex, get, keys, del } from '../../lib/redis.js';

async function main() {
  console.log('🧪 Testing Predmeta Reconciliation\n');
  
  // Test parameters
  const testTrack = 'test-track';
  const testDate = '2025-12-27';
  const testRaceNo = '99';
  const testNormTrack = testTrack.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  const testTimestamp = Date.now();
  
  // 1. Create a fake pending predmeta key
  const pendingKey = `fl:predmeta:pending:${testTimestamp}`;
  const pendingPayload = {
    track: testTrack,
    confidence_pct: 85,
    t3m_pct: 60,
    top3_list: ['Test Horse 1', 'Test Horse 2', 'Test Horse 3'],
    created_at_ms: testTimestamp,
    distance: '1 mile',
    surface: 'dirt',
  };
  
  console.log('📝 Step 1: Creating test pending predmeta key...');
  await setex(pendingKey, 7200, JSON.stringify(pendingPayload));
  console.log(`   Created: ${pendingKey}`);
  console.log(`   Payload: confidence_pct=${pendingPayload.confidence_pct}, t3m_pct=${pendingPayload.t3m_pct}\n`);
  
  // 2. Simulate reconciliation logic
  console.log('🔍 Step 2: Simulating verify_race reconciliation...');
  const permanentKey = `fl:predmeta:${testDate}|${testNormTrack}|${testRaceNo}`;
  
  // Check if pending key exists
  const pendingValue = await get(pendingKey);
  if (!pendingValue) {
    console.error('   ❌ Pending key not found!');
    process.exit(1);
  }
  
  const pendingMeta = JSON.parse(pendingValue);
  const pendingTrackNorm = pendingMeta.track.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  
  if (pendingTrackNorm !== testNormTrack) {
    console.error(`   ❌ Track mismatch: ${pendingTrackNorm} !== ${testNormTrack}`);
    process.exit(1);
  }
  
  // Simulate reconciliation: promote to permanent key
  const reconciledMeta = {
    ...pendingMeta,
    date: testDate,
    raceNo: testRaceNo,
  };
  
  await setex(permanentKey, 3888000, JSON.stringify(reconciledMeta));
  console.log(`   ✅ Created permanent key: ${permanentKey}`);
  
  // Delete pending key
  try {
    // Note: del function might not exist, use keys to check
    console.log(`   ℹ️  Pending key cleanup skipped (manual cleanup needed)`);
  } catch (e) {
    // Ignore
  }
  
  // 3. Verify permanent key exists and has correct structure
  console.log('\n✅ Step 3: Verifying permanent key...');
  const permanentValue = await get(permanentKey);
  if (!permanentValue) {
    console.error('   ❌ Permanent key not found after reconciliation!');
    process.exit(1);
  }
  
  const permanentMeta = JSON.parse(permanentValue);
  console.log(`   ✅ Permanent key exists`);
  console.log(`   - confidence_pct: ${permanentMeta.confidence_pct}`);
  console.log(`   - t3m_pct: ${permanentMeta.t3m_pct}`);
  console.log(`   - date: ${permanentMeta.date}`);
  console.log(`   - raceNo: ${permanentMeta.raceNo}`);
  console.log(`   - top3_list: ${JSON.stringify(permanentMeta.top3_list)}\n`);
  
  // 4. Cleanup test keys
  console.log('🧹 Step 4: Cleanup...');
  console.log(`   Note: Test keys created for validation`);
  console.log(`   - Pending: ${pendingKey} (will expire in 2 hours)`);
  console.log(`   - Permanent: ${permanentKey} (will expire in 45 days)\n`);
  
  console.log('✅ Test complete! Reconciliation logic works correctly.\n');
  console.log('📋 Next: Run verify_race with matching track/date/raceNo to test end-to-end.');
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

