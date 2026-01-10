import { keys, get } from './lib/redis.js';

const pattern = 'fl:predsnap:2026-01-07|tampa bay downs|1:*';
try {
  const snapshotKeys = await keys(pattern);
  console.log(JSON.stringify({
    count: snapshotKeys.length,
    keys: snapshotKeys
  }));
  
  if (snapshotKeys.length > 0) {
    const newestKey = snapshotKeys.sort().reverse()[0];
    const rawValue = await get(newestKey);
    if (rawValue) {
      const snapshot = JSON.parse(rawValue);
      console.log(JSON.stringify({
        key: newestKey,
        snapshotLength: JSON.stringify(snapshot).length,
        hasMeta: !!snapshot.meta,
        hasPicks: !!snapshot.picks,
        snapshot_asOf: snapshot.snapshot_asOf,
        snapshot_raceId: snapshot.snapshot_raceId
      }));
    }
  }
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}