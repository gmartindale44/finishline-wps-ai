import { get } from './lib/redis.js';

const verifyKey = 'fl:verify:2026-01-07|tampa bay downs|1';
try {
  const rawValue = await get(verifyKey);
  if (rawValue) {
    const verifyLog = JSON.parse(rawValue);
    console.log(JSON.stringify({
      found: true,
      predsnap_asOf: verifyLog.predsnap_asOf || null,
      hasPredmeta: !!verifyLog.predmeta,
      debug: verifyLog.debug || null
    }, null, 2));
  } else {
    console.log(JSON.stringify({ found: false }));
  }
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}