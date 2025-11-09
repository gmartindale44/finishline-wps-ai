export const config = { runtime: 'nodejs' };

import { hset } from '../lib/redis.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const { race_key, status = 'archived' } = req.body || {};

    if (!race_key) {
      return res.status(400).json({ ok: false, error: 'missing_race_key' });
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      return res.status(200).json({ ok: false, error: 'redis_not_configured' });
    }

    // Update the race key with archived status
    await hset(race_key, {
      status,
      archived_ts: String(Date.now())
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      error: 'close_failed',
      message: String(e?.message || e)
    });
  }
}

