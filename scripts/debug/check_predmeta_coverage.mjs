#!/usr/bin/env node
/**
 * Debug script to check why predmeta coverage is 0
 * 
 * Checks:
 * 1. Count of fl:predmeta:* keys in Redis
 * 2. Sample predmeta keys and values
 * 3. Recent verify logs and whether they contain predmeta fields
 * 4. Key format comparison
 */

import { keys, get } from '../../lib/redis.js';

async function main() {
  console.log('🔍 Predmeta Coverage Debug Report\n');
  
  // 1. Count predmeta keys
  console.log('📊 Step 1: Counting predmeta keys...');
  try {
    const predmetaKeys = await keys('fl:predmeta:*');
    const permanentKeys = predmetaKeys.filter(k => !k.includes(':pending:'));
    const pendingKeys = predmetaKeys.filter(k => k.includes(':pending:'));
    
    console.log(`   Total predmeta keys: ${predmetaKeys.length}`);
    console.log(`   Permanent keys: ${permanentKeys.length}`);
    console.log(`   Pending keys: ${pendingKeys.length}`);
    
    // 2. Show sample keys
    if (permanentKeys.length > 0) {
      console.log('\n📋 Step 2: Sample permanent keys:');
      const samples = permanentKeys.slice(0, 5);
      for (const key of samples) {
        console.log(`   - ${key}`);
        const value = await get(key);
        if (value) {
          try {
            const parsed = JSON.parse(value);
            console.log(`     confidence_pct: ${parsed.confidence_pct ?? 'N/A'}`);
            console.log(`     t3m_pct: ${parsed.t3m_pct ?? 'N/A'}`);
            console.log(`     track: ${parsed.track ?? 'N/A'}`);
            console.log(`     date: ${parsed.date ?? 'N/A'}`);
            console.log(`     raceNo: ${parsed.raceNo ?? 'N/A'}`);
          } catch (e) {
            console.log(`     (JSON parse error: ${e.message})`);
          }
        }
      }
    }
    
    // 3. Check recent verify logs
    console.log('\n📋 Step 3: Checking recent verify logs...');
    const verifyKeys = await keys('fl:verify:*');
    const recentVerifyKeys = verifyKeys.slice(-10).reverse().slice(0, 5);
    
    console.log(`   Found ${verifyKeys.length} verify keys, checking 5 most recent...`);
    
    for (const verifyKey of recentVerifyKeys) {
      const verifyLog = await get(verifyKey);
      if (!verifyLog) continue;
      
      try {
        const parsed = JSON.parse(verifyLog);
        const hasPredmeta = !!(parsed.confidence_pct || parsed.t3m_pct || parsed.top3_list);
        const track = parsed.track || 'N/A';
        const date = parsed.date || 'N/A';
        const raceNo = parsed.raceNo || 'N/A';
        
        console.log(`\n   Verify key: ${verifyKey}`);
        console.log(`     track: ${track}, date: ${date}, raceNo: ${raceNo}`);
        console.log(`     Has predmeta fields: ${hasPredmeta}`);
        if (hasPredmeta) {
          console.log(`     confidence_pct: ${parsed.confidence_pct ?? 'N/A'}`);
          console.log(`     t3m_pct: ${parsed.t3m_pct ?? 'N/A'}`);
        }
        
        // Compute expected predmeta key
        if (track && date && raceNo) {
          const normTrack = normalizeTrack(track);
          const normDate = normalizeDate(date);
          const normRaceNo = String(raceNo).trim();
          const expectedKey = `fl:predmeta:${normDate}|${normTrack}|${normRaceNo}`;
          console.log(`     Expected predmeta key: ${expectedKey}`);
          
          // Check if it exists
          const predmetaValue = await get(expectedKey);
          console.log(`     Predmeta key exists: ${!!predmetaValue}`);
        }
      } catch (e) {
        console.log(`     (Parse error: ${e.message})`);
      }
    }
    
    console.log('\n✅ Debug complete\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Normalize track (mirror verify_race.js logic)
function normalizeTrack(track) {
  if (!track) return '';
  return String(track).trim().toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

// Normalize date (mirror verify_race.js logic)
function normalizeDate(date) {
  if (!date) return '';
  const str = String(date).trim();
  // Try to parse and format as YYYY-MM-DD
  const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[0];
  // Fallback: try other formats
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return str;
}

main().catch(console.error);

