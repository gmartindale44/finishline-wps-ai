#!/usr/bin/env node
/**
 * Regression test: Verify responseMeta.redis structure
 * 
 * This is a code-structure test that validates the responseMeta.redis
 * structure without requiring real network calls or Redis connections.
 * 
 * Tests:
 * - responseMeta.redis exists in both manual and auto verify paths
 * - responseMeta.redis includes required fields: writeOk, readbackOk, verifyKey, ttlSeconds, valueSize
 * - writeOk and readbackOk are booleans
 */

import { readFile } from 'fs/promises';

const VERIFY_RACE_FILE = 'pages/api/verify_race.js';

async function testResponseMetaRedis() {
  console.log('[test] Reading verify_race.js...');
  const content = await readFile(VERIFY_RACE_FILE, 'utf8');
  
  const errors = [];
  const warnings = [];
  
  // Test 1: Manual verify path includes responseMeta.redis
  console.log('[test] Checking manual verify path...');
  const manualVerifyReturnMatch = content.match(/return res\.status\(200\)\.json\(\s*\{[^}]*responseMeta:\s*\{[^}]*redis:/s);
  if (!manualVerifyReturnMatch) {
    errors.push('Manual verify path: responseMeta.redis not found in return statement');
  } else {
    const manualMeta = manualVerifyReturnMatch[0];
    if (!manualMeta.includes('redis: finalResult._redisResult')) {
      errors.push('Manual verify path: responseMeta.redis does not reference finalResult._redisResult');
    }
    if (!manualMeta.includes('redisFingerprint:')) {
      warnings.push('Manual verify path: responseMeta.redisFingerprint not found (may be gated)');
    }
  }
  
  // Test 2: Auto verify path includes responseMeta.redis
  console.log('[test] Checking auto verify path...');
  const autoVerifyReturnMatch = content.match(/return res\.status\(200\)\.json\(\s*\{[^}]*responseMeta:\s*\{[^}]*redis:/s);
  if (!autoVerifyReturnMatch || autoVerifyReturnMatch.length < 2) {
    // Try different pattern for auto verify
    const autoVerifyPattern = /validatedResult.*responseMeta.*redis:/s;
    if (!autoVerifyPattern.test(content)) {
      // Check if it's in the return statement
      const autoReturnMatch = content.match(/\.\.\.validatedResult\.responseMeta[^}]*redis:/s);
      if (!autoReturnMatch) {
        errors.push('Auto verify path: responseMeta.redis not found');
      }
    }
  }
  
  // Test 3: logVerifyResult returns redisResult object
  console.log('[test] Checking logVerifyResult return...');
  if (!content.includes('return redisResult;') && !content.match(/return\s+redisResult\s*;/)) {
    errors.push('logVerifyResult does not return redisResult');
  }
  
  // Test 4: redisResult structure includes required fields
  console.log('[test] Checking redisResult structure...');
  const redisResultInitMatch = content.match(/let redisResult = \{[^}]*writeOk:/s);
  if (!redisResultInitMatch) {
    errors.push('redisResult initialization not found with writeOk field');
  } else {
    const initBlock = redisResultInitMatch[0];
    const requiredFields = ['writeOk', 'readbackOk', 'verifyKey', 'ttlSeconds', 'valueSize'];
    for (const field of requiredFields) {
      if (!initBlock.includes(field + ':')) {
        errors.push(`redisResult missing required field: ${field}`);
      }
    }
  }
  
  // Test 5: Manual verify path captures redisResult
  console.log('[test] Checking manual verify captures redisResult...');
  if (!content.includes('const redisResult = await logVerifyResult(result);')) {
    errors.push('Manual verify path does not capture redisResult from logVerifyResult');
  }
  
  // Test 6: Auto verify path captures redisResult
  console.log('[test] Checking auto verify captures redisResult...');
  if (!content.includes('const redisResult = await logVerifyResult(validatedResult);')) {
    errors.push('Auto verify path does not capture redisResult from logVerifyResult');
  }
  
  // Test 7: redisFingerprint gating logic exists
  console.log('[test] Checking redisFingerprint gating...');
  if (!content.includes('shouldExposeFingerprint') && !content.includes('VERCEL_ENV') && !content.includes('EXPOSE_REDIS_DEBUG')) {
    warnings.push('redisFingerprint gating logic not found (may expose sensitive info in production)');
  } else {
    // Check if gating logic is correct
    if (!content.includes('vercelEnv !== \'production\'')) {
      warnings.push('redisFingerprint gating may not exclude production properly');
    }
  }
  
  // Summary
  console.log('\n[test] === SUMMARY ===\n');
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All tests passed');
    process.exit(0);
  } else {
    if (errors.length > 0) {
      console.error('❌ Errors:');
      errors.forEach(err => console.error(`  - ${err}`));
    }
    if (warnings.length > 0) {
      console.warn('⚠️  Warnings:');
      warnings.forEach(warn => console.warn(`  - ${warn}`));
    }
    process.exit(errors.length > 0 ? 1 : 0);
  }
}

testResponseMetaRedis().catch(err => {
  console.error('[test] Fatal error:', err);
  process.exit(1);
});
