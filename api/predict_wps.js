export const config = { runtime: 'nodejs' };

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

export default async function handler(req,res){
  setCors(res);
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const { lastAnalysis } = req.body || {};
    if(lastAnalysis?.picks){
      return res.status(200).json({ ok:true, ...lastAnalysis });
    }
    // Fallback: call analyze with the same payload if not provided
    const { horses, meta } = req.body || {};
    if(!Array.isArray(horses) || horses.length===0){
      return res.status(400).json({ error:'No horses provided' });
    }
    // Fallback: call analyze (self-reference - works on Vercel and local)
    const analyzeUrl = typeof window === 'undefined' && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/analyze`
      : '/api/analyze';
    const r = await fetch(analyzeUrl, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ horses, meta })
    });
    const j = await r.json();
    if(!r.ok) return res.status(r.status).json(j);
    return res.status(200).json({ ok:true, ...j });
  }catch(err){
    return res.status(500).json({ ok:false, error:String(err?.message||err) });
  }
}
