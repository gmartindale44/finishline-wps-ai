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
  const idx = {
    conf: F('confidence'),
    picks: F('ai_picks'),
    strat: F('strategy'),
    result: F('result'),
    roi: F('roi_percent')
  };
  // Expect your schema; if not present, keep neutral by returning []
  if (idx.conf<0 || idx.picks<0 || idx.strat<0 || idx.result<0 || idx.roi<0) return [];
  return rows.map(r=>{
    const c=r.split(',').map(x=>x.trim());
    const conf = parseFloat(c[idx.conf]||'0'); // already 0..1
    const picksStr = (c[idx.picks]||'').replace(/"/g,'').trim();
    const pred = picksStr ? picksStr.split('-').map(x=>x.trim().toLowerCase()) : [];
    const result = (c[idx.result]||'').toLowerCase(); // hit/partial/miss
    const roi = parseFloat(String(c[idx.roi]||'0').replace('+',''));
    const v = (c[idx.strat]||'').toLowerCase();
    const reco = (v==='atb' ? 'across the board' : v);
    const top3_success = /hit|partial/.test(result);
    return { conf, pred, top3_success, roi, reco };
  });
}
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
  // Reliability
  const bins=new Map();
  rows.forEach(r=>{ const b=bin(r.conf); if(!bins.has(b)) bins.set(b,{w:0,hit:0}); const o=bins.get(b); o.w++; o.hit += (r.top3_success?1:0); });
  const xs=Array.from(bins.keys()).sort((a,b)=>a-b).map(b=>b/100);
  const ws=xs.map(x=>bins.get(Math.floor(x*100)).w);
  const ys=xs.map(x=>bins.get(Math.floor(x*100)).hit / bins.get(Math.floor(x*100)).w);
  const iso=isotonic(xs,ys,ws);
  const reliability=xs.map((x,i)=>({ c:x, p: iso[i] }));

  // Rank mass temperature (skip without winner rank → neutral 1.0)
  const temp_tau = 1.0;

  // Strategy policy by bands
  const bands=[{name:'60-64',lo:0.60,hi:0.649},{name:'65-69',lo:0.65,hi:0.699},{name:'70-74',lo:0.70,hi:0.749},{name:'75-79',lo:0.75,hi:0.799}];
  const strat=['across the board','exacta box','trifecta box'];
  const policy={};
  bands.forEach(b=>{
    const cand=rows.filter(r=>r.conf>=b.lo && r.conf<=b.hi);
    const stats={};
    strat.forEach(s=>{
      const S=cand.filter(r=>{
        const v=(r.reco||'').toLowerCase();
        return v===s || (s==='across the board' && v==='atb');
      });
      const avg=S.length? S.reduce((a,r)=>a+(isFinite(r.roi)?r.roi:0),0)/S.length : -999;
      stats[s]={ n:S.length, avg_roi:avg };
    });
    let best='across the board',bestR=-Infinity; Object.keys(stats).forEach(s=>{ if(stats[s].avg_roi>bestR){bestR=stats[s].avg_roi; best=s;} });
    policy[b.name]={ stats, recommended:best };
  });

  return { reliability, temp_tau, policy };
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
  const rows=parseCSV(txt).filter(r=>r.pred && r.pred.length>=3 && r.conf>0);
  const params=learnParams(rows);
  fs.mkdirSync(path.dirname(OUT), {recursive:true});
  fs.writeFileSync(OUT, JSON.stringify(params,null,2));
  console.log('Wrote', OUT, 'with', rows.length, 'rows');
}

if (process.argv[1] && process.argv[1].includes('calibrate.js')) { main(); }
