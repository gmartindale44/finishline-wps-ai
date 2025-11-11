;(function(){
  if(typeof window==="undefined"||typeof document==="undefined") return;
  if(window.__FL_VERIFY_MODAL__) return; window.__FL_VERIFY_MODAL__=true;
  if(window.__flVerifyDebug===undefined) window.__flVerifyDebug=false;
  const qs=(s,r=document)=>r.querySelector(s);

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
      <div role="dialog" aria-modal="true" class="flv-card" style="width:min(840px,96vw);max-height:90vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.92);backdrop-filter:blur(6px);padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <h3 style="margin:0;font:600 18px/1.2 system-ui">Verify Race</h3>
          <button id="flv-close" style="border:none;background:transparent;color:inherit;font:600 16px;opacity:.8">✕</button>
        </div>
        <div id="flv-status" style="font:600 12px/1.2 system-ui;opacity:.8;margin-bottom:8px">Idle</div>
        <div style="display:grid;gap:10px;margin-bottom:12px;grid-template-columns:1fr 140px;">
          <div>
            <label style="display:block;margin:0 0 6px 0;opacity:.9">Track <span style="color:#ffcc00">*</span></label>
            <input id="flv-track" type="text" placeholder="Track" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit"/>
            <small id="flv-track-warn" style="display:none;color:#ffcc00">Enter/select a Track before verifying.</small>
          </div>
          <div>
            <label style="display:block;margin:0 0 6px 0;opacity:.9">Race # (optional)</label>
            <input id="flv-race" type="text" placeholder="e.g. 6" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit"/>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
          <button id="flv-run" style="padding:8px 12px;border-radius:8px;border:none;background:#6b46c1;color:#fff;font-weight:600">Verify Now</button>
          <small style="opacity:.75">Track is required; Race # helps context.</small>
        </div>
        <details open>
          <summary style="cursor:pointer;opacity:.9">Summary</summary>
          <div id="flv-summary" style="margin-top:8px"></div>
        </details>
        <details>
          <summary style="cursor:pointer;opacity:.9">Raw</summary>
          <pre id="flv-raw" style="max-height:320px;overflow:auto;margin:8px 0 0;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font:12px/1.5 ui-monospace, Menlo, Consolas">—</pre>
        </details>
      </div>
    `;
    document.body.appendChild(host);

    qs("#flv-close",host).addEventListener("click",()=> host.style.display="none");
    qs("#flv-run",host).addEventListener("click", async ()=>{
      const track=qs("#flv-track",host).value.trim();
      const raceNo=qs("#flv-race",host).value.trim();
      const status=qs("#flv-status",host), raw=qs("#flv-raw",host), sum=qs("#flv-summary",host), warn=qs("#flv-track-warn",host);
      if(!track){warn.style.display="";qs("#flv-track",host).focus();return;} else warn.style.display="none";
      status.textContent="Running…"; raw.textContent=""; sum.innerHTML="";
      try{
        const resp=await fetch("/api/verify_race",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({track,raceNo:raceNo||undefined})});
        const data=await resp.json().catch(()=>({}));
        status.textContent=resp.ok?"OK":`Error ${resp.status}`;
        raw.textContent=JSON.stringify(data,null,2);
        const parts=[];
        if(data.query) parts.push(`<div><b>Query:</b> ${data.query}</div>`);
        if(data.top&&data.top.title) parts.push(`<div><b>Top Result:</b> ${data.top.title}</div>`);
        if(data.summary) parts.push(`<div>${data.summary}</div>`);
        sum.innerHTML=parts.join("")||"<em>No summary returned.</em>";
      }catch(e){ status.textContent="Error"; raw.textContent=String(e&&e.message||e); console.error(e); }
    });

    return host;
  }

  function prefill(host, ctx){
    const topTrack=getTopTrack();
    const topRace=getTopRace();
    const saved=readCtx();
    const trackVal=(ctx&&ctx.track)||(topTrack&&topTrack.value)||saved.track||"";
    const raceVal=(ctx&&ctx.raceNo)||(topRace&&topRace.value)||saved.raceNo||"";
    qs("#flv-track",host).value=trackVal;
    qs("#flv-race",host).value=raceVal||"";
    qs("#flv-status",host).textContent="Idle";
    qs("#flv-summary",host).innerHTML="";
    qs("#flv-raw",host).textContent="—";
    qs("#flv-track-warn",host).style.display=trackVal?"none":"";
  }

  function open(ctx){
    const host=buildModal();
    prefill(host,ctx);
    host.style.display="flex";
    try{qs("#flv-track",host).focus();}catch{}
  }

  window.__FL_OPEN_VERIFY_MODAL__=open;
})();
