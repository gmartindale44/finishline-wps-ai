export const config = { runtime: 'nodejs20.x' };

import { scoreHorses } from './_openai.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

    const { horses, meta } = req.body || {};

    if (!Array.isArray(horses) || horses.length === 0) return res.status(400).json({ error:'No horses provided' });

    const analysis = await scoreHorses({ horses, meta });

    // Attach normalized list so the client can correlate
    analysis.horseCount = horses.length;

    return res.status(200).json(analysis);

  } catch (e) {
    console.error('[analyze] error', e);
    return res.status(500).json({ error: e.message || 'Analyze failed' });
  }
}