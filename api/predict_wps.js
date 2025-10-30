export const config = { runtime: 'nodejs20.x' };

import { chooseWPS } from './_openai.js';

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

    const { horses, meta, analysis } = req.body || {};

    if (!Array.isArray(horses) || horses.length === 0) return res.status(400).json({ error:'No horses provided' });

    if (!analysis) return res.status(400).json({ error:'No analysis attached' });

    const picks = await chooseWPS({ analysis, horses, meta });

    return res.status(200).json(picks);

  } catch (e) {
    console.error('[predict_wps] error', e);
    return res.status(500).json({ error: e.message || 'Predict failed' });
  }
}