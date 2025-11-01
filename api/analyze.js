import { scoreHorses } from './_openai.js';
import { tavilyLookup } from './research.js';

export const config = { runtime: 'nodejs18.x' };

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
    const { horses, meta, mode = {} } = req.body || {};

    if (!Array.isArray(horses) || horses.length === 0) return res.status(400).json({ error:'No horses provided' });
    
    // Always deep: use mode.deep and mode.consensus_passes if provided, else default to deep:true, passes:3
    const deepMode = { deep: mode.deep !== false, consensus_passes: mode.consensus_passes || 3 };
    
    // Fetch quick research if possible (time-boxed)
    const research = await tavilyLookup(horses, meta);

    const analysis = await scoreHorses({ horses, meta, research, accuracy: 'deep', mode: deepMode });
    analysis.horseCount = horses.length;
    analysis.meta = analysis.meta || {};
    analysis.meta.track = meta?.track || '';
    analysis.meta.surface = meta?.surface || '';
    analysis.meta.distance = meta?.distance || '';
    return res.status(200).json(analysis);

  } catch (err) {
    console.error('[API ERROR]', err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({ ok: false, error: String(err?.message || err || 'Analyze failed') });
  }
}
