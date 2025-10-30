function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { meta, horses } = req.body || {};
    if (!horses || !horses.length) return res.status(400).json({error:'No horses'});

    // Basic parse helpers
    const toDecOdds = (oddsStr)=>{
      // expects like '5/2', '8/1', or '10/1'. Fallback 10/1.
      const m = String(oddsStr||'').match(/(\d+)\s*\/\s*(\d+)/);
      if (!m) return 11.0;
      const num = parseFloat(m[1]), den = parseFloat(m[2]||1);
      // US fractional to decimal: dec = (num/den) + 1
      return (den>0 ? (num/den)+1 : 11.0);
    };

    const decs = horses.map(h=>toDecOdds(h.odds || h.ml));
    const implied = decs.map(d=>1/Math.max(1e-6,d));
    const mean = implied.reduce((a,b)=>a+b,0)/implied.length;
    const sd = Math.sqrt(implied.map(x=>(x-mean)**2).reduce((a,b)=>a+b,0)/Math.max(1,implied.length-1));

    const surface = (meta?.surface||'').toLowerCase().includes('dirt') ? [1,0,0] :
                    (meta?.surface||'').toLowerCase().includes('turf') ? [0,1,0] : [0,0,1];
    const distanceBucket = (()=>{ // very coarse buckets
      const s = String(meta?.distance||'');
      const m = s.match(/([\d.]+)/); const miles = m? parseFloat(m[1]) : 1.0;
      if (miles < 1.0) return 0;
      if (miles < 1.25) return 1;
      if (miles < 1.5) return 2;
      return 3;
    })();

    // Stable pseudo-priors from names (no external API).
    const priorFromName = (s)=>{
      const str = String(s||'');
      let h=0; for (let i=0;i<str.length;i++){ h=(h*31 + str.charCodeAt(i))|0; }
      // map hash -> [-0.05, +0.05]
      return ((h % 1000)/1000 - 0.5)*0.10;
    };

    const features = horses.map((h,idx)=>{
      const d = decs[idx];
      const ip = implied[idx];
      const norm = sd>0 ? (ip-mean)/sd : 0;
      const postBias = (idx / Math.max(1, horses.length-1)) * 0.12 - 0.06; // center at 0

      return {
        name: h.name || '', odds: h.odds || h.ml || '', jockey: h.jockey || '', trainer: h.trainer || '', post: idx+1,
        impliedProb: ip, normOdds: norm, postBias,
        surfaceVec: surface, distanceBucket,
        trainerPrior: priorFromName(h.trainer), jockeyPrior: priorFromName(h.jockey),
        note: `${h.name} @ ${h.odds||h.ml||'N/A'} (j:${h.jockey||'N/A'}, t:${h.trainer||'N/A'})`
      };
    });

    // Return analysis package
    return res.status(200).json({
      meta: { surface: meta?.surface||'', distance: meta?.distance||'', track: meta?.track||'' },
      count: features.length,
      features
    });

  } catch(e){
    console.error('[analyze] error:', e);
    return res.status(500).json({error:String(e?.message||e)});
  }
}