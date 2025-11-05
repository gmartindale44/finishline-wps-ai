import fs from 'fs';
import path from 'path';
const CSV = path.join(process.cwd(), 'data', 'finishline_tests_v1.csv');
const OUT = path.join(process.cwd(), 'data', 'model_params.json');

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l=>l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return [];
  const hdr = lines[0]; const rows = lines.slice(1);
  const H = hdr.split(',').map(h => h.trim().toLowerCase());
  const F = (k) => H.findIndex(h => h === k || h.includes(k));
  const f = {
    pred1: F('pred1'), pred2: F('pred2'), pred3: F('pred3'),
    conf: [F('conf_pct'), F('confidence')].find(i => i>=0),
    actual_win: [F('actual_win'), F('win')].find(i => i>=0),
    roi: F('roi'),
    strategy_reco: F('strategy')
  };
  return rows.map(r=>{
    const c=r.split(',').map(x=>x.trim());
    const conf = parseFloat(c[f.conf]||'0'); // percentage value
    return {
      conf: (isFinite(conf)? conf:0)/100,
      pred: [c[f.pred1], c[f.pred2], c[f.pred3]].map(x=>(x||'').toLowerCase()),
      actual_win: (c[f.actual_win]||'').toLowerCase(),
      roi: parseFloat(c[f.roi]||'0'),
      reco: (c[f.strategy_reco]||'').toLowerCase()
    };
  });
}
function top3Hit(r){ return new Set(r.pred).has(r.actual_win); }
function bin(x){ const b=Math.max(0,Math.min(99,Math.floor(x*100))); return Math.floor(b/2)*2; }
function isotonic(xs,ys,ws){
  const blocks=[];
  for (let i=0;i<xs.length;i++){
    blocks.push({sumw:ws[i],sumy:ys[i]*ws[i],lo:i,hi:i});
    while(blocks.length>1){
      const a=blocks[blocks.length-2], b=blocks[blocks.length-1];
      if (a.sumy/a.sumw <= b.sumy/b.sumw) break;
      a.sumw+=b.sumw; a.sumy+=b.sumy; a.hi=b.hi; blocks.pop();
    }
  }
  const out=new Array(xs.length);
  for(const bl of blocks){ const v=bl.sumy/bl.sumw; for(let i=bl.lo;i<=bl.hi;i++) out[i]=v; }
  return out;
}
function learnParams(rows){
  if (!rows.length) return { reliability:[], temp_tau:1.0, policy:{} };
  // Reliability curve
  const bins=new Map();
  rows.forEach(r=>{ const b=bin(r.conf); if(!bins.has(b)) bins.set(b,{w:0,hit:0}); const o=bins.get(b); o.w++; o.hit += top3Hit(r)?1:0; });
  const xs=Array.from(bins.keys()).sort((a,b)=>a-b).map(b=>b/100);
  const ws=xs.map(x=>bins.get(Math.floor(x*100)).w);
  const ys=xs.map(x=>bins.get(Math.floor(x*100)).hit / bins.get(Math.floor(x*100)).w);
  const iso=isotonic(xs,ys,ws);
  const reliability=xs.map((x,i)=>({ c:x, p: iso[i] }));

  // Temperature for rank mass (match empirical distribution)
  const cnt={w1:0,w2:0,w3:0,t:0};
  rows.forEach(r=>{ const i=r.pred.findIndex(h=>h===r.actual_win); if(i===0) cnt.w1++; else if(i===1) cnt.w2++; else if(i===2) cnt.w3++; cnt.t++; });
  const p1=(cnt.w1||1)/Math.max(1,cnt.t), p2=(cnt.w2||1)/Math.max(1,cnt.t), p3=(cnt.w3||1)/Math.max(1,cnt.t);
  function soft(t){ const L=[0,-1,-2].map(v=>v/Math.max(0.05,t)); const e=L.map(Math.exp); const Z=e.reduce((a,b)=>a+b,0); return e.map(v=>v/Z); }
  let bestT=1.0, bestE=Infinity; for(let t=0.2;t<=2.0;t+=0.02){ const s=soft(t); const e=Math.abs(s[0]-p1)+Math.abs(s[1]-p2)+Math.abs(s[2]-p3); if(e<bestE){bestE=e;bestT=t;} }

  // Strategy policy by bands
  const bands=[{name:'60-64',lo:0.60,hi:0.649},{name:'65-69',lo:0.65,hi:0.699},{name:'70-74',lo:0.70,hi:0.749},{name:'75-79',lo:0.75,hi:0.799}];
  const strat=['across the board','exacta box','trifecta box'];
  const policy={};
  bands.forEach(b=>{
    const cand=rows.filter(r=>r.conf>=b.lo && r.conf<=b.hi);
    const stats={};
    strat.forEach(s=>{
      const S=cand.filter(r=>(r.reco||'').includes(s));
      const avg=S.length? S.reduce((a,r)=>a+(isFinite(r.roi)?r.roi:0),0)/S.length : -999;
      stats[s]={n:S.length,avg_roi:avg};
    });
    let best='across the board',bestR=-Infinity; strat.forEach(s=>{ if(stats[s].avg_roi>bestR){bestR=stats[s].avg_roi;best=s;} });
    policy[b.name]={stats,recommended:best};
  });

  return { reliability, temp_tau:bestT, policy };
}
function main(){
  if (!fs.existsSync(CSV)) {
    console.log('No CSV present at', CSV, '— keeping current params.');
    return;
  }
  const txt=fs.readFileSync(CSV,'utf8');
  // If only headers (or nothing usable), keep current params neutral
  const nonComment = txt.split(/\r?\n/).filter(l=>l.trim() && !l.trim().startsWith('#'));
  if (nonComment.length <= 1) {
    console.log('CSV has no data rows — keeping current params (neutral).');
    return;
  }
  const rows=parseCSV(txt).filter(r=>r.pred[0] && r.actual_win);
  const params=learnParams(rows);
  fs.mkdirSync(path.dirname(OUT), {recursive:true});
  fs.writeFileSync(OUT, JSON.stringify(params,null,2));
  console.log('Wrote', OUT, 'with', rows.length, 'rows');
}

if (process.argv[1] && process.argv[1].includes('calibrate.js')) { main(); }
