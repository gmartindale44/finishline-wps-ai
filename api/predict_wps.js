function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function scoreFeature(f){
  //  higher impliedProb, lower normOdds, positive priors/postBias => better
  const s = 0.55*f.impliedProb + 0.25*(-f.normOdds) + 0.1*f.postBias + 0.05*f.trainerPrior + 0.05*f.jockeyPrior;
  return s;
}

function rankOnce(features){
  const arr = features.map(f=>({name:f.name, base:scoreFeature(f), f}));
  // tie-break by small random to avoid deterministic ties
  arr.sort((a,b)=> (b.base - a.base) || (Math.random()-0.5)*0.0001);
  return arr.map(x=>x.name);
}

function bordaConsensus(rankings){
  const scores = new Map();
  const n = rankings[0]?.length||0;
  for (const r of rankings){
    r.forEach((name, idx)=>{
      const pts = n-idx;
      scores.set(name, (scores.get(name)||0)+pts);
    });
  }
  return [...scores.entries()].sort((a,b)=>b[1]-a[1]).map(([name])=>name);
}

export default async function handler(req, res){
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try{
    const { analysis } = req.body || {};
    if (!analysis?.features?.length) return res.status(400).json({error:'No analysis given'});

    const feats = analysis.features;

    // "3-sample" ensemble (we'll still use deterministic scoring; the sampling is the tie-break jitter)
    const r1 = rankOnce(feats);
    const r2 = rankOnce(feats);
    const r3 = rankOnce(feats);

    const consensus = bordaConsensus([r1,r2,r3]);
    const top = consensus.slice(0,5);

    // Estimate agreement: average of top-3 overlaps
    const overlap =
      ( [r1,r2,r3].map(r=>{
          const set = new Set(r.slice(0,3));
          let m=0; for(const n of consensus.slice(0,3)) if(set.has(n)) m++;
          return m/3;
        }).reduce((a,b)=>a+b,0) / 3 );

    const confidence = Math.max(0.10, Math.min(0.98, 0.60 + 0.40*overlap));

    // W/P/S
    const win = top[0] || feats[0].name;
    const place = top[1] || feats[1]?.name || top[0];
    const show = top[2] || feats[2]?.name || top[1];

    return res.status(200).json({
      win, place, show,
      confidence,
      picks: top,
      meta: { ok:true }
    });

  }catch(e){
    console.error('[predict_wps] error:', e);
    return res.status(500).json({error:String(e?.message||e)});
  }
}