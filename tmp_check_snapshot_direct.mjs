// Direct check for snapshot keys after longer wait
import { keys, get } from './lib/redis.js';

const raceId = '2026-01-07|tampa bay downs|1';
const pattern = `fl:predsnap:${raceId}:*`;

console.log('Checking pattern:', pattern);

try {
  const snapshotKeys = await keys(pattern);
  console.log(`Found ${snapshotKeys.length} keys`);
  
  if (snapshotKeys.length > 0) {
    for (const key of snapshotKeys) {
      console.log(`Key: ${key}`);
      const rawValue = await get(key);
      if (rawValue) {
        const snapshot = JSON.parse(rawValue);
        console.log(`  snapshot_asOf: ${snapshot.snapshot_asOf}`);
        console.log(`  snapshot_raceId: ${snapshot.snapshot_raceId}`);
        console.log(`  JSON length: ${JSON.stringify(snapshot).length} bytes`);
      }
    }
  } else {
    // Check all predsnap keys to see if any exist
    const allPredsnap = await keys('fl:predsnap:*');
    console.log(`Total fl:predsnap:* keys: ${allPredsnap.length}`);
    if (allPredsnap.length > 0) {
      console.log('Sample keys:');
      allPredsnap.slice(0, 5).forEach(k => console.log(`  ${k}`));
    }
  }
} catch (err) {
  console.error('Error:', err.message);
}

