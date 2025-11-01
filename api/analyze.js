import { scoreHorses } from './_openai.js';
import { tavilyLookup } from './research.js';

export const config = { runtime: 'nodejs' };

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
    // Always deep: fetch quick research if possible (time-boxed)
    const research = await tavilyLookup(horses, meta);

    const analysis = await scoreHorses({ horses, meta, research, accuracy: 'deep' });
    analysis.horseCount = horses.length;
    return res.status(200).json(analysis);

  } catch (err) {
    console.error('[API ERROR]', err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({ ok: false, error: String(err?.message || err || 'Analyze failed') });
  }
}
