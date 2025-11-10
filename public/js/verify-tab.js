/**
 * Verify Tab UI: adds a "Verify" tab after Strategy and wires to /api/verify_race.
 * Minimal DOM injection that does not mutate other panels.
 */
(function initVerifyTab() {
  const POLL_MS = 250;
  const once = (fn) => {
    let ran = false;
    return (...args) => { if (!ran) { ran = true; fn(...args); } };
  };

  const mount = once(() => {
    const header = document.querySelector('.predictions-tabs, .tabs, [data-fl-tabs]');
    const nav = header || document.querySelector('nav, .panel-tabs');
    if (!nav) return;

    // Find tab strip
    const tabStrip = nav.querySelector('ul') || nav;
    if (!tabStrip) return;

    // Skip if already present
    if (tabStrip.querySelector('[data-fl-verify-tab]')) return;

    // Create the tab button
    const li = document.createElement('li');
    li.setAttribute('data-fl-verify-tab', 'true');
    li.style.cursor = 'pointer';
    li.style.listStyle = 'none';
    li.style.marginLeft = '12px';

    const btn = document.createElement('button');
    btn.textContent = 'Verify';
    btn.className = 'btn btn-ghost';
    btn.style.padding = '6px 10px';
    li.appendChild(btn);

    // Insert after Strategy
    const labels = Array.from(tabStrip.querySelectorAll('li,button,a'));
    const strategy = labels.find((el) => /strategy/i.test(el.textContent || ''));
    if (strategy?.parentNode?.insertBefore) {
      strategy.parentNode.insertBefore(li, strategy.nextSibling);
    } else {
      tabStrip.appendChild(li);
    }

    // Panel
    const modalRoot = document.querySelector('.predictions-root, .modal-root, main') || document.body;
    let panel = document.querySelector('[data-fl-verify-panel]');
    if (!panel) {
      panel = document.createElement('section');
      panel.setAttribute('data-fl-verify-panel', 'true');
      panel.style.display = 'none';
      panel.style.marginTop = '16px';
      panel.style.padding = '16px';
      panel.style.borderRadius = '8px';
      panel.style.background = 'rgba(255,255,255,0.04)';
      panel.innerHTML = `
        <h3 style="margin:0 0 8px 0">Verify Results</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <input id="flv-track" placeholder="Track (e.g., Penn National)" style="flex:1;min-width:220px;padding:8px;border-radius:6px;border:1px solid #444;background:transparent;color:inherit"/>
          <input id="flv-date" placeholder="YYYY-MM-DD" style="width:160px;padding:8px;border-radius:6px;border:1px solid #444;background:transparent;color:inherit"/>
          <input id="flv-race" placeholder="Race #" style="width:120px;padding:8px;border-radius:6px;border:1px solid #444;background:transparent;color:inherit"/>
          <button id="flv-run" class="btn btn-primary">Verify result</button>
        </div>
        <pre id="flv-out" style="white-space:pre-wrap;max-height:240px;overflow:auto;margin:0;background:rgba(0,0,0,.2);padding:10px;border-radius:6px"></pre>
      `;
      modalRoot.appendChild(panel);
    }

    // Simple tab switching
    const allPanels = () =>
      Array.from(document.querySelectorAll('[data-fl-verify-panel], [data-fl-panel]'));
    const showPanel = (el) => {
      allPanels().forEach(p => (p.style.display = p === el ? 'block' : 'none'));
    };

    btn.addEventListener('click', () => showPanel(panel));

    // Try to auto-fill from existing UI fields if visible
    const getContext = () => {
      const track = document.querySelector('[name="track"], #track, [data-fl-track]')?.value?.trim()
                  || document.querySelector('#flv-track')?.value?.trim()
                  || '';
      const date  = document.querySelector('[name="date"], #date, [data-fl-date]')?.value?.trim()
                  || document.querySelector('#flv-date')?.value?.trim()
                  || '';
      const race  = document.querySelector('[name="race"], #race, [data-fl-race]')?.value?.trim()
                  || document.querySelector('#flv-race')?.value?.trim()
                  || '';
      return { track, date, raceNo: Number(race || 0) || null };
    };

    const setContext = ({track,date,raceNo}) => {
      const t = document.querySelector('#flv-track'); if (t && track) t.value = track;
      const d = document.querySelector('#flv-date');  if (d && date) d.value = date;
      const r = document.querySelector('#flv-race');  if (r && raceNo) r.value = String(raceNo);
    };

    // Try populate once
    setContext(getContext());

    // Wire the button
    panel.querySelector('#flv-run').addEventListener('click', async () => {
      const ctx = getContext();
      const out = panel.querySelector('#flv-out');
      if (!ctx.track || !ctx.date || !ctx.raceNo) {
        out.textContent = 'Please provide Track, Date, and Race #.';
        return;
      }
      out.textContent = 'Verifying…';
      try {
        const res = await fetch('/api/verify_race', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ track: ctx.track, date: ctx.date, raceNo: ctx.raceNo })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || res.statusText);
        out.textContent = JSON.stringify(json, null, 2);
      } catch (e) {
        out.textContent = `Error: ${e.message || e}`;
      }
    });
  });

  // Poll for shell to appear, then mount once
  const iv = setInterval(() => {
    try {
      const header = document.querySelector('.predictions-tabs, .tabs, [data-fl-tabs], nav');
      if (header) { clearInterval(iv); mount(); }
    } catch (e) {}
  }, POLL_MS);
})();
