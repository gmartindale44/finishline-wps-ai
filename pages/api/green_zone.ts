import type { NextApiRequest, NextApiResponse } from 'next';
import { Redis } from '@upstash/redis';
import { scoreGreenZone } from '../../lib/greenZone';

let redisClient: Redis | null = null;
function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error('[green_zone] Failed to init Redis client', error);
      redisClient = null;
    }
  }
  return redisClient;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Server-side PayGate check (non-blocking in monitor mode)
  try {
    const { checkPayGateAccess } = await import('../../lib/paygate-server.js');
    const accessCheck = checkPayGateAccess(req);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        ok: false,
        error: 'PayGate locked',
        message: 'Premium access required. Please unlock to continue.',
        code: 'paygate_locked',
        reason: accessCheck.reason
      });
    }
  } catch (paygateErr) {
    // Non-fatal: log but allow request (fail-open for safety)
    console.warn('[green_zone] PayGate check failed (non-fatal):', paygateErr?.message);
  }

  try {
    const { signals = {}, track = '', date = '', raceNo = '' } = req.body || {};
    const parsedSignals = {
      confidence: Number(signals.confidence ?? signals.confidencePercent ?? 0) || 0,
      top3Mass: Number(signals.top3Mass ?? signals.mass ?? 0) || 0,
      gap12: Number(signals.gap12 ?? 0) || 0,
      gap23: Number(signals.gap23 ?? 0) || 0,
    };

    const greenZone = scoreGreenZone(parsedSignals);

    const redis = getRedis();
    if (redis) {
      try {
        await redis.rpush('greenZone:v1', JSON.stringify({
          ts: Date.now(),
          track,
          date,
          raceNo,
          signals: parsedSignals,
          greenZone,
        }));
        await redis.ltrim('greenZone:v1', -2000, -1);
      } catch (error) {
        console.error('[green_zone] Redis log failed', error);
      }
    }

    const upcoming: any[] = [];

    return res.status(200).json({ ok: true, greenZone, upcoming });
  } catch (error: any) {
    console.error('[green_zone] handler failed', error);
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
