/**
 * Verify Tab – adds a first-class verification workflow inside the Predictions modal.
 * - Mounts a new tab beside the existing ones (Strategy, etc.).
 * - Prefills race context from the page but allows user edits.
 * - Calls /api/verify_race and renders results (top 5) with cache awareness.
 * - Guards against duplicate mounts and survives modal re-renders.
 */
(function verifyTabBootstrap() {
  const MAX_WAIT_MS = 10_000;
  const POLL_INTERVAL_MS = 250;
  const FLAG_ATTR = 'data-fl-verify-tab-mounted';
  const TAB_SELECTOR = '.fl-tabs, .tabs, [data-fl-tabs]';
  const PANEL_ID = 'fl-verify-panel';
  const TAB_ID = 'fl-verify-tab';

  let stopPolling = false;
  const observedBars = new WeakSet();

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function todayYMD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function inferContext() {
    const ctx = {
      track: '',
      date: todayYMD(),
      raceNo: '',
      distance: '',
      surface: '',
      strategy: '',
      aiPicks: ''
    };

    try {
      ctx.track = (
        $('[data-track]')?.getAttribute('data-track') ||
        $('.fl-track-name')?.textContent ||
        $('input[name="track"], #track, [data-fl-track]')?.value ||
        ''
      ).trim();

      const raceLabel = (
        $('.fl-race-no')?.textContent ||
        $('[data-race]')?.getAttribute('data-race') ||
        $('[data-race-number]')?.getAttribute('data-race-number') ||
        $('input[name="race"], #race, [data-fl-race]')?.value ||
        ''
      ).toString();
      const raceMatch = raceLabel.match(/\b(?:race|r)\s*#?\s*(\d+)\b/i) || raceLabel.match(/\b(\d{1,2})\b/);
      if (raceMatch) ctx.raceNo = raceMatch[1];

      const dateValue = (
        $('[data-race-date]')?.getAttribute('data-race-date') ||
        $('input[type="date"], input[name="date"], #date, [data-fl-date]')?.value ||
        ''
      ).trim();
      if (dateValue) ctx.date = dateValue;

      ctx.distance = (
        $('.fl-distance')?.textContent ||
        $('[data-fl-distance]')?.getAttribute('data-fl-distance') ||
        ''
      ).trim();

      ctx.surface = (
        $('.fl-surface')?.textContent ||
        $('[data-fl-surface]')?.getAttribute('data-fl-surface') ||
        ''
      ).trim();

      ctx.strategy = (
        $('.fl-strategy-active')?.textContent ||
        $('.fl-strategy-name')?.textContent ||
        $('[data-fl-strategy]')?.getAttribute('data-fl-strategy') ||
        ''
      ).trim();

      const picks = $all('.fl-pick, [data-fl-pick]').map((el) => el.textContent.trim()).filter(Boolean);
      if (picks.length) ctx.aiPicks = picks.join(' | ');
    } catch (err) {
      console.info('[verify-tab] context inference failed softly', err);
    }

    return ctx;
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'fl-panel hidden';
    panel.setAttribute('aria-hidden', 'true');

    panel.innerHTML = `
      <div class="fl-verify-form">
        <div class="fl-verify-grid">
          <label>Track
            <input id="flv-track" name="track" placeholder="e.g., Penn National" autocomplete="off" />
          </label>
          <label>Date
            <input id="flv-date" name="date" type="date" />
          </label>
          <label>Race #
            <input id="flv-race" name="raceNo" type="number" min="1" step="1" inputmode="numeric" />
          </label>
        </div>
        <div class="fl-verify-grid">
          <label>Distance
            <input id="flv-distance" name="distance" placeholder="optional" />
          </label>
          <label>Surface
            <input id="flv-surface" name="surface" placeholder="optional" />
          </label>
          <label>Strategy
            <input id="flv-strategy" name="strategy" placeholder="optional" />
          </label>
        </div>
        <label>AI Picks
          <textarea id="flv-picks" name="ai_picks" rows="2" placeholder="AI picks (WIN | PLACE | SHOW)"></textarea>
        </label>
        <div class="fl-verify-actions">
          <button type="button" id="flv-run" class="fl-btn fl-btn-primary">Run Verify</button>
          <div id="flv-status" class="fl-verify-status" aria-live="polite"></div>
        </div>
      </div>
      <div id="flv-results" class="fl-verify-results">
        <div class="fl-verify-placeholder">Results will appear here.</div>
      </div>
    `;

    // Inline minimal styling scoped to panel
    if (!document.getElementById('fl-verify-styles')) {
      const style = document.createElement('style');
      style.id = 'fl-verify-styles';
      style.textContent = `
        #${PANEL_ID} { padding: 16px; border-radius: 10px; background: rgba(12,12,20,0.85); border: 1px solid rgba(255,255,255,0.06); color: inherit; }
        #${PANEL_ID}.hidden { display: none; }
        #${PANEL_ID} .fl-verify-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 12px; }
        #${PANEL_ID} label { display: flex; flex-direction: column; font-size: 0.9rem; gap: 6px; }
        #${PANEL_ID} input, #${PANEL_ID} textarea { padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(8,8,14,0.9); color: inherit; }
        #${PANEL_ID} textarea { resize: vertical; min-height: 70px; }
        #${PANEL_ID} .fl-verify-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
        #${PANEL_ID} #flv-run { padding: 8px 16px; border-radius: 999px; cursor: pointer; }
        #${PANEL_ID} #flv-run[disabled] { opacity: 0.6; cursor: wait; }
        #${PANEL_ID} .fl-verify-status { min-height: 1.2rem; font-size: 0.9rem; opacity: 0.85; }
        #${PANEL_ID} .fl-verify-status.error { color: #ff9898; }
        #${PANEL_ID} .fl-verify-status.ok { color: #8de0b5; }
        #${PANEL_ID} .fl-verify-status.cached { color: #74b9ff; }
        #${PANEL_ID} .fl-verify-results { margin-top: 18px; display: grid; gap: 12px; }
        #${PANEL_ID} .fl-verify-summary { display:flex; flex-wrap:wrap; gap:12px; font-size:0.9rem; }
        #${PANEL_ID} .fl-verify-chip { padding:4px 8px; border-radius:999px; background:rgba(255,255,255,0.08); }
        #${PANEL_ID} .fl-verify-list { list-style:none; padding:0; margin:0; display:grid; gap:10px; }
        #${PANEL_ID} .fl-verify-item { padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(12,12,22,0.6); }
        #${PANEL_ID} .fl-verify-item h4 { margin:0 0 4px 0; font-size:1rem; }
        #${PANEL_ID} .fl-verify-item a { color:#7ecbff; word-break:break-all; }
        #${PANEL_ID} .fl-verify-placeholder { opacity:0.6; font-size:0.9rem; }
        #${PANEL_ID} .fl-verify-error { padding:12px; border-radius:8px; background:rgba(255,80,80,0.15); border:1px solid rgba(255,120,120,0.3); }
      `;
      document.head.appendChild(style);
    }

    return panel;
  }

  function showPanel(panel, tabButton) {
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');

    $all('.fl-panel').forEach((p) => {
      if (p !== panel) {
        p.classList.add('hidden');
        p.setAttribute('aria-hidden', 'true');
      }
    });

    const tabs = $all(`${TAB_SELECTOR} .fl-tab, ${TAB_SELECTOR} button, ${TAB_SELECTOR} [role="tab"]`);
    tabs.forEach((btn) => btn.classList && btn.classList.remove('active'));
    if (tabButton?.classList) tabButton.classList.add('active');
  }

  function hidePanel(panel, tabButton) {
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    tabButton?.classList?.remove('active');
  }

  function renderResults(container, payload) {
    if (!container) return;
    const isCached = Boolean(payload?.cached);
    const hits = Array.isArray(payload?.items) ? payload.items : [];
    const top = payload?.topHit || hits[0] || null;
    const summaryHtml = `
      <div class="fl-verify-summary">
        <span class="fl-verify-chip">${payload?.query || 'No query'}</span>
        <span class="fl-verify-chip">${hits.length} hit${hits.length === 1 ? '' : 's'}</span>
        ${isCached ? '<span class="fl-verify-chip">from cache</span>' : ''}
      </div>
    `;

    const topHtml = top
      ? `<div class="fl-verify-item">
          <h4>Top result</h4>
          <div><strong>${top.title || '(no title)'}</strong></div>
          ${top.link ? `<div><a href="${top.link}" target="_blank" rel="noopener">${top.link}</a></div>` : ''}
          ${top.snippet ? `<p>${top.snippet}</p>` : ''}
        </div>`
      : '';

    const listHtml = hits.length
      ? `<ol class="fl-verify-list">
          ${hits
            .map(
              (hit) => `
                <li class="fl-verify-item">
                  <h4>${hit.title || '(no title)'}</h4>
                  ${hit.link ? `<div><a href="${hit.link}" target="_blank" rel="noopener">${hit.link}</a></div>` : ''}
                  ${hit.snippet ? `<p>${hit.snippet}</p>` : ''}
                </li>
              `
            )
            .join('')}
        </ol>`
      : '<div class="fl-verify-placeholder">No matches were returned.</div>';

    container.innerHTML = summaryHtml + topHtml + listHtml;
  }

  function renderError(container, message) {
    if (!container) return;
    container.innerHTML = `<div class="fl-verify-error">${message}</div>`;
  }

  function attachRunHandler(panel) {
    const runBtn = panel.querySelector('#flv-run');
    const statusEl = panel.querySelector('#flv-status');
    const resultsEl = panel.querySelector('#flv-results');

    const setStatus = (message, state = '') => {
      if (!statusEl) return;
      statusEl.textContent = message || '';
      statusEl.className = `fl-verify-status ${state}`.trim();
    };

    runBtn?.addEventListener('click', async () => {
      const payload = {
        track: panel.querySelector('#flv-track')?.value?.trim() || '',
        date: panel.querySelector('#flv-date')?.value?.trim() || todayYMD(),
        raceNo: Number(panel.querySelector('#flv-race')?.value || 0) || '',
        distance: panel.querySelector('#flv-distance')?.value?.trim() || '',
        surface: panel.querySelector('#flv-surface')?.value?.trim() || '',
        strategy: panel.querySelector('#flv-strategy')?.value?.trim() || '',
        ai_picks: panel.querySelector('#flv-picks')?.value?.trim() || ''
      };

      if (!payload.track || !payload.date || !payload.raceNo) {
        setStatus('Track, Date, and Race # are required.', 'error');
        return;
      }

      try {
        runBtn.disabled = true;
        setStatus('Verifying…');
        renderResults(resultsEl, { query: payload.track, items: [] });

        const res = await fetch('/api/verify_race', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          const detail = json?.error || res.statusText || 'Verify failed.';
          if (/GOOGLE_.* missing/i.test(detail) || /Missing GOOGLE/i.test(detail)) {
            renderError(resultsEl, 'Missing Google Custom Search credentials. Set GOOGLE_API_KEY and GOOGLE_CSE_ID in Vercel (Preview & Production).');
          } else {
            renderError(resultsEl, detail);
          }
          setStatus('Verification failed.', 'error');
          return;
        }

        renderResults(resultsEl, json);
        setStatus(json.cached ? 'Verified (cached)' : 'Verified successfully.', json.cached ? 'cached' : 'ok');
      } catch (err) {
        console.error('[verify-tab] error', err);
        renderError(resultsEl, err?.message || 'Unexpected error running verification.');
        setStatus('Verification error.', 'error');
      } finally {
        runBtn.disabled = false;
      }
    });
  }

  function mountInTabs(tabsBar) {
    if (!tabsBar || observedBars.has(tabsBar)) return;
    observedBars.add(tabsBar);

    const tabButton = document.createElement('button');
    tabButton.id = TAB_ID;
    tabButton.type = 'button';
    tabButton.className = 'fl-tab';
    tabButton.textContent = 'Verify';
    tabButton.setAttribute('aria-controls', PANEL_ID);

    // Insert after Strategy tab if it exists
    const siblings = $all('button, .fl-tab, [role="tab"], a', tabsBar);
    const strategy = siblings.find((el) => /strategy/i.test(el.textContent || ''));
    if (strategy?.parentNode) {
      strategy.parentNode.insertBefore(tabButton, strategy.nextSibling);
    } else {
      tabsBar.appendChild(tabButton);
    }

    const panelHost = $('#fl-panel-host') || $('.fl-panels') || document.querySelector('.fl-modal, [data-fl-panels]') || document.body;
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = createPanel();
      panelHost.appendChild(panel);
    }

    // Prefill inputs
    const ctx = inferContext();
    const setValue = (selector, value) => {
      const el = panel.querySelector(selector);
      if (el && value) el.value = value;
    };
    setValue('#flv-track', ctx.track);
    setValue('#flv-date', ctx.date);
    setValue('#flv-race', ctx.raceNo);
    setValue('#flv-distance', ctx.distance);
    setValue('#flv-surface', ctx.surface);
    setValue('#flv-strategy', ctx.strategy);
    setValue('#flv-picks', ctx.aiPicks);

    attachRunHandler(panel);

    tabButton.addEventListener('click', () => {
      showPanel(panel, tabButton);
    });

    tabsBar.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button, .fl-tab, [role="tab"], a') : null;
      if (!target) return;
      if (target === tabButton) return;
      hidePanel(panel, tabButton);
    });

    console.info('[verify-tab] mounted');
  }

  function attemptMount() {
    if (document.documentElement.hasAttribute(FLAG_ATTR)) return;

    const bars = $all(TAB_SELECTOR).filter(Boolean);
    if (bars.length) {
      document.documentElement.setAttribute(FLAG_ATTR, 'true');
      bars.forEach(mountInTabs);
      stopPolling = true;
      return;
    }
  }

  function observeForTabs() {
    const observer = new MutationObserver(() => {
      const bars = $all(TAB_SELECTOR).filter((bar) => !observedBars.has(bar));
      if (bars.length) {
        document.documentElement.setAttribute(FLAG_ATTR, 'true');
        bars.forEach(mountInTabs);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => observer.disconnect(), MAX_WAIT_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      attemptMount();
      observeForTabs();
    });
  } else {
    attemptMount();
    observeForTabs();
  }

  const pollStart = Date.now();
  const poll = setInterval(() => {
    if (stopPolling || Date.now() - pollStart > MAX_WAIT_MS) {
      clearInterval(poll);
      if (!stopPolling) console.info('[verify-tab] tabs not detected within timeout');
      return;
    }
    attemptMount();
  }, POLL_INTERVAL_MS);
})();
