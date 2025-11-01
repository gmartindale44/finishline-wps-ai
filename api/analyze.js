import { scoreHorses } from './_openai.js';

export const config = { runtime: 'nodejs' };

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

export default async function handler(req, res){
  setCors(res);
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const { horses, meta } = req.body || {};
    if(!Array.isArray(horses) || horses.length===0){
      return res.status(400).json({ error:'No horses provided' });
    }

    // Fetch researched factors (self-reference - works on Vercel and local)
    const factorsUrl = typeof window === 'undefined' && process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/api/factors`
      : '/api/factors';
    const r = await fetch(factorsUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ horses, meta })
    });
    if(!r.ok){
      const msg = await r.text();
      return res.status(502).json({ error:`Factors API failed: ${String(msg).slice(0,200)}` });
    }
    const factors = await r.json();
    const map = new Map();
    for(const item of (factors?.results||[])){
      map.set(item.name, item.factors || {});
    }

    const analysis = await scoreHorses({ horses, meta, factorsMap: map });
    analysis.horseCount = horses.length;
    analysis.meta = meta||{};

    return res.status(200).json(analysis);
  }catch(err){
    console.error('[API ERROR analyze]', err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({ ok:false, error:String(err?.message||err) });
  }
}
