import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getRedis } from '../lib/redis.js';

const CSV_PATH = path.join(process.cwd(), 'data', 'finishline_tests_v1.csv');
const CSV_HEADERS = 'Test_ID,Track,Race_No,Surface,Distance,Confidence,Top_3_Mass,AI_Picks,Strategy,Result,ROI_Percent,WinRate,Notes';

async function main() {
  const redis = await getRedis();
  if (!redis) {
    console.log('Redis not configured (UPSTASH_REDIS_REST_URL/TOKEN missing). Exiting.');
    process.exit(0);
  }
  
  try {
    // Get all keys matching fl:results:*
    const keys = await redis.keys('fl:results:*');
    
    if (!keys || keys.length === 0) {
      console.log('No results keys found in Redis.');
      process.exit(0);
    }
    
    const seen = new Set();
    const rows = [];
    
    // Read all lists
    for (const key of keys) {
      try {
        const items = await redis.lrange(key, 0, -1);
        for (const item of items) {
          try {
            const row = JSON.parse(item);
            const dedupKey = `${row.ts}|${row.track}|${row.picks}`;
            if (!seen.has(dedupKey)) {
              seen.add(dedupKey);
              rows.push(row);
            }
          } catch (e) {
            console.warn(`Failed to parse item from ${key}:`, e?.message);
          }
        }
      } catch (e) {
        console.warn(`Failed to read ${key}:`, e?.message);
      }
    }
    
    if (rows.length === 0) {
      console.log('No valid rows found in Redis.');
      process.exit(0);
    }
    
    // Read existing CSV if it exists
    const existing = new Set();
    let existingRows = [];
    
    if (fs.existsSync(CSV_PATH)) {
      const csvText = fs.readFileSync(CSV_PATH, 'utf8');
      const lines = csvText.trim().split(/\r?\n/);
      if (lines.length > 1) {
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 3) {
            const track = parts[1]?.trim();
            const picks = parts[7]?.replace(/"/g, '').trim();
            if (track && picks) {
              existingRows.push(lines[i]);
              existing.add(`${track}|${picks}`);
            }
          }
        }
      }
    }
    
    // Merge new rows (avoid duplicates)
    const newRows = [];
    for (const row of rows) {
      const dedupKey = `${row.track}|${row.picks}`;
      if (!existing.has(dedupKey)) {
        newRows.push([
          '', // Test_ID
          row.track || '',
          row.race_no || '',
          row.surface || '',
          row.distance || '',
          String(row.confidence ?? ''),
          String(row.top3_mass ?? ''),
          `"${row.picks || ''}"`,
          `"${row.strategy || ''}"`,
          row.result || '',
          String(row.roi_percent ?? ''),
          '',
          `"${row.notes || ''}"`
        ].join(','));
      }
    }
    
    // Write merged CSV
    fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
    fs.writeFileSync(CSV_PATH, CSV_HEADERS + '\n', 'utf8');
    existingRows.forEach(r => fs.appendFileSync(CSV_PATH, r + '\n', 'utf8'));
    newRows.forEach(r => fs.appendFileSync(CSV_PATH, r + '\n', 'utf8'));
    
    console.log(`Merged ${newRows.length} new rows into CSV (${existingRows.length} existing rows preserved).`);
    
    // Run calibration
    console.log('Running calibration...');
    const calibrate = spawn('npm', ['run', 'calibrate'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true
    });
    
    calibrate.on('close', (code) => {
      if (code === 0) {
        console.log('Calibration complete.');
      } else {
        console.warn(`Calibration exited with code ${code}`);
      }
      process.exit(0);
    });
    
    calibrate.on('error', (err) => {
      console.error('Failed to spawn calibration:', err);
      process.exit(0);
    });
    
  } catch (e) {
    console.error('Backfill error:', e);
    process.exit(0);
  }
}

main();

