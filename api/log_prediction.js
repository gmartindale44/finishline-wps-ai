export const config = { runtime: 'nodejs' };

import { hset } from '../lib/redis.js';
import { slugRaceId } from '../lib/normalize.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    
    const body = req.body || {};
    const { track, date, postTime, raceNo, picks, confidence, top3_mass, strategy } = body;
    
    // Build race_id using slugifier
    const race_id = slugRaceId({ track, date, postTime, raceNo });
    
    const log_key = `fl:pred:${race_id}`;
    
    const payload = {
      race_id,
      track: track || '',
      date: date || '',
      postTime: postTime || '',
      raceNo: String(raceNo || ''),
      picks: JSON.stringify(picks || {}),
      confidence: String(confidence ?? ''),
      top3_mass: String(top3_mass ?? ''),
      strategy: strategy || '',
      status: 'pending',
      created_ts: String(Date.now()),
      result: '',
      roi_percent: '',
      notes: ''
    };
    
    await hset(log_key, payload);
    
    return res.status(200).json({ ok: true, race_id });
  } catch (e) {
    const errorMsg = e?.message || String(e);
    const isRedisError = errorMsg.includes('redis_unreachable');
    
    return res.status(200).json({
      ok: false,
      error: isRedisError ? 'Redis unavailable' : 'Failed to log prediction',
      detail: errorMsg
    });
  }
}
