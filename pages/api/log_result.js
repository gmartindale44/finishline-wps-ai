export const config = { runtime: 'nodejs' };

import fs from 'fs';
import path from 'path';
import { redisPushSafe, dayKey } from '../../lib/redis.js';

const CSV_PATH = path.join(process.cwd(), 'data', 'finishline_tests_v1.csv');
const CSV_HEADERS = 'Test_ID,Track,Race_No,Surface,Distance,Confidence,Top_3_Mass,AI_Picks,Strategy,Result,ROI_Percent,WinRate,Notes';

function ensureCSVExists() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
    fs.writeFileSync(CSV_PATH, CSV_HEADERS + '\n', 'utf8');
  }
}

function appendCSVRow(payload) {
  ensureCSVExists();
  
  const row = [
    '', // Test_ID (blank)
    payload.track || '',
    payload.race_no || '', // Race_No (blank if not provided)
    payload.surface || '',
    payload.distance || '',
    String(payload.confidence ?? ''),
    String(payload.top3_mass ?? ''),
    `"${payload.picks || ''}"`, // AI_Picks (quoted)
    `"${payload.strategy || ''}"`, // Strategy (quoted)
    payload.result || '',
    String(payload.roi_percent ?? ''),
    '', // WinRate (blank)
    `"${payload.notes || ''}"` // Notes (quoted, optional)
  ];
  
  fs.appendFileSync(CSV_PATH, row.join(',') + '\n', 'utf8');
}

export default async function handler(req, res) {
  // Always return JSON
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  
  try {
    const body = req.body || {};
    
    // Minimal validation
    if (!body.track || !body.picks || !body.result) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: track, picks, result' });
    }
    
    const payload = {
      ts: Date.now(),
      track: body.track,
      surface: body.surface || '',
      distance: body.distance || '',
      picks: body.picks,
      confidence: typeof body.confidence === 'number' ? body.confidence : parseFloat(body.confidence) || null,
      top3_mass: typeof body.top3_mass === 'number' ? body.top3_mass : parseFloat(body.top3_mass) || null,
      strategy: body.strategy || '',
      result: body.result,
      roi_percent: typeof body.roi_percent === 'number' ? body.roi_percent : parseFloat(String(body.roi_percent || '0').replace('+', '')) || 0,
      notes: body.notes || '',
      race_no: body.race_no || ''
    };
    
    // Append to Redis (fire-and-forget, no-op if disabled)
    const redisKey = dayKey('fl:results');
    await redisPushSafe(redisKey, payload);
    
    // Append to CSV
    try {
      appendCSVRow(payload);
    } catch (csvErr) {
      console.error('[log_result] CSV write error:', csvErr);
      // Continue even if CSV fails
    }
    
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[log_result] Error:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

