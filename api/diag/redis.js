export const config = { runtime: 'nodejs' };

import { ping } from '../../lib/redis.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      return res.status(200).json({
        ok: false,
        error: 'Redis not configured',
        detail: 'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN'
      });
    }
    
    try {
      const pingResult = await ping();
      return res.status(200).json({
        ok: true,
        url: url.replace(/\/[^/]+$/, '/***'), // Mask token part
        ping: pingResult
      });
    } catch (e) {
      return res.status(200).json({
        ok: false,
        error: e?.message || 'Redis ping failed',
        detail: String(e?.message || e)
      });
    }
  } catch (e) {
    return res.status(200).json({
      ok: false,
      error: 'Unexpected error',
      detail: String(e?.message || e)
    });
  }
}

