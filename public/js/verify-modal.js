;(function(){
  if(typeof window==="undefined"||typeof document==="undefined") return;
  if(window.__FL_VERIFY_MODAL__) return; window.__FL_VERIFY_MODAL__=true;
  if(window.__flVerifyDebug===undefined) window.__flVerifyDebug=false;

  const qs=(s,r=document)=>r.querySelector(s);

  function todayISO(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,"0");
    const dd=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${dd}`;
  }

  function readUIPredictions(){
    try{
      const scope=document.querySelector('[data-panel="predictions"], .predictions-panel')||document;
      const picks={ win:"", place:"", show:"" };
      const cards=Array.from(scope.querySelectorAll('.prediction-card, [data-pick]')).filter(Boolean);
      if(cards.length>=3){
        const names=cards.slice(0,3).map(card=>{
          const el=card.querySelector('[data-name], .title, .name, b, strong');
          return (el&&el.textContent||"").trim();
        });
        picks.win = names[0]||"";
        picks.place = names[1]||"";
        picks.show = names[2]||"";
        return picks;
      }
      const getPick=(selector)=>{
        const el=scope.querySelector(selector);
        return el ? (el.textContent||"").trim() : "";
      };
      picks.win = getPick("[data-pick='win'], .pick-win b, .emoji-win~b");
      picks.place = getPick("[data-pick='place'], .pick-place b, .emoji-place~b");
      picks.show = getPick("[data-pick='show'], .pick-show b, .emoji-show~b");
      return picks;
    }catch{
      return { win:"", place:"", show:"" };
    }
  }

  function readCtx(){
    try{const s=sessionStorage.getItem("fl:verify:ctx"); if(s) return JSON.parse(s);}catch{}
    return {};
  }
  function getTopTrack(){return qs("input[placeholder*='track' i]")||qs("input[id*='track' i]")||qs("input[name*='track' i]");}
  function getTopRace(){return qs("input[placeholder*='race' i]")||qs("input[id*='race' i]")||qs("input[name*='race' i]");}

  function buildModal(){
    let host=qs("#fl-verify-modal-host");
    if(host) return host;

    host=document.createElement("div");
    host.id="fl-verify-modal-host";
    host.style.cssText="position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)";
    host.innerHTML=`
      <div role="dialog" aria-modal="true" class="flv-card" style="width:min(880px,96vw);max-height:90vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.92);backdrop-filter:blur(6px);padding:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0;font:600 20px/1.2 system-ui">Verify Race</h3>
          <button id="flv-close" style="border:none;background:transparent;color:inherit;font:600 16px;opacity:.8">✕</button>
        </div>

        <div id="flv-status" style="font:600 12px/1.2 system-ui;opacity:.8;margin-bottom:10px">Idle</div>

        <div style="display:grid;gap:10px;margin-bottom:12px;grid-template-columns:1fr 140px 150px;">
          <div>
            <label style="display:block;margin:0 0 6px 0;opacity:.9">Track <span style="color:#ffcc00">*</span></label>
            <input id="flv-track" type="text" placeholder="Track"
                   style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
            <small id="flv-track-warn" style="display:none;color:#ffcc00">Track is required.</small>
          </div>
          <div>
            <label style="display:block;margin:0 0 6px 0;opacity:.9">Race # (optional)</label>
            <input id="flv-race" type="text" placeholder="e.g. 6"
                   style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
            <small id="flv-race-warn" style="display:none;color:#ffcc00">Server asked for a Race # — please add one.</small>
          </div>
          <div>
            <label style="display:block;margin:0 0 6px 0;opacity:.9">Date <span style="color:#ffcc00">*</span></label>
            <input id="flv-date" type="date"
                   style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
            <small id="flv-date-warn" style="display:none;color:#ffcc00">Date is required.</small>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <button id="flv-run" style="padding:10px 14px;border-radius:10px;border:none;background:#6b46c1;color:#fff;font-weight:700">Verify Now</button>
          <button id="flv-open-top" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit">Open Top Result</button>
          <button id="flv-open-google" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit">Open Google (debug)</button>
          <small style="opacity:.75">Track and Date are required; Race # helps context.</small>
        </div>

        <details open>
          <summary style="cursor:pointer;opacity:.9">Summary</summary>
          <div id="flv-summary" style="margin-top:8px"><em>No summary returned.</em></div>
        </details>

        <details style="margin-top:8px">
          <summary style="cursor:pointer;opacity:.9">Raw</summary>
          <pre id="flv-raw" style="max-height:320px;overflow:auto;margin:8px 0 0;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);font:12px/1.5 ui-monospace, Menlo, Consolas">—</pre>
        </details>
      </div>
    `;
    document.body.appendChild(host);

    host.__flvLast = { top: null, query: '' };

    qs("#flv-close",host).addEventListener("click",()=> host.style.display="none");

    qs("#flv-run",host).addEventListener("click", async ()=>{
      const track=qs("#flv-track",host).value.trim();
      const raceNo=qs("#flv-race",host).value.trim();
      const date=qs("#flv-date",host).value;
      const status=qs("#flv-status",host), raw=qs("#flv-raw",host), sum=qs("#flv-summary",host);
      const wTrack=qs("#flv-track-warn",host), wRace=qs("#flv-race-warn",host), wDate=qs("#flv-date-warn",host);

      wTrack.style.display=track?"none":"";
      wDate.style.display=date?"none":"";
      wRace.style.display="none";
      if(!track||!date) return;

      status.textContent="Running…";
      raw.textContent="";
      sum.innerHTML="<em>Working…</em>";
      host.__flvLast = { top: null, query: '' };

      try{
        const predicted=readUIPredictions();
        const resp=await fetch("/api/verify_race",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({track,date,raceNo:raceNo||undefined,predicted})
        });
        const data=await resp.json().catch(()=>({}));
        status.textContent=resp.ok?"OK":`Error ${resp.status}`;
        raw.textContent=JSON.stringify(data,null,2);
        if(!resp.ok && data && typeof data.error==="string" && /raceno/i.test(data.error)){
          wRace.style.display="";
        }
        host.__flvLast = { top: (data && data.top) || null, query: (data && data.query) || '' };
        const parts=[];
        if(data.query) parts.push(`<div><b>Query:</b> ${data.query}</div>`);
        if(data.top&&data.top.title) parts.push(`<div><b>Top Result:</b> ${data.top.title}</div>`);
        if(data.summary) parts.push(`<div>${data.summary}</div>`);
        if(data.outcome && (data.outcome.win||data.outcome.place||data.outcome.show)){
          parts.push(`<div><b>Outcome:</b> ${[data.outcome.win,data.outcome.place,data.outcome.show].filter(Boolean).join(' / ')}</div>`);
        }
        if(data.hits){
          const hitText=[
            data.hits.winHit?"Win":null,
            data.hits.placeHit?"Place":null,
            data.hits.showHit?"Show":null
          ].filter(Boolean).join(', ');
          parts.push(`<div><b>Hits:</b> ${hitText || 'None'}</div>`);
        }
        let summaryHtml=parts.join("")||"<em>No summary returned.</em>";
        const detailText=String(data?.details||data?.error||"");
        if(!resp.ok && resp.status===500 && /read-only file system/i.test(detailText)){
          summaryHtml="<em>Server cannot write CSV on Vercel (read-only). Logging has been switched to Redis; please re-run.</em>";
        }
        sum.innerHTML=summaryHtml;
      }catch(e){
        status.textContent="Error";
        raw.textContent=String(e&&e.message||e);
        console.error(e);
      }
    });

    qs("#flv-open-top", host).addEventListener("click", ()=>{
      try{
        const last = host.__flvLast || {};
        const url = last.top && last.top.link;
        if(url) window.open(url, "_blank", "noopener");
      }catch{}
    });

    qs("#flv-open-google", host).addEventListener("click", ()=>{
      try{
        const last = host.__flvLast || {};
        const q = last.query || "";
        const u = "https://www.google.com/search?q=" + encodeURIComponent(q);
        window.open(u, "_blank", "noopener");
      }catch{}
    });

    return host;
  }

  function prefill(host,ctx){
    const topTrack=getTopTrack();
    const topRace=getTopRace();
    const saved=readCtx();

    const trackVal=(ctx&&ctx.track)||(topTrack&&topTrack.value)||saved.track||"";
    const raceVal=(ctx&&ctx.raceNo)||(topRace&&topRace.value)||saved.raceNo||"";
    const dateVal=todayISO();

    qs("#flv-track",host).value=trackVal;
    qs("#flv-race",host).value=raceVal||"";
    qs("#flv-date",host).value=dateVal;

    host.__flvLast = { top: null, query: '' };

    qs("#flv-status",host).textContent="Idle";
    qs("#flv-summary",host).innerHTML="<em>No summary returned.</em>";
    qs("#flv-raw",host).textContent="—";
    qs("#flv-track-warn",host).style.display=trackVal?"none":"";
    qs("#flv-date-warn",host).style.display=dateVal?"none":"";
    qs("#flv-race-warn",host).style.display="none";
  }

  function open(ctx){
    const host=buildModal();
    prefill(host,ctx);
    host.style.display="flex";
    try{qs("#flv-track",host).focus();}catch{}
  }

  window.__FL_OPEN_VERIFY_MODAL__=open;
})();
