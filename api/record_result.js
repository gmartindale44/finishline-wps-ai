export const config = { runtime: 'nodejs' };

import { hset } from '../lib/redis.js';
import { slugRaceId, parseROI } from '../lib/normalize.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    
    const body = req.body || {};
    let { race_id, track, date, postTime, raceNo, result, roi_percent, notes } = body;
    
    // Compute race_id if missing
    if (!race_id) {
      race_id = slugRaceId({ track, date, postTime, raceNo });
    }
    
    if (!race_id) {
      return res.status(200).json({
        ok: false,
        error: 'race_id required',
        detail: 'Provide race_id or track/date/postTime/raceNo'
      });
    }
    
    // Normalize result to one of Hit|Partial|Miss
    const normalizedResult = (result || 'Miss')
      .trim()
      .toLowerCase()
      .replace(/^(hit|partial|miss).*$/i, (_, m) => m.charAt(0).toUpperCase() + m.slice(1));
    
    const finalResult = ['Hit', 'Partial', 'Miss'].includes(normalizedResult)
      ? normalizedResult
      : 'Miss';
    
    // Parse ROI
    const parsedROI = parseROI(roi_percent);
    
    const log_key = `fl:pred:${race_id}`;
    
    await hset(log_key, {
      status: 'resolved',
      resolved_ts: String(Date.now()),
      result: finalResult,
      roi_percent: parsedROI !== null ? String(parsedROI) : '',
      notes: notes || ''
    });
    
    return res.status(200).json({ ok: true, race_id });
  } catch (e) {
    const errorMsg = e?.message || String(e);
    const isRedisError = errorMsg.includes('redis_unreachable');
    
    return res.status(200).json({
      ok: false,
      error: isRedisError ? 'Redis unavailable' : 'Failed to record result',
      detail: errorMsg
    });
  }
}
