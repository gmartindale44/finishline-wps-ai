import { resolveOpenAIKey } from './_openai.js';

export const config = { runtime: 'nodejs' };

// Basic CORS
function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

const TAVILY_KEY = process.env.FINISHLINE_TAVLY_API_KEY || process.env.TAVILY_API_KEY;
const PROVIDER_TIMEOUT_MS = Number(process.env.FINISHLINE_PROVIDER_TIMEOUT_MS ?? 12000);
const CACHE_SEC = Number(process.env.FINISHLINE_PROVIDER_CACHE_SEC ?? 600);

// Simple in-memory cache (Vercel ephemeral per lambda)
const memCache = new Map();
const hitCache = (k) => {
  const v = memCache.get(k);
  if(!v) return null;
  if(Date.now() > v.exp) { memCache.delete(k); return null; }
  return v.data;
};
const putCache = (k,data,sec=CACHE_SEC)=>memCache.set(k,{data,exp:Date.now()+sec*1000});

async function tavilySearch(q){
  if(!TAVILY_KEY) return { results: [] };
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try{
    const r = await fetch('https://api.tavily.com/search', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${TAVILY_KEY}`},
      body: JSON.stringify({
        query:q,
        max_results:5,
        include_answer:false,
        include_raw_content:true
      }),
      signal: ctrl.signal
    });
    const j = await r.json().catch(()=>({results:[]}));
    return j;
  }finally{ clearTimeout(t); }
}

async function extractStructured(openaiKey, text, horse, meta){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try{
    const r = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${openaiKey}`},
      body: JSON.stringify({
        model: process.env.FINISHLINE_OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        response_format:{ type:'json_object' },
        messages:[
          {role:'system', content:
            "You extract horse racing stats as strict JSON. If missing, infer conservatively or set null."},
          {role:'user', content: `Horse: ${horse.name}
Track: ${meta?.track||''} | Distance: ${meta?.distance||''} | Surface: ${meta?.surface||''}
Text corpus:
${text}

Return JSON with keys:
{
 "trainer_win_pct": number|null,   // 0-100
 "jockey_win_pct": number|null,    // 0-100
 "last3_finishes": [number|null, number|null, number|null], // 1=win, 2=place, 3=show, or finishing positions; null if unknown
 "distance_record": {"starts":number|null,"wins":number|null,"places":number|null,"shows":number|null},
 "surface_record":  {"starts":number|null,"wins":number|null,"places":number|null,"shows":number|null},
 "post_bias": {"favors_inside":boolean|null,"favors_outside":boolean|null,"note":string|null}
}`}
        ]
      }),
      signal: ctrl.signal
    });
    if(!r.ok){
      const msg = await r.text();
      return { ok:false, error: `OpenAI factors error: ${String(msg).slice(0,200)}` };
    }
    const j = await r.json();
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    return { ok:true, data: parsed };
  } catch(err){
    return { ok:false, error: String(err) };
  } finally{ clearTimeout(t); }
}

export default async function handler(req,res){
  setCors(res);
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  try{
    const { horses, meta } = req.body || {};
    if(!Array.isArray(horses) || horses.length===0){
      return res.status(400).json({ error:'No horses provided' });
    }
    const openaiKey = resolveOpenAIKey();
    const results = await Promise.all(horses.map(async (h)=>{
      const key = `factors:${(meta?.track||'')}:${(meta?.distance||'')}:${h.name}`;
      const c = hitCache(key);
      if(c) return { name:h.name, factors:c, cached:true };

      // Search corpus
      const q = `${h.name} recent form trainer ${h.trainer||''} jockey ${h.jockey||''} ${(meta?.track||'')} ${(meta?.distance||'')} ${(meta?.surface||'')}`;
      const tav = await tavilySearch(q);
      const raw = (tav?.results||[])
        .map(r=>[r.title, r.content].filter(Boolean).join('\n'))
        .join('\n---\n')
        .slice(0, 12000); // keep tokens bounded

      const ex = await extractStructured(openaiKey, raw, h, meta);
      if(ex.ok){
        putCache(key, ex.data);
        return { name:h.name, factors: ex.data };
      } else {
        return { name:h.name, factors: null, error: ex.error||'extract failed' };
      }
    }));

    return res.status(200).json({ ok:true, results, count: results.length });
  }catch(err){
    console.error('[API ERROR factors]', err);
    const status = err?.status || 500;
    return res.status(status).json({ ok:false, error:String(err?.message||err) });
  }
}

