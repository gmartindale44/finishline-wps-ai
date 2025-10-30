function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const { horses = [], meta = {} } = req.body || {};

    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ ok:false, error:'No horses provided' });
    }

    const norm = (s) => (typeof s === 'string' ? s.trim() : s);

    const parseOdds = (val) => {
      if (val == null) return { raw: val, dec: null };
      const s = String(val).trim();
      const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m) return { raw:s, dec: (parseFloat(m[1]) / parseFloat(m[2])) };
      const n = Number(s);
      return isNaN(n) ? { raw:s, dec:null } : { raw:s, dec:n };
    };

    const cleanHorses = horses.map(h => ({
      name: norm(h.name),
      odds: parseOdds(h.odds || h.ml),
      jockey: norm(h.jockey),
      trainer: norm(h.trainer)
    })).filter(h => h.name);

    const missing = [];
    cleanHorses.forEach(h => {
      if (!h.odds || h.odds.dec == null) missing.push(`odds:${h.name}`);
      if (!h.jockey) missing.push(`jockey:${h.name}`);
      if (!h.trainer) missing.push(`trainer:${h.name}`);
    });

    const analysisId = Math.random().toString(36).slice(2,8);

    const payload = {
      horses: cleanHorses,
      meta: {
        surface: norm(meta.surface),
        distance: norm(meta.distance),
        track: norm(meta.track),
        date: norm(meta.date)
      },
      featuresVersion: 'v2'
    };

    return res.status(200).json({
      ok: true,
      analysisId,
      payload,
      missing,
      logs: [`horses:${cleanHorses.length}`, `missing:${missing.length}`]
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || 'Analyze failed' });
  }
}