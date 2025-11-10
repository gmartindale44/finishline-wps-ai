(() => {

  const TAB_ID = 'fl-tab-verify';
  const PANEL_ID = 'fl-panel-verify';
  const BTN_ID = 'fl-verify-run';
  const STATUS_ID = 'fl-verify-status';
  const RESULT_ID = 'fl-verify-results';

  function $(sel, root=document) { return root.querySelector(sel); }
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  // Heuristic: pull context from visible predictions modal if present
  function getRaceContext() {
    const ctx = { track: '', raceNo: '', date: '' };
    try {
      // Track: often captured in the header or the track input control on the page
      // Fall back to last used track stored by combobox helper
      const trackInput = document.querySelector('input[name="track"], #track, .track-input');
      if (trackInput && trackInput.value) ctx.track = trackInput.value.trim();

      // Race number: try a numeric input or label text like "Race 7"
      const raceInput = document.querySelector('input[name="raceNo"], #raceNo, .race-input');
      if (raceInput && raceInput.value) ctx.raceNo = String(raceInput.value).trim();
      if (!ctx.raceNo) {
        const hdr = Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(n => n.textContent || '').join(' ');
        const m = hdr.match(/\bRace\s+(\d+)\b/i);
        if (m) ctx.raceNo = m[1];
      }

      // Date: default to today in YYYY-MM-DD; allow any date input on page to override
      const toYMD = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        return `${y}-${m}-${dd}`;
      };
      ctx.date = toYMD(new Date());
      const dateInput = document.querySelector('input[type="date"], input[name="date"], #date');
      if (dateInput && dateInput.value) ctx.date = dateInput.value.trim();
    } catch {}
    return ctx;
  }

  function ensureTab() {
    // Find predictions modal tabs container
    const modal = document.querySelector('.predictions-modal, .predictions, [data-fl="predictions-modal"]') || document;
    const tabsBar = Array.from(modal.querySelectorAll('.tabs, .predictions-tabs, .modal-tabs, [role="tablist"]')).find(Boolean)
      || modal.querySelector('.modal-header') || modal;
    // Find existing tab headers (Predictions / Exotic Ideas / Strategy)
    const hasVerify = document.getElementById(TAB_ID);
    if (hasVerify) return true;

    if (!tabsBar) return false;

    // Try to locate Strategy tab to insert after it
    const strategyTab = Array
      .from(modal.querySelectorAll('button, a, .tab'))
      .find(n => /strategy/i.test(n.textContent || ''));

    // Build Verify tab button
    const tabBtn = el('button', 'fl-tab');
    tabBtn.id = TAB_ID;
    tabBtn.type = 'button';
    tabBtn.textContent = 'Verify';
    tabBtn.setAttribute('aria-controls', PANEL_ID);

    // Insert after Strategy (fallback: append)
    if (strategyTab && strategyTab.parentNode) {
      strategyTab.parentNode.insertBefore(tabBtn, strategyTab.nextSibling);
    } else {
      tabsBar.appendChild(tabBtn);
    }

    // Build Verify panel container (hidden by default)
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el('div', 'fl-panel');
      panel.id = PANEL_ID;
      panel.style.display = 'none';
      // Try to place where other panels live
      const strategyPanel = Array
        .from(modal.querySelectorAll('.panel, .tab-panel, .predictions-panel'))
        .find(n => /strategy/i.test(n.textContent || '') || n.id?.match(/strategy/i));
      const panelHost = strategyPanel?.parentNode || modal.querySelector('.modal-body') || modal;
      panelHost.appendChild(panel);
    }

    // Render simple form UI
    const ctx = getRaceContext();
    panel.innerHTML = `
      <div class="fl-verify-wrap">
        <div class="fl-verify-grid">
          <label>Track
            <input id="flv-track" placeholder="e.g., Penn National" value="${ctx.track || ''}">
          </label>
          <label>Race #
            <input id="flv-race" type="number" min="1" step="1" placeholder="e.g., 7" value="${ctx.raceNo || ''}">
          </label>
          <label>Date
            <input id="flv-date" type="date" value="${ctx.date || ''}">
          </label>
        </div>
        <div class="fl-verify-actions">
          <button id="${BTN_ID}" type="button">Run Verify</button>
          <span id="${STATUS_ID}" class="fl-verify-status" aria-live="polite"></span>
        </div>
        <div id="${RESULT_ID}" class="fl-verify-results"></div>
      </div>
    `;

    function setStatus(msg, type='') {
      const s = document.getElementById(STATUS_ID);
      if (!s) return;
      s.textContent = msg || '';
      s.className = `fl-verify-status ${type}`;
    }

    async function runVerify() {
      const track = $('#flv-track')?.value?.trim();
      const raceNo = Number($('#flv-race')?.value || 0);
      const date = $('#flv-date')?.value?.trim();
      if (!track || !raceNo || !date) {
        setStatus('Please fill Track, Race #, and Date.', 'error');
        return;
      }
      setStatus('Verifying…', 'busy');
      const resultsBox = $('#'+RESULT_ID);
      if (resultsBox) resultsBox.innerHTML = '';
      try {
        const res = await fetch('/api/verify_race', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track, raceNo, date })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Verify failed');
        // Expect shape: { ok:true, cacheKey, hits:[{title,url,snippet}], summary?:{...} }
        const hits = Array.isArray(json?.hits) ? json.hits : [];
        const cacheKey = json?.cacheKey || '';
        const meta = json?.summary || json?.result || {};
        setStatus('Verified and saved (Redis + CSV).', 'ok');
        const list = hits.map(h => `
          <li>
            <div class="fl-hit-title">${h.title || '(no title)'}</div>
            <div class="fl-hit-url"><a href="${h.url}" target="_blank" rel="noopener">${h.url}</a></div>
            <div class="fl-hit-snippet">${h.snippet || ''}</div>
          </li>
        `).join('');
        if (resultsBox) {
          resultsBox.innerHTML = `
            <div class="fl-verify-meta">
              ${cacheKey ? `<div><strong>Cache:</strong> ${cacheKey}</div>` : ''}
              ${meta?.resolvedAt ? `<div><strong>Time:</strong> ${meta.resolvedAt}</div>` : ''}
            </div>
            <h4>Top Matches</h4>
            <ol class="fl-verify-list">${list || '<li>No matches.</li>'}</ol>
          `;
        }
      } catch (err) {
        console.error('[verify] error', err);
        setStatus(String(err.message || err), 'error');
      }
    }

    // Wire tab switching (keeps existing behavior intact)
    tabBtn.addEventListener('click', () => {
      // Hide other panels, show ours
      const panels = Array.from(modal.querySelectorAll('.fl-panel, .panel, .tab-panel'));
      panels.forEach(p => (p.id === PANEL_ID ? p.style.display = '' : p.style.display = 'none'));
      // Unselect other tabs, select ours (best-effort)
      Array.from(modal.querySelectorAll('.fl-tab, .tab, [role="tab"]')).forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
    });

    // Wire run button
    $('#'+BTN_ID)?.addEventListener('click', runVerify);

    // Basic CSS (scoped)
    if (!document.getElementById('fl-verify-style')) {
      const st = document.createElement('style');
      st.id = 'fl-verify-style';
      st.textContent = `
        #${PANEL_ID} .fl-verify-grid { display:grid; gap:.75rem; grid-template-columns: 2fr 1fr 1.4fr; margin: .5rem 0 1rem; }
        #${PANEL_ID} label { font-size:.9rem; display:flex; flex-direction:column; gap:.25rem; }
        #${PANEL_ID} input { padding:.5rem .6rem; border-radius:.5rem; border:1px solid var(--border, #333); background:var(--bg2, #151515); color:inherit; }
        #${PANEL_ID} .fl-verify-actions { display:flex; align-items:center; gap:.75rem; margin-bottom: .75rem; }
        #${PANEL_ID} button#${BTN_ID} { padding:.5rem .9rem; border-radius:.6rem; border:0; cursor:pointer; }
        #${PANEL_ID} .fl-verify-status { min-height:1.2rem; font-size:.9rem; opacity:.85; }
        #${PANEL_ID} .fl-verify-status.busy { color:#caa700; }
        #${PANEL_ID} .fl-verify-status.ok { color:#43c17a; }
        #${PANEL_ID} .fl-verify-status.error { color:#e76e6e; }
        #${PANEL_ID} .fl-verify-results { border-top:1px solid var(--border, #333); padding-top:.75rem; }
        #${PANEL_ID} .fl-verify-list { display:grid; gap:.5rem; margin:.5rem 0; }
        #${PANEL_ID} .fl-hit-title { font-weight:600; }
        #${PANEL_ID} .fl-hit-url a { font-size:.85rem; opacity:.9; }
        #${PANEL_ID} h4 { margin:.5rem 0; }
      `;
      document.head.appendChild(st);
    }

    return true;
  }

  // Bootstrap when predictions modal is present
  const tryInit = () => {
    const ok = ensureTab();
    if (!ok) setTimeout(tryInit, 600);
  };
  tryInit();
  // Also re-run on hash/nav changes for SPA-ish behavior
  window.addEventListener('popstate', tryInit);
  window.addEventListener('hashchange', tryInit);
})();
