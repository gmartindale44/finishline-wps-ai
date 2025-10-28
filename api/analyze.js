module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.json({ ok: false, error: 'Method not allowed' });
    }
    const { horses = [] } = req.body || {};
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
    res.statusCode = 200;
    return res.json({ ok: true, horses: out });
  } catch (e) {
    res.statusCode = 500;
    return res.json({ ok: false, error: String(e?.message || e) });
  }
};
