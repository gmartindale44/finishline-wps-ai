const { featuresForHorse, clamp01 } = require('./_utils/odds');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') {
      console.error('[analyze] Wrong method:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // --- Safe parse for req.body ---
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch (err) { console.error('[analyze] Bad JSON:', err); return res.status(400).json({ error: 'Invalid JSON body' }); }
    }

    const { horses, meta } = body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      console.error('[analyze] Missing horses array:', body);
      return res.status(400).json({ error: 'No horses provided' });
    }

    // --- Compute features ---
    const features = horses.map(featuresForHorse).map(f => ({
      ...f,
      score: clamp01(f.impliedProb + f.formBoost + f.jockeyBoost + f.trainerBoost)
    }));

    console.log('[analyze] Computed features OK:', features.length);

    return res.status(200).json({
      ok: true,
      meta: meta ?? null,
      features,
      info: { count: features.length }
    });

  } catch (err) {
    console.error('[analyze] Internal error:', err);
    return res.status(500).json({ error: 'Analyze failed', details: err.message });
  }
};