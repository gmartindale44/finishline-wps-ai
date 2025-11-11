import { Redis } from '@upstash/redis';

const RECON_LIST = 'reconciliations:v1';

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error('[export_reconciliations] Failed to init Redis client', error);
      redisClient = null;
    }
  }
  return redisClient;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const redis = getRedis();
    if (!redis) {
      return res.status(503).json({ error: 'redis_unavailable' });
    }

    const rows = await redis.lrange(RECON_LIST, 0, -1);
    const parsed = (rows || []).map((entry) => {
      try { return JSON.parse(entry); } catch { return null; }
    }).filter(Boolean);

    const header = ['ts','date','track','raceNo','query','topTitle','topUrl'];
    const lines = [header.join(',')];

    for (const r of parsed) {
      lines.push([
        r.ts ?? '',
        r.date ?? '',
        JSON.stringify(r.track ?? ''),
        r.raceNo ?? '',
        JSON.stringify(r.query ?? ''),
        JSON.stringify(r.top?.title ?? ''),
        JSON.stringify(r.top?.link ?? ''),
      ].join(','));
    }

    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reconciliations_v1.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[export_reconciliations] failed', error);
    return res.status(500).json({ error: 'export_failed', details: error?.message || String(error) });
  }
}
