module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.json({ ok: false, error: 'Method not allowed' });
    }
    const { horses = [], meta = {} } = req.body || {};
    const seen = new Set();
    const out = [];
    for (const h of horses) {
      const key = (h?.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: (h.name || '').trim(),
        odds: (h.odds || '').trim(),
        jockey: (h.jockey || '').trim(),
        trainer: (h.trainer || '').trim(),
      });
    }
    // Return normalized horses + optional analysis features
    const features = {
      count: out.length,
      meta: meta || {},
      processed: Date.now()
    };
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.json({ ok: true, horses: out, features });
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.json({ ok: false, error: String(e?.message || e) });
  }
};
