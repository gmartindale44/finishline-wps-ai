/* public/js/verify-modal.js — r22 */

;(() => {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_VERIFY_MODAL__) return; window.__FL_VERIFY_MODAL__ = true;
  if (window.__flVerifyDebug === undefined) window.__flVerifyDebug = false;

  const qs = (s, r = document) => r.querySelector(s);
  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  // Inject minimal CSS to force date input to render consistently
  (function ensureStyles(){
    if (document.getElementById("flv-inline-css")) return;
    const css = `
      #fl-verify-modal-host input[type="date"]{
        appearance:auto !important;
        -webkit-appearance:auto !important;
        -moz-appearance:auto !important;
        background:#1e1f24; color:#fff; border:1px solid rgba(255,255,255,.18);
      }
      #flv-field-row{ display:flex; gap:10px; flex-wrap:wrap }
      #flv-field-row .flv-field{ display:block; }
      #flv-field-row .flv-field--track{ flex:1 1 280px; min-width:260px; }
      #flv-field-row .flv-field--race { flex:0 0 160px; min-width:140px; }
      #flv-field-row .flv-field--date { flex:0 0 200px; min-width:180px; }
    `.trim();
    const el = document.createElement("style");
    el.id = "flv-inline-css";
    el.textContent = css;
    document.head.appendChild(el);
  })();

  function readUIPredictions() {
    try {
      const scope = document.querySelector('[data-panel="predictions"], .predictions-panel') || document;
      const picks = { win:"", place:"", show:"" };
      const cards = Array.from(scope.querySelectorAll(".prediction-card, [data-pick]"));
      if (cards.length >= 3) {
        const names = cards.slice(0,3).map(card => {
          const el = card.querySelector("[data-name], .title, .name, b, strong");
          return (el && el.textContent || "").trim();
        });
        picks.win = names[0]||""; picks.place = names[1]||""; picks.show = names[2]||"";
        return picks;
      }
      const txt = sel => (scope.querySelector(sel)?.textContent || "").trim();
      picks.win   = txt("[data-pick='win'], .pick-win b, .emoji-win~b");
      picks.place = txt("[data-pick='place'], .pick-place b, .emoji-place~b");
      picks.show  = txt("[data-pick='show'], .pick-show b, .emoji-show~b");
      return picks;
    } catch { return { win:"", place:"", show:"" }; }
  }

  function readCtx(){ try{const s=sessionStorage.getItem("fl:verify:ctx"); if(s) return JSON.parse(s);}catch{} return {}; }

  const getTopTrack = () => qs("input[placeholder*='track' i]") || qs("input[id*='track' i]") || qs("input[name*='track' i]");
  const getTopRace  = () => qs("input[placeholder*='race'  i]") || qs("input[id*='race'  i]") || qs("input[name*='race'  i]");
  const currentTrack  = () => (getTopTrack()?.value || "").trim();
  const currentRaceNo = () => (getTopRace()?.value  || "").trim();

  function scoreGZ(sig){
    const c=+((sig&&sig.confidence)||0), m=+((sig&&sig.top3Mass)||0), g12=+((sig&&sig.gap12)||0), g23=+((sig&&sig.gap23)||0);
    const score=Math.min(100, 0.45*c + 0.35*m + 8*g12 + 5*g23);
    let suggested="ATB";
    if(c>=78 && g12>=2) suggested="WinOnly";
    else if(m>=55 && (g12+g23)>=3.5) suggested="TrifectaBox";
    else if(m>=52) suggested="ExactaBox";
    const tier = score>=72 ? "Green" : score>=58 ? "Yellow" : "Red"; // placeholder “Match Tier”
    return { score:Math.round(score), tier, suggested };
  }

  function ensureGreenZoneSection(host){
    let wrap = qs("#flv-gz-today", host);
    if(wrap) return wrap;
    wrap = document.createElement("div");
    wrap.id = "flv-gz-today";
    wrap.style.cssText = "margin-top:12px;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px;background:rgba(35,37,44,.98);box-shadow:0 6px 18px rgba(0,0,0,.35)";
    wrap.innerHTML = `
      <div style="font:600 14px system-ui;display:flex;gap:8px;align-items:center">
        <span>🟢 Green-Zone (Today)</span>
        <small style="opacity:.75">Based on predictions you saved today</small>
      </div>
      <div id="gz-today-list" style="margin-top:8px"></div>
      <div id="gz-today-summary" style="margin-top:8px;opacity:.9"></div>
      <div id="gz-upcoming" style="margin-top:10px;opacity:.9"></div>
    `;
    const anchor = qs("#flv-gz-anchor", host) || qs(".flv-card", host) || host;
    anchor.parentElement?.insertBefore(wrap, anchor.nextSibling);
    return wrap;
  }

  function updateGreenZoneToday(host){
    const wrap = ensureGreenZoneSection(host);
    const list = wrap.querySelector("#gz-today-list");
    const summary = wrap.querySelector("#gz-today-summary");
    if(!list || !summary) return;

    const dayKey = todayISO();
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

    const scored = rows.map(r=>({ ...r, gz:scoreGZ(r.signals||{}) }))
                       .sort((a,b)=>b.gz.score - a.gz.score);

    const map = { WinOnly:"Win-Only", ATB:"Across The Board", ExactaBox:"Exacta Box", TrifectaBox:"Trifecta Box" };
    const tbl = document.createElement("table");
    tbl.style.cssText="width:100%;border-collapse:collapse;font:12px system-ui";
    tbl.innerHTML = `<thead><tr>
      <th style="text-align:left;padding:6px 4px;opacity:.8">Track</th>
      <th style="text-align:left;padding:6px 4px;opacity:.8">Race</th>
      <th style="text-align:left;padding:6px 4px;opacity:.8">Score</th>
      <th style="text-align:left;padding:6px 4px;opacity:.8">Match Tier</th>
      <th style="text-align:left;padding:6px 4px;opacity:.8">Suggested</th>
    </tr></thead>
    <tbody>${scored.map(r=>`
      <tr>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.track||"—"}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.raceNo||"—"}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.gz.score}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.gz.tier}</td>
        <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${map[r.gz.suggested]||"ATB"}</td>
      </tr>`).join("")}
    </tbody>`;
    list.innerHTML=""; list.appendChild(tbl);

    const counts = { WinOnly:0, ATB:0, ExactaBox:0, TrifectaBox:0 };
    scored.forEach(r=>{ counts[r.gz.suggested] = (counts[r.gz.suggested]||0)+1; });
    summary.innerHTML = `<b>Suggested Bets (Today):</b> Win-Only ${counts.WinOnly||0} • ATB ${counts.ATB||0} • Exacta Box ${counts.ExactaBox||0} • Trifecta Box ${counts.TrifectaBox||0}
      <span title="Placeholder tiers until calibration: Green ≥72, Yellow 58–71, Red <58" style="opacity:.6;margin-left:8px;cursor:help">ℹ️</span>`;
  }

  // Build modal
  function buildModal(){
    let host = qs("#fl-verify-modal-host"); if(host) return host;

    host = document.createElement("div");
    host.id = "fl-verify-modal-host";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)";
    host.innerHTML = `
      <div role="dialog" aria-modal="true" class="flv-card" style="width:min(880px,96vw);max-height:90vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.98);backdrop-filter:blur(6px);padding:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0;font:600 20px/1.2 system-ui">Verify Race</h3>
          <button id="flv-close" style="border:none;background:transparent;color:inherit;font:600 16px;opacity:.8">✕</button>
        </div>

        <div id="flv-status" style="font:600 12px/1.2 system-ui;opacity:.85;margin-bottom:10px">Idle</div>

        <div id="flv-field-row">
          <label class="flv-field flv-field--track">
            <div style="margin-bottom:6px;opacity:.9">Track <span style="color:#ffcc00">*</span></div>
            <input id="flv-track" type="text" placeholder="Track"
                   style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
            <small id="flv-track-warn" style="display:none;color:#ffcc00">Track is required.</small>
          </label>

          <label class="flv-field flv-field--race">
            <div style="margin-bottom:6px;opacity:.9">Race # (optional)</div>
            <input id="flv-race" type="text" inputmode="numeric" placeholder="e.g. 6"
                   style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
            <small id="flv-race-warn" style="display:none;color:#ffcc00">Server asked for a Race # — please add one.</small>
          </label>

          <label class="flv-field flv-field--date">
            <div style="margin-bottom:6px;opacity:.9">Date (YYYY-MM-DD)</div>
            <input id="flv-date" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);color:#fff;"/>
          </label>
        </div>

        <div style="display:flex;gap:8px;align-items:center;margin:12px 0;flex-wrap:wrap">
          <button id="flv-run" style="padding:10px 14px;border-radius:10px;border:none;background:#6b46c1;color:#fff;font-weight:700">Verify Now</button>
          <button id="flv-open-top" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit">Open Top Result</button>
          <button id="flv-open-google" style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit">Open Google (debug)</button>
          <small style="opacity:.75">Track & Date required; Race # helps context.</small>
        </div>

        <details id="flv-sum" open>
          <summary style="cursor:pointer;opacity:.9">Summary</summary>
          <pre id="flv-sum-body" style="white-space:pre-wrap;margin-top:8px;max-height:220px;overflow:auto;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font:12px/1.5 ui-monospace, Menlo, Consolas">No summary returned.</pre>
        </details>

        <div id="flv-gz-anchor"></div>
      </div>
    `;
    document.body.appendChild(host);

    host.__flvLast = { top:null, query:"" };

    qs("#flv-close", host)?.addEventListener("click", () => (host.style.display="none"));

    const runBtn     = qs("#flv-run", host);
    const statusEl   = qs("#flv-status", host);
    const summaryEl  = qs("#flv-sum-body", host);
    const warnTrack  = qs("#flv-track-warn", host);
    const warnRace   = qs("#flv-race-warn", host);
    const trackInput = qs("#flv-track", host);
    const raceInput  = qs("#flv-race", host);
    const dateInput  = qs("#flv-date", host);

    // Build date input programmatically with a fallback
    try {
      dateInput.setAttribute("type","date");
      if (!dateInput.value) dateInput.value = todayISO();
      // If the UA ignores type=date (some skins), keep a text fallback placeholder
      if (dateInput.type !== "date") {
        dateInput.setAttribute("type","text");
        dateInput.setAttribute("placeholder", todayISO());
        dateInput.setAttribute("pattern","\\d{4}-\\d{2}-\\d{2}");
      }
    } catch {
      dateInput.setAttribute("type","text");
      dateInput.setAttribute("placeholder", todayISO());
    }

    ensureGreenZoneSection(host);

    if (runBtn){
      const defaultLabel = runBtn.textContent || "Verify Now";
      runBtn.addEventListener("click", async () => {
        const track = (trackInput?.value || "").trim();
        const raceNo = (raceInput?.value || "").trim();
        const date = (dateInput?.value || "").trim() || todayISO();

        warnTrack && (warnTrack.style.display = track ? "none" : "");
        if (!track) { try { trackInput?.focus(); } catch {} return; }

        if (statusEl){ statusEl.textContent="Running…"; statusEl.style.color="#cbd5f5"; }
        if (summaryEl) summaryEl.textContent = "Working…";
        warnRace && (warnRace.style.display = "none");
        host.__flvLast = { top:null, query:"" };

        runBtn.disabled = true; runBtn.textContent = "Running…";

        try{
          const predicted = readUIPredictions();
          const resp = await fetch("/api/verify_race", {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ track, date, raceNo: raceNo || undefined, predicted })
          });
          const data = await resp.json().catch(()=> ({}));

          if (statusEl){
            statusEl.textContent = resp.ok ? "OK" : `Error ${resp.status}`;
            statusEl.style.color  = resp.ok ? "#cbd5f5" : "#f87171";
          }

          host.__flvLast = { top: data?.top || null, query: data?.query || "" };

          if (summaryEl){
            const lines = [];
            if (data?.query) lines.push(`Query: ${data.query}`);
            const summaryText =
              data?.summary ||
              (data?.top?.title ? `Top Result: ${data.top.title}${data.top.link?`\n${data.top.link}`:""}` : "") ||
              (data?.error ? `Server message: ${data.error}` : "");
            if (summaryText) lines.push(summaryText);
            if (data?.outcome && (data.outcome.win||data.outcome.place||data.outcome.show)){
              lines.push(`Outcome: ${[data.outcome.win,data.outcome.place,data.outcome.show].filter(Boolean).join(" / ")}`);
            }
            if (!lines.length) lines.push("No summary returned.");
            summaryEl.textContent = lines.join("\n");
          }
        } catch (err){
          if (statusEl){ statusEl.textContent="Error"; statusEl.style.color="#f87171"; }
          if (summaryEl){ summaryEl.textContent = String(err?.message || err || "Unknown error"); }
          console.error(err);
        } finally {
          runBtn.disabled = false; runBtn.textContent = defaultLabel;
          updateGreenZoneToday(host);
          try { fetch("/api/verify_backfill", { method:"POST" }).catch(()=>{}); } catch {}
          try { fetch("/api/gz_upcoming", { method:"POST" }).catch(()=>{}); } catch {}
        }
      });
    }

    qs("#flv-open-top", host)?.addEventListener("click", () => {
      try{ const u = host.__flvLast?.top?.link; if(u) window.open(u,"_blank","noopener"); }catch{}
    });
    qs("#flv-open-google", host)?.addEventListener("click", () => {
      try{ const q = host.__flvLast?.query || ""; const u = "https://www.google.com/search?q="+encodeURIComponent(q); window.open(u,"_blank","noopener"); }catch{}
    });

    host.__flvUpdateGZ = () => updateGreenZoneToday(host);
    return host;
  }

  function prefill(host, ctx){
    const saved = readCtx();
    const trackVal = (ctx?.track)  || currentTrack()  || saved.track  || "";
    const raceVal  = (ctx?.raceNo) || currentRaceNo() || saved.raceNo || "";

    const trackInput=qs("#flv-track",host);
    const raceInput =qs("#flv-race",host);
    const dateInput =qs("#flv-date",host);

    if (trackInput) trackInput.value = trackVal;
    if (raceInput)  raceInput.value  = raceVal || "";
    if (dateInput && !dateInput.value) dateInput.value = todayISO();

    const summaryEl=qs("#flv-sum-body",host);
    if (summaryEl) summaryEl.textContent = "No summary returned.";

    (function pushSnap(){
      try{
        const picks = readUIPredictions();
        const t = trackVal || currentTrack(); if(!t) return;
        const r = (raceInput?.value || "").trim() || currentRaceNo() || "";
        const dayKey = todayISO();
        const key = `fl:snap:${dayKey}:${t}:${r||"nr"}`;
        const payload = { ts:Date.now(), date:dayKey, track:t, raceNo:r, signals:{ confidence:null, top3Mass:null, gap12:0, gap23:0 }, picks };
        sessionStorage.setItem(key, JSON.stringify(payload));
      }catch{}
    })();

    if (typeof host.__flvUpdateGZ === "function") host.__flvUpdateGZ();
  }

  function open(ctx){
    const host = buildModal();
    prefill(host, ctx);
    host.style.display = "flex";
    try{ qs("#flv-track",host).focus(); }catch{}
  }

  window.__FL_OPEN_VERIFY_MODAL__ = open;
})();


