import { featuresForHorse, clamp01 } from './_utils/odds.js';

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

    const features = horses.map(featuresForHorse).map(f => ({
      ...f,
      score: clamp01(f.impliedProb + f.formBoost + f.jockeyBoost + f.trainerBoost),
    }));

    console.log('[analyze] OK:', features.length);
    return res.status(200).json({ ok: true, meta: meta ?? null, features });

  } catch (err) {
    console.error('[analyze] Internal error:', err);
    return res.status(500).json({ error: 'Analyze failed', details: err.message });
  }
}