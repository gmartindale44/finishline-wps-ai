#!/usr/bin/env node
/**
 * Regression test: Verify predmeta is always declared in manual verify path
 * 
 * This is a static code check that validates predmeta is initialized
 * before use in the manual verify path.
 */

import { readFile } from 'fs/promises';

const VERIFY_RACE_FILE = 'pages/api/verify_race.js';

async function testPredmetaFix() {
  console.log('[test] Reading verify_race.js...');
  const content = await readFile(VERIFY_RACE_FILE, 'utf8');
  
  const errors = [];
  const warnings = [];
  
  // Test 1: Manual verify block exists
  console.log('[test] Checking manual verify block...');
  const manualBlockMatch = content.match(/if\s*\(body\.mode\s*===\s*"manual"\s*&&\s*body\.outcome\)\s*\{([^}]{0,2000})/s);
  if (!manualBlockMatch) {
    errors.push('Manual verify block not found');
  } else {
    const manualBlock = manualBlockMatch[1];
    
    // Test 2: predmeta is declared in manual block
    console.log('[test] Checking predmeta declaration in manual block...');
    if (!manualBlock.includes('const predmeta') && !manualBlock.includes('let predmeta') && !manualBlock.includes('var predmeta')) {
      errors.push('predmeta is NOT declared in manual verify block (ReferenceError will occur)');
    } else {
      // Check if it's set to null (safe default)
      if (manualBlock.includes('const predmeta = null') || manualBlock.includes('let predmeta = null')) {
        console.log('[test] ✅ predmeta is declared and initialized to null in manual block');
      } else {
        warnings.push('predmeta is declared but not initialized to null (may still cause issues)');
      }
    }
    
    // Test 3: predmeta is used in manual block (should be safe since it's declared)
    console.log('[test] Checking predmeta usage in manual block...');
    const predmetaUsageMatches = manualBlock.match(/\bpredmeta\b/g);
    if (predmetaUsageMatches && predmetaUsageMatches.length > 0) {
      console.log(`[test] predmeta is used ${predmetaUsageMatches.length} times in manual block (should be safe since declared)`);
    }
  }
  
  // Test 4: Check for any predmeta references outside declared scope
  console.log('[test] Checking for predmeta references outside manual block...');
  const handlerMatch = content.match(/export default async function handler\([^}]*?(if\s*\(body\.mode\s*===\s*"manual"[^}]*?\})/s);
  if (handlerMatch) {
    const beforeManual = handlerMatch[1].replace(/if\s*\(body\.mode\s*===\s*"manual"[^}]*?\}/s, '');
    // Check for predmeta usage before manual block (should not exist at handler scope)
    if (beforeManual.match(/\bpredmeta\b/) && !beforeManual.match(/(const|let|var)\s+predmeta/)) {
      errors.push('predmeta is used before manual block without declaration');
    }
  }
  
  // Summary
  console.log('\n[test] === SUMMARY ===\n');
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All tests passed - predmeta is properly declared in manual verify path');
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

testPredmetaFix().catch(err => {
  console.error('[test] Fatal error:', err);
  process.exit(1);
});
