export const config = { runtime: 'nodejs' };

import { getRedis } from '../../lib/redis.js';

export default async function handler(_req, res) {
  try {
    const redis = await getRedis();
    if (!redis) {
      return res.status(200).json({ ok: true, redis: 'disabled', ts: Date.now() });
    }
    
    try {
      await redis.ping();
      return res.status(200).json({ ok: true, redis: 'connected', ts: Date.now() });
    } catch (e) {
      return res.status(200).json({ ok: true, redis: 'error', ts: Date.now(), error: String(e?.message || e) });
    }
  } catch (e) {
    return res.status(200).json({ ok: true, redis: 'disabled', ts: Date.now(), error: String(e?.message || e) });
  }
}

