/* public/js/verify-modal.js — r20 */

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

  const readCtx = () => {
    try { const s = sessionStorage.getItem("fl:verify:ctx"); if (s) return JSON.parse(s); } catch {}
    return {};
  };
  const getTopTrack = () =>
    qs("input[placeholder*='track' i]") || qs("input[id*='track' i]") || qs("input[name*='track' i]");
  const getTopRace  = () =>
    qs("input[placeholder*='race'  i]") || qs("input[id*='race'  i]") || qs("input[name*='race'  i]");
  const currentTrack = () => {
    const i = getTopTrack(); return (i && typeof i.value === "string" && i.value.trim()) ? i.value.trim() : "";
  };
  const currentRaceNo = () => {
    const i = getTopRace();  return (i && typeof i.value === "string" && i.value.trim()) ? i.value.trim() : "";
  };

  const readUIPredictions = () => {
    try {
      const scope = qs('[data-panel="predictions"], .predictions-panel') || document;
      const picks = { win: "", place: "", show: "" };
      const cards = Array.from(scope.querySelectorAll(".prediction-card, [data-pick]"));
      if (cards.length >= 3) {
        const names = cards.slice(0, 3).map(card => (card.querySelector('[data-name], .title, .name, b, strong')?.textContent || "").trim());
        picks.win = names[0] || ""; picks.place = names[1] || ""; picks.show = names[2] || "";
        return picks;
      }
      const txt = sel => (scope.querySelector(sel)?.textContent || "").trim();
      picks.win   = txt("[data-pick='win'], .pick-win b, .emoji-win~b");
      picks.place = txt("[data-pick='place'], .pick-place b, .emoji-place~b");
      picks.show  = txt("[data-pick='show'], .pick-show b, .emoji-show~b");
      return picks;
    } catch { return { win: "", place: "", show: "" }; }
  };

  const pushSnapshot = (track, raceNo, picks) => {
    try {
      if (!track) return;
      const dayKey = todayISO();
      const key = `fl:snap:${dayKey}:${track}:${(raceNo || "nr")}`;
      const payload = {
        ts: Date.now(),
        date: dayKey,
        track, raceNo: raceNo || "",
        signals: { confidence: null, top3Mass: null, gap12: 0, gap23: 0 },
        picks
      };
      sessionStorage.setItem(key, JSON.stringify(payload));
    } catch {}
  };

  const scoreGZ = (sig) => {
    const c = +(sig?.confidence || 0);
    const m = +(sig?.top3Mass  || 0);
    const g12 = +(sig?.gap12   || 0);
    const g23 = +(sig?.gap23   || 0);
    const score = Math.min(100, 0.45 * c + 0.35 * m + 8 * g12 + 5 * g23);
    let suggested = "ATB";
    if (c >= 78 && g12 >= 2) suggested = "WinOnly";
    else if (m >= 55 && (g12 + g23) >= 3.5) suggested = "TrifectaBox";
    else if (m >= 52) suggested = "ExactaBox";
    const tier = score >= 72 ? "Green" : score >= 58 ? "Yellow" : "Red";
    return { score: Math.round(score), tier, suggested };
  };

  const ensureGZCard = (host) => {
    let wrap = qs("#flv-gz-today", host);
    if (wrap) return wrap;
    wrap = document.createElement("div");
    wrap.id = "flv-gz-today";
    wrap.style.cssText = "margin-top:12px;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px;background:rgba(35,37,44,.98);box-shadow:0 8px 20px rgba(0,0,0,.35)";
    wrap.innerHTML = `
      <div style="font:600 14px system-ui;display:flex;gap:8px;align-items:center">
        <span>🟢 Green-Zone (Today)</span>
        <small style="opacity:.75">Based on your predictions saved today</small>
      </div>
      <div id="gz-today-list" style="margin-top:8px"></div>
      <div id="gz-today-summary" style="margin-top:8px;opacity:.9"></div>
    `;
    host.appendChild(wrap);
    return wrap;
  };

  const updateGreenZoneToday = (host) => {
    const card = ensureGZCard(host);
    const list = card.querySelector("#gz-today-list");
    const summary = card.querySelector("#gz-today-summary");
    if (!list || !summary) return;

    const dayKey = todayISO();
    const rows = [];
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i) || "";
        if (!key.startsWith(`fl:snap:${dayKey}:`)) continue;
        try {
          const raw = sessionStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (parsed && parsed.signals) rows.push(parsed);
        } catch {}
      }
    } catch {}

    if (!rows.length) {
      list.textContent = "No predictions captured today yet.";
      summary.textContent = "";
      return;
    }

    const scored = rows.map(r => ({ ...r, gz: scoreGZ(r.signals || {}) }))
                       .sort((a,b) => b.gz.score - a.gz.score);

    const map = { WinOnly:"Win-Only", ATB:"Across The Board", ExactaBox:"Exacta Box", TrifectaBox:"Trifecta Box" };
    const tbl = document.createElement("table");
    tbl.style.cssText = "width:100%;border-collapse:collapse;font:12px system-ui";
    tbl.innerHTML = `<thead><tr>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Track</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Race</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Score</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Tier</th>
        <th style="text-align:left;padding:6px 4px;opacity:.8">Suggested</th>
      </tr></thead>
      <tbody>${scored.map(r => `
        <tr>
          <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.track || "—"}</td>
          <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.raceNo || "—"}</td>
          <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.gz.score}</td>
          <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${r.gz.tier}</td>
          <td style="padding:4px;border-top:1px solid rgba(255,255,255,.10)">${map[r.gz.suggested] || "ATB"}</td>
        </tr>`).join("")}
      </tbody>`;
    list.innerHTML = ""; list.appendChild(tbl);

    const counts = { WinOnly:0, ATB:0, ExactaBox:0, TrifectaBox:0 };
    scored.forEach(r => { counts[r.gz.suggested] = (counts[r.gz.suggested] || 0) + 1; });
    summary.innerHTML = `<b>Suggested Bets (Today):</b> Win-Only ${counts.WinOnly||0} • ATB ${counts.ATB||0} • Exacta Box ${counts.ExactaBox||0} • Trifecta Box ${counts.TrifectaBox||0}`;
  };

  const backfillPending = async () => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith("fl:pending:"));
      if (!keys.length) return;
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        let payload = {}; try { payload = JSON.parse(raw || "{}"); } catch {}
        const body = {
          track: payload.track || "",
          date:  payload.date  || todayISO(),
          raceNo: payload.raceNo || undefined,
          predicted: payload.predicted || {}
        };
        if (!body.track) continue;
        const resp = await fetch("/api/verify_race", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await resp.json().catch(() => ({}));
        if (data && (data.outcome || data.top || data.summary || data.error)) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
  };

  const buildModal = () => {
    let host = qs("#fl-verify-modal-host");
    if (host) return host;

    host = document.createElement("div");
    host.id = "flv-verify-modal-host";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)";
    host.innerHTML = `
      <div role="dialog" aria-modal="true" class="flv-card" style="width:min(920px,96vw);max-height:90vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.98);backdrop-filter:blur(6px);padding:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0;font:600 20px/1.2 system-ui">Verify Race</h3>
          <button id="flv-close" style="border:none;background:transparent;color:inherit;font:600 16px;opacity:.8">✕</button>
        </div>

        <div id="flv-status" style="font:600 12px/1.2 system-ui;opacity:.85;margin-bottom:10px">Idle</div>

        <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-bottom:12px;">
          <label style="flex:1 1 360px; min-width:260px;">
            <div style="margin:0 0 6px 0;opacity:.9">Track <span style="color:#ffcc00">*</span></div>
            <input id="flv-track" type="text" placeholder="Track"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
            <small id="flv-track-warn" style="display:none;color:#ffcc00">Track is required.</small>
          </label>

          <label style="flex:0 0 140px;">
            <div style="margin:0 0 6px 0;opacity:.9">Race # (optional)</div>
            <input id="flv-race" type="text" inputmode="numeric" placeholder="e.g. 6"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit"/>
            <small id="flv-race-warn" style="display:none;color:#ffcc00">Server asked for a Race # — please add one.</small>
          </label>

          <label style="flex:0 0 170px;">
            <div style="margin:0 0 6px 0;opacity:.9">Date</div>
            <input id="flv-date" type="date"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.02);color:inherit;appearance:auto"/>
          </label>
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

        <div id="flv-gz-host" style="margin-top:10px;"></div>
      </div>
    `;
    document.body.appendChild(host);

    host.__flvLast = { top: null, query: "" };

    qs("#flv-close", host)?.addEventListener("click", () => host.style.display = "none");

    const runBtn     = qs("#flv-run", host);
    const statusEl   = qs("#flv-status", host);
    const sumDetails = qs("#flv-sum", host);
    const summaryEl  = qs("#flv-sum-body", host);
    const trackInput = qs("#flv-track", host);
    const raceInput  = qs("#flv-race", host);
    const dateInput  = qs("#flv-date", host);

    ensureGZCard(qs("#flv-gz-host", host) || host);

    if (dateInput && !dateInput.value) dateInput.value = todayISO();

    if (runBtn) {
      const defaultLabel = runBtn.textContent || "Verify Now";
      runBtn.addEventListener("click", async () => {
        const track = (trackInput?.value || "").trim();
        const raceNo = (raceInput?.value || "").trim();
        const date = (dateInput?.value || "").trim() || todayISO();

        const trackWarn = qs("#flv-track-warn", host);
        const raceWarn  = qs("#flv-race-warn", host);
        if (trackWarn) trackWarn.style.display = track ? "none" : "";
        if (!track) { try { trackInput?.focus(); } catch {} return; }
        if (raceWarn) raceWarn.style.display = "none";

        if (statusEl) { statusEl.textContent = "Running…"; statusEl.style.color = "#cbd5f5"; }
        if (summaryEl) summaryEl.textContent = "Working…";
        runBtn.disabled = true; runBtn.textContent = "Running…";

        try {
          pushSnapshot(track, raceNo, readUIPredictions());

          try {
            const pendingKey = `fl:pending:${date}:${track}:${raceNo || "nr"}`;
            localStorage.setItem(pendingKey, JSON.stringify({ date, track, raceNo, predicted: readUIPredictions() }));
          } catch {}

          const resp = await fetch("/api/verify_race", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track, date, raceNo: raceNo || undefined, predicted: readUIPredictions() })
          });
          const data = await resp.json().catch(() => ({}));

          if (statusEl) {
            statusEl.textContent = resp.ok ? "OK" : `Error ${resp.status}`;
            statusEl.style.color  = resp.ok ? "#cbd5f5" : "#f87171";
          }

          if (sumDetails) sumDetails.open = true;
          if (summaryEl) {
            const lines = [];
            if (data.query) lines.push(`Query: ${data.query}`);
            const primary =
              data.summary ||
              (data.top?.title ? `Top Result: ${data.top.title}${data.top.link ? `\n${data.top.link}` : ""}` : "") ||
              (data.error ? `Server message: ${data.error}` : "");
            if (primary) lines.push(primary);
            if (data.outcome && (data.outcome.win || data.outcome.place || data.outcome.show)) {
              lines.push(`Outcome: ${[data.outcome.win, data.outcome.place, data.outcome.show].filter(Boolean).join(" / ")}`);
            }
            if (data.hits) {
              const hitText = [
                data.hits.winHit ? "Win" : null,
                data.hits.placeHit ? "Place" : null,
                data.hits.showHit ? "Show" : null
              ].filter(Boolean).join(", ");
              if (hitText) lines.push(`Hits: ${hitText}`);
            }
            if (!lines.length) lines.push("No summary returned.");
            summaryEl.textContent = lines.join("\n");

            try {
              if (data && (data.outcome || data.top || data.summary || data.error)) {
                const k = `fl:pending:${date}:${track}:${raceNo || "nr"}`;
                localStorage.removeItem(k);
              }
            } catch {}
          }
        } catch (err) {
          if (statusEl) { statusEl.textContent = "Error"; statusEl.style.color = "#f87171"; }
          if (summaryEl) summaryEl.textContent = "Request failed. Check network console.";
          console.error(err);
        } finally {
          runBtn.disabled = false; runBtn.textContent = defaultLabel;
          updateGreenZoneToday(qs("#flv-gz-host", host) || host);
          backfillPending();
        }
      });
    }

    qs("#flv-open-top", host)?.addEventListener("click", () => {
      try { const u = host.__flvLast?.top?.link; if (u) window.open(u, "_blank", "noopener"); } catch {}
    });
    qs("#flv-open-google", host)?.addEventListener("click", () => {
      try { const q = host.__flvLast?.query || ""; window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank", "noopener"); } catch {}
    });

    host.__flvUpdateGZ = () => updateGreenZoneToday(qs("#flv-gz-host", host) || host);
    return host;
  };

  const prefill = (host, ctx) => {
    const saved   = readCtx();
    const track   = (ctx?.track)  || currentTrack()   || saved.track  || "";
    const race    = (ctx?.raceNo) || currentRaceNo()  || saved.raceNo || "";
    const trackEl = qs("#flv-track", host);
    const raceEl  = qs("#flv-race",  host);
    const dateEl  = qs("#flv-date",  host);

    if (trackEl) trackEl.value = track;
    if (raceEl)  raceEl.value  = race || "";
    if (dateEl && !dateEl.value) dateEl.value = todayISO();

    const statusEl  = qs("#flv-status", host);
    const summaryEl = qs("#flv-sum-body", host);
    if (statusEl)  { statusEl.textContent = "Idle"; statusEl.style.color = "#cbd5f5"; }
    if (summaryEl) summaryEl.textContent = "No summary returned.";

    pushSnapshot(track, race, readUIPredictions());
    if (typeof host.__flvUpdateGZ === "function") host.__flvUpdateGZ();
  };

  const open = (ctx) => {
    const host = buildModal();
    prefill(host, ctx);
    host.style.display = "flex";
    try { qs("#flv-track", host)?.focus(); } catch {}
  };

  window.__FL_OPEN_VERIFY_MODAL__ = open;
})();

