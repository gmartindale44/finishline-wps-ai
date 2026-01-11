// Check if snapshot exists in Redis
import { keys, get } from './lib/redis.js';

const raceId = '2026-01-06|gulfstream park|8';
const pattern = `fl:predsnap:${raceId}:*`;

try {
  const snapshotKeys = await keys(pattern);
  console.log(`Found ${snapshotKeys.length} snapshot(s) for raceId: ${raceId}`);
  
  if (snapshotKeys.length > 0) {
    // Sort by timestamp (newest first)
    const sorted = snapshotKeys.sort().reverse();
    const newestKey = sorted[0];
    console.log(`Newest snapshot key: ${newestKey}`);
    
    const rawValue = await get(newestKey);
    if (rawValue) {
      const snapshot = JSON.parse(rawValue);
      console.log('\nSnapshot excerpt:');
      console.log('  meta.asOf:', snapshot.meta?.asOf);
      console.log('  meta.raceId:', snapshot.meta?.raceId);
      console.log('  picks[0]:', snapshot.picks?.[0]?.name);
      console.log('  picks[1]:', snapshot.picks?.[1]?.name);
      console.log('  picks[2]:', snapshot.picks?.[2]?.name);
      console.log('  confidence:', snapshot.confidence);
      console.log('  top3_mass:', snapshot.top3_mass);
    }
  } else {
    console.log('No snapshots found (snapshot storage may not be enabled or Redis write failed)');
  }
} catch (err) {
  console.error('Error checking snapshots:', err.message);
}

