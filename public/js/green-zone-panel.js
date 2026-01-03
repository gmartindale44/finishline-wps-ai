;(function(){
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_GZ_PANEL__) return; window.__FL_GZ_PANEL__ = true;

  const pickNum = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const text = el.textContent || "";
    const pct = text.match(/(\d+(?:\.\d+)?)%/);
    if (pct) return parseFloat(pct[1]);
    const num = text.match(/(\d+(?:\.\d+)?)/);
    return num ? parseFloat(num[1]) : null;
  };

  const card = document.querySelector('.strategy-card') || document.querySelector('[data-panel="strategy"]');
  if (!card) return;

  const confidence = pickNum('.strategy-card [data-metric="confidence"], .strategy-card .confidence');
  const top3Mass = pickNum('.strategy-card [data-metric="top3mass"], .strategy-card .top3mass');
  const gap12 = pickNum('.strategy-card [data-metric="gap12"], .strategy-card .gap12');
  const gap23 = pickNum('.strategy-card [data-metric="gap23"], .strategy-card .gap23');

  if (confidence == null || top3Mass == null) return;

  const host = document.createElement('div');
  host.className = 'gz-panel';
  host.style.cssText = 'margin-top:10px;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;background:rgba(255,255,255,.03)';
  host.innerHTML = `
    <div style="font:600 14px system-ui;display:flex;gap:8px;align-items:center">
      <span>🟢 Green-Zone (beta)</span>
      <span id="gz-badge" style="padding:2px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.15);opacity:.85">Scoring…</span>
    </div>
    <div id="gz-note" style="margin-top:6px;opacity:.85;font:12px system-ui"></div>
  `;
  card.appendChild(host);

  const signals = {
    confidence,
    top3Mass,
    gap12: gap12 || 0,
    gap23: gap23 || 0,
  };

  const trackInput = document.querySelector('#race-track, input[name="track"]');
  const raceInput = document.querySelector('input[name*="race" i], #race-number');
  const dateInput = document.querySelector('input[type="date"], #race-date');

  fetch('/api/green_zone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signals,
      track: trackInput && trackInput.value ? trackInput.value.trim() : '',
      raceNo: raceInput && raceInput.value ? raceInput.value.trim() : '',
      date: dateInput && dateInput.value ? dateInput.value.trim() : '',
    }),
  })
    .then(async (r) => {
      // Check if PayGate is locked before parsing
      if (!r.ok && typeof window !== 'undefined' && window.handlePaygateLocked) {
        const isPaygateLocked = await window.handlePaygateLocked(r);
        if (isPaygateLocked) {
          // PayGate modal shown, return empty data to stop processing
          return { ok: false, paygateLocked: true };
        }
      }
      return r.json();
    })
    .then((data) => {
      // Skip processing if PayGate was locked
      if (data?.paygateLocked) {
        return;
      }
      if (!data || !data.ok) return;
      const badge = document.getElementById('gz-badge');
      const note = document.getElementById('gz-note');
      if (!badge || !note) return;

      const gz = data.greenZone || {};
      badge.textContent = `${gz.tier || 'Red'} • ${gz.score ?? 0}`;
      badge.style.background = gz.tier === 'Green'
        ? 'rgba(34,197,94,.15)'
        : gz.tier === 'Yellow'
          ? 'rgba(234,179,8,.15)'
          : 'rgba(239,68,68,.12)';
      badge.style.borderColor = gz.tier === 'Green'
        ? 'rgba(34,197,94,.4)'
        : gz.tier === 'Yellow'
          ? 'rgba(234,179,8,.4)'
          : 'rgba(239,68,68,.4)';

      const map = {
        WinOnly: 'Win-Only',
        ATB: 'Across The Board',
        ExactaBox: 'Exacta Box',
        TrifectaBox: 'Trifecta Box',
      };
      note.innerHTML = `<b>Suggested:</b> ${map[gz.suggested] || 'Across The Board'} — ${gz.note || ''}`;
    })
    .catch(() => {});
})();
