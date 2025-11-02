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
    const { horses, meta, mode = {} } = req.body || {};

    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: 'No horses provided', code: 'NO_HORSES' });
    }

    // Normalize horses to canonical format (handle OCR variations)
    const normalizedHorses = horses.map(h => {
      if (!h || typeof h !== 'object') return null;
      const lower = {};
      for (const [k, v] of Object.entries(h)) {
        lower[k.toLowerCase()] = v;
      }
      return {
        name: String(lower.name || lower.horse || lower.runner || '').trim(),
        odds: String(lower.odds || lower.ml_odds || lower.price || lower.odd || '').trim(),
        jockey: String(lower.jockey || lower.rider || lower.j || '').trim(),
        trainer: String(lower.trainer || lower.trainer_name || lower.t || '').trim(),
      };
    }).filter(h => h && h.name && h.name.length > 1);

    if (normalizedHorses.length === 0) {
      return res.status(400).json({ error: 'No valid horses found after normalization', code: 'NO_VALID_HORSES' });
    }
    
    // Always deep: use mode.deep and mode.consensus_passes if provided, else default to deep:true, passes:3
    const deepMode = { deep: mode.deep !== false, consensus_passes: mode.consensus_passes || 3 };
    
    // Fetch quick research if possible (time-boxed)
    const research = await tavilyLookup(normalizedHorses, meta);

    const analysis = await scoreHorses({ horses: normalizedHorses, meta, research, accuracy: 'deep', mode: deepMode });
    analysis.horseCount = normalizedHorses.length;
    analysis.meta = analysis.meta || {};
    analysis.meta.track = meta?.track || '';
    analysis.meta.surface = meta?.surface || '';
    analysis.meta.distance = meta?.distance || '';
    
    // Return stable JSON shape with normalized horses
    return res.status(200).json({
      horses: normalizedHorses,
      meta: analysis.meta,
      scores: analysis.scores || [],
      consensus: analysis.consensus,
      horseCount: normalizedHorses.length,
      source: 'ocr',
    });

  } catch (err) {
    console.error('[API ERROR]', err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({ ok: false, error: String(err?.message || err || 'Analyze failed') });
  }
}
