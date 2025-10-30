function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
const clamp = (x,min,max)=>Math.max(min,Math.min(max,x));

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const { payload } = req.body || {};

    if (!payload || !Array.isArray(payload.horses) || payload.horses.length === 0) {
      return res.status(400).json({ ok:false, error:'No horses provided' });
    }

    const horses = payload.horses;

    // Stage A: base score
    const base = horses.map((h, idx) => {
      const oddsScore = (h.odds?.dec != null) ? (1 / (1 + h.odds.dec)) : 0.35;
      const jockeyBonus = h.jockey ? 0.05 : 0.0;
      const trainerBonus = h.trainer ? 0.05 : 0.0;
      const metaAdj = (() => {
        let m = 0;
        if (payload.meta?.surface) m += 0.02;
        if (payload.meta?.distance) m += 0.02;
        return m;
      })();

      const score = clamp(oddsScore + jockeyBonus + trainerBonus + metaAdj, 0, 1);
      return { idx, name:h.name, score };
    });

    base.sort((a,b)=>b.score-a.score);
    const topN = base.slice(0, Math.min(base.length, 8));

    // Stage B: pairwise tie-breaking
    for (let i=0; i<topN.length; i++){
      for (let j=i+1; j<topN.length; j++){
        const a = topN[i], b = topN[j];
        const delta = (a.score - b.score);
        if (Math.abs(delta) < 0.02) {
          const tie = (a.name.localeCompare(b.name) < 0) ? 0.005 : -0.005;
          a.score += tie; b.score -= tie;
        }
      }
    }

    topN.sort((a,b)=>b.score-a.score);

    // Stage C: ensemble bootstrap
    const K = 32;
    const tallies = new Map();

    function bump(name, slot){
      tallies.set(name, (tallies.get(name)||{win:0,place:0,show:0,score:0,seen:0}));
      const t=tallies.get(name);
      t[slot]++;
      t.seen++;
      t.score += (slot==='win'?3:slot==='place'?2:1);
    }

    for (let k=0;k<K;k++){
      const noise = 0.02 * (Math.random()-0.5);
      const bag = topN.map(o => ({...o, s:o.score + noise * (Math.random()-0.5)})).sort((a,b)=>b.s-a.s);
      const win = bag[0]?.name, place = bag[1]?.name, show = bag[2]?.name;
      if (win) bump(win,'win');
      if (place) bump(place,'place');
      if (show) bump(show,'show');
      if ((k % 8) === 0) await sleep(60);
    }

    const ranked = [...tallies.entries()]
      .map(([name, t]) => ({ name, score: t.score, win:t.win, place:t.place, show:t.show }))
      .sort((a,b)=>b.score-a.score);

    const picks = {
      win: ranked[0]?.name || topN[0]?.name || horses[0].name,
      place: ranked[1]?.name || topN[1]?.name || horses[1]?.name,
      show: ranked[2]?.name || topN[2]?.name || horses[2]?.name,
    };

    const confidence = clamp(ranked[0] ? (ranked[0].score / (3*K)) : 0.15, 0.05, 0.95);

    return res.status(200).json({
      ok: true,
      picks,
      confidence,
      meta: { nHorses: horses.length, featuresVersion: payload.featuresVersion || 'v2' },
      notes: ['ranker','pairwise','bootstrap']
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || 'Predict failed' });
  }
}