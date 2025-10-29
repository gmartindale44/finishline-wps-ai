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
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch (err) { return res.status(400).json({ error: 'Invalid JSON' }); }
    }

    const { horses, Lightning, features } = body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: 'No horses provided' });
    }

    const feats = Array.isArray(features) && features.length === horses.length
      ? features
      : horses.map(featuresForHorse).map(f => ({ ...f, score: clamp01(f.impliedProb + f.formBoost + f.jockeyBoost + f.trainerBoost) }));

    const ranked = [...feats].sort((a,b) =>
      (b.score - a.score) || (b.impliedProb - a.impliedProb) || a.name.localeCompare(b.name)
    );

    const picks = {
      win: ranked[0] ?? null,
      place: ranked[1] ?? null,
      show: ranked[2] ?? null,
    };

    const top = ranked.slice(0, 5).map((r, i) => ({
      rank: i+1, name: r.name, mlOdds: r.mlOdds,
      score: +r.score.toFixed(4),
      impliedProb: +r.impliedProb.toFixed(4),
    }));

    const margin = ranked.length > 1 ? Math.max(0, ranked[0].score - ranked[1].score) : ranked[0]?.score ?? 0;
    const confidence = +Math.min(1, margin * 4).toFixed(3);

    return res.status(200).json({ ok: true, meta: meta ?? null, picks, top, confidence });

  } catch (err) {
    console.error('[predict_wps] error:', err);
    return res.status(500).json({ error: 'Prediction failed', details: err.message });
  }
}