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

    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: 'No horses provided', code: 'NO_HORSES' });
    }

    // Validate minimum count
    if (horses.length < 3) {
      return res.status(400).json({ error: 'Need at least 3 horses to predict', code: 'NEED_MORE_HORSES', count: horses.length });
    }

    // Filter out invalid horses (missing name or odds)
    const validHorses = horses.filter(h => {
      const name = String(h?.name || '').trim();
      const odds = String(h?.odds || '').trim();
      return name.length > 1 && odds.length > 0;
    });

    const dropped = horses.length - validHorses.length;
    
    if (validHorses.length < 3) {
      return res.status(400).json({ 
        error: `Only ${validHorses.length} valid horses found (need 3). ${dropped > 0 ? `${dropped} invalid entries dropped.` : ''}`, 
        code: 'NEED_MORE_HORSES',
        validCount: validHorses.length,
        droppedCount: dropped,
      });
    }

    // Log dropped count for diagnostics
    if (dropped > 0) {
      console.log(`[predict_wps] Dropped ${dropped} invalid horses`);
    }

    // Always deep: use mode.deep and mode.consensus_passes if provided
    const deepMode = { deep: mode.deep !== false, consensus_passes: mode.consensus_passes || 3 };
    
    const research = await tavilyLookup(validHorses, meta);
    const analysis = await scoreHorses({ horses: validHorses, meta, research, accuracy: 'deep', mode: deepMode });
    const picks = await finalizeWPS({ scores: analysis.scores || [] });
    
    // Validate picks are not null
    if (!picks.win || !picks.place || !picks.show) {
      console.error('[predict_wps] Picks are null:', picks);
      return res.status(500).json({ 
        error: 'Prediction failed: model returned null picks', 
        code: 'NULL_PICKS',
        analysis,
      });
    }

    return res.status(200).json({ 
      win: picks.win, 
      place: picks.place, 
      show: picks.show, 
      confidence: typeof picks.confidence === 'number' ? picks.confidence : 0, 
      consensus: analysis.consensus,
      validCount: validHorses.length,
      droppedCount: dropped,
    });

  } catch (err) {
    console.error('[API ERROR]', err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({ ok: false, error: String(err?.message || err || 'Predict failed') });
  }
}
