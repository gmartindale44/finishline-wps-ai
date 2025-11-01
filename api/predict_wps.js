import { scoreHorses, finalizeWPS } from './_openai.js';
import { tavilyLookup } from './research.js';

export const config = { runtime: 'nodejs' };

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

export default async function handler(req,res){
  setCors(res);
  if(req.method==='OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
    const { horses, meta, mode = {} } = req.body || {};

    if (!Array.isArray(horses) || horses.length === 0) return res.status(400).json({ error:'No horses provided' });

    // Always deep: use mode.deep and mode.consensus_passes if provided
    const deepMode = { deep: mode.deep !== false, consensus_passes: mode.consensus_passes || 3 };
    
    const research = await tavilyLookup(horses, meta);
    const analysis = await scoreHorses({ horses, meta, research, accuracy: 'deep', mode: deepMode });
    const picks = await finalizeWPS({ scores: analysis.scores || [] });
    return res.status(200).json({ 
      win: picks.win, 
      place: picks.place, 
      show: picks.show, 
      confidence: picks.confidence, 
      consensus: analysis.consensus 
    });

  } catch (err) {
    console.error('[API ERROR]', err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({ ok: false, error: String(err?.message || err || 'Predict failed') });
  }
}
