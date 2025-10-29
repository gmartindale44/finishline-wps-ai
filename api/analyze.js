import { parseMlOdds, extractSpeedFig } from './_utils/odds.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') {
      console.error('[analyze] Wrong method:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch (err) {
        console.error('[analyze] Bad JSON:', err);
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const { horses, meta } = body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      console.error('[analyze] Missing horses array:', body);
      return res.status(400).json({ error: 'No horses provided' });
    }

    // Process horses: parse odds, extract speed figures, normalize
    const processed = horses.map(h => {
      const name = String(h?.name || '').trim();
      const oddsML = String(h?.odds || h?.ml_odds || h?.oddsML || '').trim();
      const oddsNum = parseMlOdds(oddsML);
      
      // Try to extract speed figure from name field or a combined field
      // Look for patterns like "(108*)" after horse names
      const rawText = String(h?.name || '') + ' ' + String(h?.raw || '');
      const speedFig = extractSpeedFig(rawText) || extractSpeedFig(h?.speedFig) || extractSpeedFig(String(h?.name || '')) || null;

      return {
        name,
        oddsML: oddsML || null,
        oddsNum: oddsNum,
        jockey: String(h?.jockey || '').trim() || null,
        trainer: String(h?.trainer || '').trim() || null,
        speedFig: speedFig,
      };
    }).filter(h => h.name); // Remove entries without names

    const source = meta?.source || 'ocr';
    const cardHash = meta?.cardHash || null;

    console.log('[analyze] Processed:', processed.length, 'horses');
    return res.status(200).json({
      horses: processed,
      meta: {
        source: source === 'manual' ? 'manual' : 'ocr',
        cardHash: cardHash || undefined,
      },
    });

  } catch (err) {
    console.error('[analyze] Internal error:', err);
    return res.status(500).json({ error: 'Analyze failed', details: err.message });
  }
}