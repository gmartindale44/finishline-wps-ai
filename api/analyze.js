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
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const { horses, meta } = req.body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: 'No horses provided' });
    }

    // Compute basic features per horse
    const features = horses.map(featuresForHorse).map(f => {
      // toy overall score (kept here so Predict can also recompute if needed)
      const score = clamp01(f.impliedProb + f.formBoost + f.jockeyBoost + f.trainerBoost);
      return { ...f, score };
    });

    return res.status(200).json({
      ok: true,
      meta: meta ?? null,
      features,
      // keep surface for debugging
      info: { count: features.length }
    });
  } catch (err) {
    console.error('[analyze] error:', err);
    return res.status(500).json({ error: 'Analyze failed' });
  }
};