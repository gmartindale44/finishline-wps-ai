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
  };

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
        picks.win = names[0]||""; picks.place = names[1]||""; picks.show = names[2]||"";
        return picks;
      }
      const txt = sel => (scope.querySelector(sel)?.textContent||"").trim();
      picks.win = txt("[data-pick='win'], .pick-win b, .emoji-win~b");
      picks.place = txt("[data-pick='place'], .pick-place b, .emoji-place~b");
      picks.show = txt("[data-pick='show'], .pick-show b, .emoji-show~b");
      return picks;
    }catch{ return { win:"", place:"", show:"" }; }
  }

  function readCtx(){
    try{const s=sessionStorage.getItem("fl:verify:ctx"); if(s) return JSON.parse(s);}catch{}
    return {};
  }
  const getTopTrack = ()=> qs("input[placeholder*='track' i], input[id*='track' i], input[name*='track' i]");
  const getTopRace  = ()=> qs("input[placeholder*='race' i],  input[id*='race' i],  input[name*='race' i]");
  const currentTrack  = ()=> (getTopTrack()?.value||"").trim();
  const currentRaceNo = ()=> (getTopRace()?.value||"").trim();

  // --- Green-Zone helpers (unchanged logic, solid card styles) ---
  function scoreGZ(sig){
    const c=+((sig&&sig.confidence)||0);
    const m=+((sig&&sig.top3Mass)||0);
    const g12=+((sig&&sig.gap12)||0);
    const g23=+((sig&&sig.gap23)||0);
    const score=Math.min(100, 0.45*c + 0.35*m + 8*g12 + 5*g23);
    let suggested="ATB";
    if(c>=78 && g12>=2) suggested="WinOnly";
    else if(m>=55 && (g12+g23)>=3.5) suggested="TrifectaBox";
    else if(m>=52) suggested="ExactaBox";
    const tier = score>=72 ? "Green" : score>=58 ? "Yellow" : "Red";
    return { score:Math.round(score), tier, suggested };
  }
  function todayKey(){ return todayISO(); }
  function ensureGreenZoneSection(host){
    let wrap = qs("#flv-gz-today", host);
    if(wrap) return wrap;
    wrap = document.createElement("div");
    wrap.id = "flv-gz-today";
    wrap.style.cssText = "margin-top:12px;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;background:rgba(32,33,39,.96)";
    wrap.innerHTML = `
      <div style="font:600 14px system-ui;display:flex;gap:8px;align-items:center">
        <span>🟢 Green-Zone (Today)</span>
        <small style="opacity:.75">Based on your predictions saved today</small>
      </div>
      <div id="gz-today-list" style="margin-top:8px"></div>
      <div id="gz-today-summary" style="margin-top:8px;opacity:.9"></div>
    `;
    const anchor = qs("#flv-raw-details", host) || qs(".flv-card", host) || host;
    anchor.parentElement?.insertBefore(wrap, anchor.nextSibling);
    return wrap;
  }
  function updateGreenZoneToday(host){
    const wrap = ensureGreenZoneSection(host);
    const list = wrap.querySelector("#gz-today-list");
    const summary = wrap.querySelector("#gz-today-summary");
    if(!list || !summary) return;

    const dayKey = todayKey();
    const rows=[];
    try{
      for(let i=0;i<sessionStorage.length;i++){
        const key = sessionStorage.key(i)||"";
        if(!key.startsWith(`fl:snap:${dayKey}:`)) continue;
        try{
          const raw = sessionStorage.getItem(key);
          if(!raw) continue;
          const parsed = JSON.parse(raw);
          if(parsed && parsed.signals) rows.push(parsed);
        }catch{}
      }
    }catch{}

    if(!rows.length){
      list.textContent = "No predictions captured today yet.";
      summary.textContent = "";
      return;
    }

    const scored = rows.map(row=>({
      ...row, gz: scoreGZ(row.signals||{})
    })).sort((a,b)=>b.gz.score - a.gz.score);

    const map = { WinOnly:"Win-Only", ATB:"Across The Board", ExactaBox:"Exacta Box", TrifectaBox:"Trifecta Box" };
    const tbl = document.createElement("table");
    tbl.style.cssText="width:100%;border-collapse:collapse;font:12px system-ui";
    tbl.innerHTML = `<thead><tr>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Track</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Race</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Score</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Tier</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Suggested</th>
      </tr></thead>
      <tbody>${scored.map(r=>`<tr>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.08)">${r.track||"—"}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.08)">${r.raceNo||"—"}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.08)">${r.gz.score}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.08)">${r.gz.tier}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.08)">${map[r.gz.suggested]||"ATB"}</td>
      </tr>`).join("")}</tbody>`;
    list.innerHTML=""; list.appendChild(tbl);

    const counts = { WinOnly:0, ATB:0, ExactaBox:0, TrifectaBox:0 };
    scored.forEach(r=>{ counts[r.gz.suggested] = (counts[r.gz.suggested]||0)+1; });
    summary.innerHTML = `<b>Suggested Bets (Today):</b> Win-Only ${counts.WinOnly||0} • ATB ${counts.ATB||0} • Exacta Box ${counts.ExactaBox||0} • Trifecta Box ${counts.TrifectaBox||0}`;
  }

  function buildModal(){
    let host=qs("#fl-verify-modal-host"); if(host) return host;

    host=document.createElement("div");
    host.id="fl-verify-modal-host";
    host.style.cssText="position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)";
    host.innerHTML=`
      <div role="dialog" aria-modal="true" class="flv-card" style="width:min(880px,96vw);max-height:90vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.92);backdrop-filter:blur(6px);padding:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0;font:600 20px/1.2 system-ui">Verify Race</h3>
          <button id="flv-close" style="border:none;background:transparent;color:inherit;font:600 16px;opacity:.8">✕</button>
        </div>

        <div id="flv-status" style="font:600 12px/1.2 system-ui;opacity:.85;margin-bottom:10px">Idle</div>

        <div style="display:grid;gap:10px;margin-bottom:12px;grid-template-columns:1fr 120px 140px;">
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
            <label style="display:block;margin:0 0 6px 0;opacity:.9">Date</label>
            <input id="flv-date" type="date"
                   style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <button id="flv-run" style="padding:10px 14px;border-radius:10px;border:none;background:#6b46c1;color:#fff;font-weight:700">Verify Now</button>
          <button id="flv-open-top" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit">Open Top Result</button>
          <button id="flv-open-google" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit">Open Google (debug)</button>
          <small style="opacity:.75">Track & Date required; Race # helps context.</small>
        </div>

        <details id="flv-sum" open>
          <summary style="cursor:pointer;opacity:.9">Summary</summary>
          <pre id="flv-sum-body" style="white-space:pre-wrap;margin-top:8px;max-height:220px;overflow:auto;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font:12px/1.5 ui-monospace, Menlo, Consolas">No summary returned.</pre>
        </details>

        <details id="flv-raw-details" style="margin-top:8px">
          <summary style="cursor:pointer;opacity:.9">Raw</summary>
          <pre id="flv-raw-body" style="max-height:320px;overflow:auto;margin:8px 0 0;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);font:12px/1.5 ui-monospace, Menlo, Consolas">—</pre>
        </details>
      </div>
    `;
    document.body.appendChild(host);

    host.__flvLast = { top: null, query: '' };

    const closeBtn = qs("#flv-close",host);
    closeBtn?.addEventListener("click",()=> host.style.display="none");

    const runBtn = qs("#flv-run",host);
    const statusEl=qs("#flv-status",host);
    const rawEl=qs("#flv-raw-body",host);
    const sumDetails=qs("#flv-sum",host);
    const summaryEl=qs("#flv-sum-body",host);
    const warnTrack=qs("#flv-track-warn",host);
    const warnRace=qs("#flv-race-warn",host);
    const trackInput=qs("#flv-track",host);
    const raceInput=qs("#flv-race",host);
    const dateInput=qs("#flv-date",host);

    // Default date -> today
    if(dateInput && !dateInput.value) dateInput.value = todayISO();

    ensureGreenZoneSection(host);

    // Run click
    if(runBtn){
      const defaultLabel = runBtn.textContent || "Verify Now";
      runBtn.addEventListener("click", async ()=>{
        const track = (trackInput?.value||"").trim();
        const raceNo = (raceInput?.value||"").trim();
        const date = (dateInput?.value||"").trim() || todayISO();

        warnTrack && (warnTrack.style.display = track ? "none" : "");
        if(!track){ try{ trackInput?.focus(); }catch{} return; }

        if(statusEl){ statusEl.textContent = "Running…"; statusEl.style.color = "#cbd5f5"; }
        rawEl && (rawEl.textContent = "");
        summaryEl && (summaryEl.textContent = "Working…");
        warnRace && (warnRace.style.display = "none");
        host.__flvLast = { top: null, query: '' };
        runBtn.disabled = true; runBtn.textContent = "Running…";

        try{
          const predicted = readUIPredictions();
          const resp = await fetch("/api/verify_race",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({ track, date, raceNo: raceNo || undefined, predicted })
          });
          const data = await resp.json().catch(()=>({}));

          statusEl && (statusEl.textContent = resp.ok ? "OK" : `Error ${resp.status}`,
                        statusEl.style.color = resp.ok ? "#cbd5f5" : "#f87171");
          rawEl && (rawEl.textContent = JSON.stringify(data,null,2));
          if(!resp.ok && warnRace && typeof data?.error==="string" && /raceno/i.test(data.error)){ warnRace.style.display = ""; }

          host.__flvLast = { top: data?.top||null, query: data?.query||"" };

          sumDetails && (sumDetails.open = true);
          if(summaryEl){
            const lines=[];
            if(data?.query) lines.push(`Query: ${data.query}`);
            const topLine = data?.summary
              || (data?.top?.title ? `Top Result: ${data.top.title}${data.top.link?`\n${data.top.link}`:""}` : "");
            if(topLine) lines.push(topLine);
            if(data?.outcome && (data.outcome.win||data.outcome.place||data.outcome.show)){
              lines.push(`Outcome: ${[data.outcome.win,data.outcome.place,data.outcome.show].filter(Boolean).join(' / ')}`);
            }
            if(data?.hits){
              const hitText=[ data.hits.winHit?"Win":null, data.hits.placeHit?"Place":null, data.hits.showHit?"Show":null ].filter(Boolean).join(", ");
              if(hitText) lines.push(`Hits: ${hitText}`);
            }
            if(!lines.length && data?.error) lines.push(`Error: ${data.error}`);
            summaryEl.textContent = lines.join("\n") || "No summary returned.";
          }
        }catch(error){
          statusEl && (statusEl.textContent = "Error", statusEl.style.color = "#f87171");
          rawEl && (rawEl.textContent = String(error?.message || error || "Unknown error"));
          console.error(error);
        }finally{
          runBtn.disabled = false; runBtn.textContent = defaultLabel;
          updateGreenZoneToday(host);
        }
      });
    }

    // Top/result buttons
    qs("#flv-open-top", host)?.addEventListener("click", ()=>{
      try{ const u = host.__flvLast?.top?.link; if(u) window.open(u,"_blank","noopener"); }catch{}
    });
    qs("#flv-open-google", host)?.addEventListener("click", ()=>{
      try{ const q = host.__flvLast?.query || ""; window.open("https://www.google.com/search?q="+encodeURIComponent(q),"_blank","noopener"); }catch{}
    });

    host.__flvUpdateGZ = () => updateGreenZoneToday(host);
    return host;
  }

  function prefill(host,ctx){
    const saved=readCtx();
    const trackVal=(ctx?.track)||(currentTrack())||(saved.track)||"";
    const raceVal =(ctx?.raceNo)||(currentRaceNo())||(saved.raceNo)||"";
    const trackInput=qs("#flv-track",host);
    const raceInput =qs("#flv-race",host);
    const dateInput =qs("#flv-date",host);

    if(trackInput) trackInput.value=trackVal;
    if(raceInput)  raceInput.value=raceVal||"";
    if(dateInput && !dateInput.value) dateInput.value = todayISO();

    host.__flvLast = { top: null, query: '' };

    const statusEl=qs("#flv-status",host);
    const sumDetails=qs("#flv-sum",host);
    const summaryEl=qs("#flv-sum-body",host);
    const rawEl=qs("#flv-raw-body",host);
    const warnTrack=qs("#flv-track-warn",host);
    const warnRace=qs("#flv-race-warn",host);

    statusEl && (statusEl.textContent="Idle", statusEl.style.color="#cbd5f5");
    sumDetails && (sumDetails.open = true);
    summaryEl && (summaryEl.textContent="No summary returned.");
    rawEl && (rawEl.textContent="—");
    warnTrack && (warnTrack.style.display=trackVal?"none":"");
    warnRace && (warnRace.style.display="none");

    // Push an immediate snapshot so today's Green-Zone has at least one row.
    (function pushImmediateSnapshot(){
      try{
        const picks = readUIPredictions();
        const t = trackVal || currentTrack(); if(!t) return;
        const r = (raceInput?.value||"").trim() || currentRaceNo() || "";
        const dayKey = todayISO();
        const key = `fl:snap:${dayKey}:${t}:${r||"nr"}`;
        const payload = {
          ts: Date.now(), date: dayKey, track: t, raceNo: r,
          signals: { confidence: null, top3Mass: null, gap12: 0, gap23: 0 },
          picks
        };
        sessionStorage.setItem(key, JSON.stringify(payload));
      }catch{}
    })();

    typeof host.__flvUpdateGZ === "function" && host.__flvUpdateGZ();
  }

  function open(ctx){
    const host=buildModal();
    prefill(host,ctx);
    host.style.display="flex";
    try{qs("#flv-track",host).focus();}catch{}
  }

  window.__FL_OPEN_VERIFY_MODAL__=open;
})();

