function impliedProbFromFraction(frac) {
  const m = String(frac || '').match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return 0;
  const a = Number(m[1]), b = Number(m[2]);
  if (!a || !b) return 0;
  return a / (a + b);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      return res.json({ ok: false, error: 'Method not allowed' });
    }
    const { horses = [], meta = {}, features = null } = req.body || {};
    const scored = horses
      .map(h => ({ ...h, p: impliedProbFromFraction(h.odds) }))
      .sort((a, b) => b.p - a.p);

    const [win, place, show] = [scored[0], scored[1], scored[2]].filter(Boolean);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.json({ ok: true, win: win || null, place: place || null, show: show || null });
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.json({ ok: false, error: String(e?.message || e) });
  }
};
