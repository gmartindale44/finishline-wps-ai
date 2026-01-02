#!/usr/bin/env node
/**
 * Test script for redisHSet() function
 * Usage: node scripts/test-hset.mjs
 * 
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars
 */

import { redisHSet } from '../lib/redis.js';

async function testHSet() {
  console.log('🧪 Testing redisHSet() function...\n');
  
  const testKey = 'test:hset';
  const testData = {
    a: '1',
    b: '2',
    c: '3',
    nested: JSON.stringify({ x: 1, y: 2 }),
    number: String(42),
    empty: '',
  };
  
  try {
    console.log('📝 Test data:');
    console.log(`   Key: ${testKey}`);
    console.log(`   Data:`, testData);
    console.log('');
    
    console.log('⏳ Calling redisHSet()...');
    const result = await redisHSet(testKey, testData);
    
    if (result === true) {
      console.log('✅ redisHSet() succeeded!');
      console.log('');
      console.log('🔍 Verification:');
      console.log('   1. Check Upstash UI for key:', testKey);
      console.log('   2. Key should contain hash fields: a, b, c, nested, number, empty');
      console.log('   3. Values should match test data above');
      console.log('');
      console.log('✅ Test PASSED');
      process.exit(0);
    } else {
      console.error('❌ redisHSet() returned unexpected result:', result);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test FAILED with error:');
    console.error('   ', error.message);
    if (error.message.includes('redis_unreachable')) {
      console.error('');
      console.error('💡 Make sure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set');
    }
    process.exit(1);
  }
}

testHSet();

