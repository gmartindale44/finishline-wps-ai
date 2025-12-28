// public/js/results-panel.js - Persistent results panel for predictions

(function () {
  'use strict';

  // PayGate toggle - set to false to disable paygate entirely
  const PAYWALL_ENABLED = false;

  // PayGate helper - fail-open: if helper not loaded, default to unlocked
  const paygate = (typeof window !== 'undefined' && window.__FL_PAYGATE__) || (() => {
    console.warn('[FLResults] PayGate helper not loaded; showing all content (fail-open)');
    return {
      isUnlocked: () => true,
      checkUrlParams: () => ({ unlocked: false, bypassUsed: false }),
      getBypassUsed: () => false,
      DAY_PASS_URL: '#',
      CORE_MONTHLY_URL: '#'
    };
  })();

  const persistenceHelper = (() => {
    let readyPromise = null;

    function ensureReady() {
      if (!readyPromise) {
        readyPromise = fetch('/api/health', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((json) => Boolean(json?.persistence?.enabled && json?.persistence?.hasRedis))
          .catch(() => false);
      }
      return readyPromise;
    }

    function sendPayload(payload) {
      if (!payload) return;
      const json = JSON.stringify(payload);

      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([json], { type: 'application/json' });
          navigator.sendBeacon('/api/persistence', blob);
          return;
        }
      } catch (_) {
        // ignore sendBeacon failures and fall back to fetch
      }

      try {
        fetch('/api/persistence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: json,
          keepalive: true,
        }).catch(() => {});
      } catch (_) {
        // ignore fetch errors
      }
    }

    async function persist(payload) {
      if (!payload) return;
      const enabled = await ensureReady();
      if (!enabled) return;
      sendPayload(payload);
    }

    return {
      persist,
    };
  })();

  function coalesce(...values) {
    for (const value of values) {
      if (value != null && value !== '') {
        return value;
      }
    }
    return null;
  }

  function buildPersistencePayload(pred) {
    if (!pred || typeof pred !== 'object') return null;

    const meta = pred.meta || {};
    const picks = Array.isArray(pred.picks) ? pred.picks : [];

    const tracks = [
      meta.track,
      meta.Track,
      (typeof window !== 'undefined' && window.__fl_state?.track) || null,
    ];

    const surfaces = [
      meta.surface,
      meta.Surface,
      (typeof window !== 'undefined' && window.__fl_state?.surface) || null,
    ];

    const distances = [
      meta.distance,
      meta.distance_input,
      meta.distancePretty,
      (typeof window !== 'undefined' && window.__fl_state?.distance_input) || null,
    ];

    const raceIds = [meta.race, meta.race_no, meta.raceNo];

    const payload = {
      track: coalesce(...tracks),
      race: coalesce(...raceIds),
      surface: coalesce(...surfaces),
      distance: coalesce(...distances),
      confidence: typeof pred.confidence === 'number' ? pred.confidence : null,
      top3_mass: typeof pred.top3_mass === 'number' ? pred.top3_mass : null,
      picks: picks
        .map((entry) => {
          if (!entry) return null;
          if (typeof entry === 'string') return entry;
          return entry.name || entry.slot || null;
        })
        .filter(Boolean),
      strategy: pred.strategy?.recommended || null,
      meta: {
        source: 'preview',
      },
    };

    return payload;
  }

  // Defensive mount helper
  function ensureResultsRoot() {
    let root = document.getElementById('fl-results-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'fl-results-root';
      root.setAttribute('aria-live', 'polite');
      document.body.appendChild(root);
    }
    return root;
  }

  const root = ensureResultsRoot();

  // Check URL params on init (fail-open: ignore errors)
  if (PAYWALL_ENABLED && typeof window !== 'undefined') {
    try {
      paygate.checkUrlParams();
    } catch (err) {
      console.warn('[FLResults] PayGate URL check error (ignored, fail-open):', err?.message || err);
    }
  }

  let elements = null;
  let lastPred = null;

  const clsOpen = 'fl-results--open';
  const clsPinned = 'fl-results--pinned';

  function ensure() {
    if (elements) return;

    const wrap = document.createElement('div');
    wrap.className = 'fl-results';
    wrap.innerHTML = `
      <div class="fl-results__backdrop" data-close></div>
      <div class="fl-results__dialog" role="dialog" aria-modal="true" aria-label="Prediction Results">
        <header class="fl-results__header">
          <div class="fl-results__title">Predictions</div>
          <div class="fl-results__actions">
            <button class="fl-button" data-copy>Copy</button>
            <button class="fl-button fl-button--ghost" data-pin>Pin</button>
            <button id="fl-new-race" class="fl-button fl-button--ghost">New Race</button>
            <button class="fl-button fl-button--ghost" data-close aria-label="Close">✕</button>
          </div>
        </header>
        <div class="fl-results__tabs" style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);">
          <button class="fl-tab" data-tab="predictions" style="padding:8px 12px;background:transparent;border:none;border-bottom:2px solid #8b5cf6;color:#dfe3ff;cursor:pointer;font-weight:600;">Predictions</button>
          <button class="fl-tab" data-tab="exotics" style="padding:8px 12px;background:transparent;border:none;border-bottom:2px solid transparent;color:#b8bdd4;cursor:pointer;">Exotic Ideas</button>
          <button class="fl-tab" data-tab="strategy" style="padding:8px 12px;background:transparent;border:none;border-bottom:2px solid transparent;color:#b8bdd4;cursor:pointer;">Strategy</button>
        </div>
        <div id="fl-tab-predictions" class="fl-tab-content">
          <section class="fl-results__badges">
            <div id="fl-badge-win" class="fl-badge"></div>
            <div id="fl-badge-place" class="fl-badge"></div>
            <div id="fl-badge-show" class="fl-badge"></div>
          </section>
          <section class="fl-results__confidence">
            <div class="fl-results__confidence-label">
              <span>Confidence:</span>
              <strong id="fl-conf-pct">0%</strong>
            </div>
            <div class="fl-progress">
              <div id="fl-conf-bar" class="fl-progress__bar"></div>
            </div>
          </section>
          <section id="fl-reasons" class="fl-results__reasons" style="margin-top:12px;display:none;">
            <div style="font-size:13px;opacity:0.8;margin-bottom:6px;">Why these picks?</div>
            <div id="fl-reasons-chips" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
          </section>
        </div>
        <div id="fl-tab-exotics" class="fl-tab-content" style="display:none;">
          <div id="fl-exotics-content"></div>
        </div>
        <div id="fl-tab-strategy" class="fl-tab-content" style="display:none;">
          <div id="fl-strategy" data-fl-strategy style="margin-top:16px;"></div>
        </div>
        <div id="fl-log-result-section" data-admin-tools style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);display:none;">
          <details style="cursor:pointer;">
            <summary style="font-size:13px;color:#b8bdd4;user-select:none;">📝 Admin tools: Log Result</summary>
            <div style="margin-top:12px;padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;">
              <div style="display:flex;flex-direction:column;gap:8px;">
                <label style="font-size:12px;color:#b8bdd4;">
                  Race ID: <input type="text" id="fl-log-race-id" placeholder="track:date:raceNo" style="width:100%;padding:6px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;margin-top:4px;" />
                </label>
                <label style="font-size:12px;color:#b8bdd4;">
                  Result: 
                  <select id="fl-log-result" style="width:100%;padding:6px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;margin-top:4px;">
                    <option value="Miss">Miss</option>
                    <option value="Partial">Partial</option>
                    <option value="Hit">Hit</option>
                  </select>
                </label>
                <label style="font-size:12px;color:#b8bdd4;">
                  ROI %: <input type="number" id="fl-log-roi" placeholder="e.g., +42 or -100" style="width:100%;padding:6px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;margin-top:4px;" />
                </label>
                <label style="font-size:12px;color:#b8bdd4;">
                  Notes: <textarea id="fl-log-notes" placeholder="Optional notes" rows="2" style="width:100%;padding:6px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;margin-top:4px;resize:vertical;"></textarea>
                </label>
                <button id="fl-log-submit" style="padding:8px 16px;background:#8b5cf6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;margin-top:4px;">Submit Result</button>
                <div id="fl-log-status" style="font-size:11px;color:#b8bdd4;margin-top:4px;"></div>
              </div>
            </div>
          </details>
        </div>
      </div>
    `;

    root.appendChild(wrap);

    elements = {
      root: wrap,
      dialog: wrap.querySelector('.fl-results__dialog'),
      closeBtn: wrap.querySelector('[data-close]'),
      copyBtn: wrap.querySelector('[data-copy]'),
      pinBtn: wrap.querySelector('[data-pin]'),
      badgeWin: wrap.querySelector('#fl-badge-win'),
      badgePlace: wrap.querySelector('#fl-badge-place'),
      badgeShow: wrap.querySelector('#fl-badge-show'),
      confPct: wrap.querySelector('#fl-conf-pct'),
      confBar: wrap.querySelector('#fl-conf-bar'),
      reasonsSection: wrap.querySelector('#fl-reasons'),
      reasonsChips: wrap.querySelector('#fl-reasons-chips'),
      tabPredictions: wrap.querySelector('[data-tab="predictions"]'),
      tabExotics: wrap.querySelector('[data-tab="exotics"]'),
      tabStrategy: wrap.querySelector('[data-tab="strategy"]'),
      tabContentPredictions: wrap.querySelector('#fl-tab-predictions'),
      tabContentExotics: wrap.querySelector('#fl-tab-exotics'),
      tabContentStrategy: wrap.querySelector('#fl-tab-strategy'),
      exoticsContent: wrap.querySelector('#fl-exotics-content'),
      strategyWrap: wrap.querySelector('[data-fl-strategy]') || wrap.querySelector('#fl-strategy'),
      logRaceId: wrap.querySelector('#fl-log-race-id'),
      logResult: wrap.querySelector('#fl-log-result'),
      logRoi: wrap.querySelector('#fl-log-roi'),
      logNotes: wrap.querySelector('#fl-log-notes'),
      logSubmit: wrap.querySelector('#fl-log-submit'),
      logStatus: wrap.querySelector('#fl-log-status'),
    };

    // Show admin tools if flag is set
    if (window.FL_FLAGS?.showAdminTools) {
      const adminSection = wrap.querySelector('[data-admin-tools]');
      if (adminSection) {
        adminSection.style.display = 'block';
      }
    }

    // Event listeners
    wrap.addEventListener('click', (e) => {
      if (e.target.matches('[data-close]') || e.target.classList.contains('fl-results__backdrop')) {
        hide();
      } else if (e.target.matches('[data-copy]')) {
        copy();
      } else if (e.target.matches('[data-pin]')) {
        togglePin();
      } else if (e.target.matches('[data-tab]') || e.target.closest('[data-tab]')) {
        const tabBtn = e.target.matches('[data-tab]') ? e.target : e.target.closest('[data-tab]');
        const tab = tabBtn?.getAttribute('data-tab');
        if (tab) switchTab(tab);
      } else if (e.target.matches('#fl-log-submit')) {
        handleLogResult();
      }
    });

    // Keyboard accessibility
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrap.classList.contains(clsOpen)) {
        hide();
      } else if (e.key === 'Enter' && document.activeElement === elements.copyBtn) {
        copy();
      }
    });

    // Focus trap within dialog
    elements.dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;

      const focusable = wrap.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  function fillBadge(node, label, name, odds, rankClass) {
    if (!node) return;
    node.className = `fl-badge ${rankClass}`;
    node.innerHTML = `
      <div class="fl-badge__rank">${label}</div>
      <div class="fl-badge__name">${name || '—'}</div>
      <div class="fl-badge__meta">${odds ? 'Odds: ' + odds : ''}</div>
    `;
  }

  function getTimeAgo(date) {
    const now = Date.now();
    const then = date.getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 7)}w ago`;
  }

  function computeSignal(confPct, massPct) {
    const c = Number.isFinite(confPct) ? confPct : NaN;
    const m = Number.isFinite(massPct) ? massPct : NaN;
    if (!Number.isFinite(c) || !Number.isFinite(m)) {
      return { color: 'yellow', label: 'Caution', action: 'Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%' };
    }
    if (c >= 75 && m >= 45) {
      return { color: 'green', label: 'Good to bet', action: 'Full ATB or Trifecta Box play' };
    }
    if ((c >= 65 && c <= 74) || (m >= 35 && m <= 44) || (c >= 80 && m < 45)) {
      return { color: 'yellow', label: 'Caution', action: 'Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%' };
    }
    return { color: 'red', label: 'Skip', action: 'Skip (save bankroll) — chaotic field' };
  }

  function renderStoplightSignal(container, confPct, massPct) {
    const sig = computeSignal(confPct, massPct);
    const id = 'fl-signal';
    let box = container.querySelector('#' + id);
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      box.className = 'fl-signal';
      box.innerHTML = `
        <div class="fl-signal-row">
          <span class="fl-signal-dot" aria-label="betting signal"></span>
          <span class="fl-signal-text"></span>
        </div>
      `;
      // Insert at the top of the Strategy card (just under the title line)
      const header = container.querySelector('.fl-strategy-title') || container.querySelector('h3') || container.querySelector('h2') || container.firstElementChild;
      if (header && header.parentNode) {
        header.parentNode.insertBefore(box, header.nextSibling);
      } else {
        container.insertBefore(box, container.firstChild);
      }
    }
    const dot = box.querySelector('.fl-signal-dot');
    const txt = box.querySelector('.fl-signal-text');
    dot.classList.remove('green', 'yellow', 'red');
    dot.classList.add(sig.color);
    dot.title = `${sig.label} · Uses Strategy Confidence & Top-3 mass`;
    txt.textContent = `${sig.label} — ${sig.action}`;

    // Color the active strategy row border to match signal
    const activeRow = container.querySelector('.strategy-table .row.active, .strategy-table tr.is-recommended, .strategy-row.active');
    if (activeRow) {
      activeRow.classList.remove('sig-green', 'sig-yellow', 'sig-red');
      activeRow.classList.add('sig-' + sig.color);
    }
  }

  function switchTab(tab) {
    if (!elements) return;
    
    // Reset all tabs
    const tabs = [elements.tabPredictions, elements.tabExotics, elements.tabStrategy].filter(Boolean);
    const contents = [elements.tabContentPredictions, elements.tabContentExotics, elements.tabContentStrategy].filter(Boolean);
    
    tabs.forEach(t => {
      if (t) {
        t.style.borderBottomColor = 'transparent';
        t.style.color = '#b8bdd4';
      }
    });
    
    contents.forEach(c => {
      if (c) c.style.display = 'none';
    });
    
    // Activate selected tab
    if (tab === 'predictions' && elements.tabPredictions && elements.tabContentPredictions) {
      elements.tabPredictions.style.borderBottomColor = '#8b5cf6';
      elements.tabPredictions.style.color = '#dfe3ff';
      elements.tabContentPredictions.style.display = 'block';
    } else if (tab === 'exotics' && elements.tabExotics && elements.tabContentExotics) {
      elements.tabExotics.style.borderBottomColor = '#8b5cf6';
      elements.tabExotics.style.color = '#dfe3ff';
      elements.tabContentExotics.style.display = 'block';
    } else if (tab === 'strategy' && elements.tabStrategy && elements.tabContentStrategy) {
      elements.tabStrategy.style.borderBottomColor = '#8b5cf6';
      elements.tabStrategy.style.color = '#dfe3ff';
      elements.tabContentStrategy.style.display = 'block';
    }
  }

  function renderExotics(tickets, recommended = '') {
    if (!elements || !elements.exoticsContent) return;
    if (!tickets || (!tickets.trifecta && !tickets.superfecta && !tickets.superHighFive)) {
      elements.exoticsContent.innerHTML = '<p style="opacity:0.7;text-align:center;padding:20px;">No exotic ticket suggestions available.</p>';
      return;
    }

    const fmtPct = (v) => {
      const p = Math.max(0, Math.min(1, Number(v || 0)));
      return (p * 100).toFixed(0) + '%';
    };

    const isRec = (type) => recommended && type && recommended.toLowerCase().includes(type.toLowerCase());

    let html = '';

    // Trifecta
    if (tickets.trifecta && tickets.trifecta.length > 0) {
      const title = `Trifecta Ideas${isRec('Trifecta') ? ' • Recommended' : ''}`;
      html += `<div style="margin-bottom:20px;"><h4 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#dfe3ff;">${title}</h4>`;
      tickets.trifecta.forEach(ticket => {
        let ticketText = '';
        let confText = '';

        if (typeof ticket === 'string') {
          // Back-compat: older API returns plain strings
          ticketText = ticket;
        } else if (ticket && typeof ticket === 'object') {
          // New API: { text, confidence }
          ticketText = ticket.text || '';
          if (ticket.confidence != null) {
            confText = ' ~' + fmtPct(ticket.confidence);
          }
        }

        html += `<div class="fl-ticket-line" style="padding:10px;background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.3);border-radius:10px;margin-bottom:8px;">
          <span style="font-weight:600;color:#dfe3ff;">${ticketText}</span>
          ${confText ? `<span class="fl-ticket-conf" style="opacity:0.9;font-variant-numeric:tabular-nums;">${confText}</span>` : ''}
        </div>`;
      });
      html += '</div>';
    }

    // Superfecta
    if (tickets.superfecta && tickets.superfecta.length > 0) {
      html += '<div style="margin-bottom:20px;"><h4 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#dfe3ff;">Superfecta Ideas</h4>';
      tickets.superfecta.forEach(ticket => {
        let ticketText = '';
        let confText = '';

        if (typeof ticket === 'string') {
          ticketText = ticket;
        } else if (ticket && typeof ticket === 'object') {
          ticketText = ticket.text || '';
          if (ticket.confidence != null) {
            confText = ' ~' + fmtPct(ticket.confidence);
          }
        }

        html += `<div class="fl-ticket-line" style="padding:10px;background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.3);border-radius:10px;margin-bottom:8px;">
          <span style="font-weight:600;color:#dfe3ff;">${ticketText}</span>
          ${confText ? `<span class="fl-ticket-conf" style="opacity:0.9;font-variant-numeric:tabular-nums;">${confText}</span>` : ''}
        </div>`;
      });
      html += '</div>';
    }

    // Exacta (if we have exacta tickets in future)
    // For now, skip if not present
    
    // Super High Five
    if (tickets.superHighFive && tickets.superHighFive.length > 0) {
      html += '<div style="margin-bottom:20px;"><h4 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#dfe3ff;">Super High Five Ideas</h4>';
      tickets.superHighFive.forEach(ticket => {
        let ticketText = '';
        let confText = '';

        if (typeof ticket === 'string') {
          ticketText = ticket;
        } else if (ticket && typeof ticket === 'object') {
          ticketText = ticket.text || '';
          if (ticket.confidence != null) {
            confText = ' ~' + fmtPct(ticket.confidence);
          }
        }

        html += `<div class="fl-ticket-line" style="padding:10px;background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.3);border-radius:10px;margin-bottom:8px;">
          <span style="font-weight:600;color:#dfe3ff;">${ticketText}</span>
          ${confText ? `<span class="fl-ticket-conf" style="opacity:0.9;font-variant-numeric:tabular-nums;">${confText}</span>` : ''}
        </div>`;
      });
      html += '</div>';
    }

    elements.exoticsContent.innerHTML = html;
  }

  function renderStrategy(strategy, fallbackData = {}) {
    if (!elements || !elements.strategyWrap) return;

    // Fallback: synthesize minimal strategy if missing
    let s = strategy;
    if (!s) {
      const betTypesTable = [
        { type: 'Trifecta Box (AI Top 3)', icon: '🔥', bestFor: 'Max profit', desc: 'Leverages AI\'s strength at identifying the 3 right horses even if order flips.' },
        { type: 'Across the Board',        icon: '🛡️', bestFor: 'Consistency', desc: 'Always collects if top pick finishes top 3. Ideal for low variance bankroll play.' },
        { type: 'Win Only',                icon: '🎯', bestFor: 'Confidence plays', desc: 'When AI confidence > 68%, Win-only yields clean edge.' },
        { type: 'Exacta Box (Top 3)',      icon: '⚖️', bestFor: 'Middle ground', desc: 'Works when AI has correct pair but misses trifecta.' },
      ];
      const conf = Number(fallbackData.confidence || 0);
      // Naive heuristic: if conf high choose Win, else default to ATB
      const recommended = conf >= 0.7 ? 'Win Only' : 'Across the Board';
      s = {
        recommended,
        rationale: [`Confidence ${Math.round(conf * 100)}%`],
        betTypesTable,
        metrics: { confidence: conf, top3Mass: null, gap12: null, gap23: null, top: [] }
      };
      console.info('[FLResults] Using client-side fallback strategy');
    }

    // --- bankroll state (default 200, range 50-500) ---
    const BK_DEFAULT = 200;
    let bankroll = BK_DEFAULT;

    function planLinesFor(recommended, picks, bk, gatesInfo) {
      let rec = recommended;
      if (!gatesInfo.allow_win_only && rec === 'Win Only') rec = 'Across the Board';
      if (rec.includes('Exacta') && !gatesInfo.allow_exacta) {
        rec = gatesInfo.allow_win_only ? 'Win Only' : 'Across the Board';
      }
      if (rec.includes('Trifecta') && !gatesInfo.allow_trifecta) {
        rec = gatesInfo.allow_exacta ? 'Exacta Box (Top 3)' : (gatesInfo.allow_win_only ? 'Win Only' : 'Across the Board');
      }

      const top3 = (picks || []).slice(0, 3).map(p => p?.name).filter(Boolean);
      const top = top3[0] || 'Top Pick';
      const pct = {
        'Across the Board': { win: 0.25, place: 0.25, show: 0.25, exacta: 0.25, tri: 0 },
        'Win Only': { win: 1.00, place: 0, show: 0, exacta: 0, tri: 0 },
        'Exacta Box (Top 3)': { win: 0.60, place: 0, show: 0, exacta: 0.40, tri: 0 },
        'Trifecta Box (AI Top 3)': { win: 0.40, place: 0, show: 0, exacta: 0, tri: 0.60 },
      }[rec] || { win: 0.50, place: 0, show: 0, exacta: 0.50, tri: 0 };

      const asDollars = (x) => Math.max(2, Math.round(x / 2) * 2);
      const adjustedBankroll = bk * (Number.isFinite(gatesInfo.stake_reco) && gatesInfo.stake_reco > 0 ? gatesInfo.stake_reco : 1);
      const win = asDollars(adjustedBankroll * (pct.win || 0));
      const plc = asDollars(adjustedBankroll * (pct.place || 0));
      const shw = asDollars(adjustedBankroll * (pct.show || 0));
      const exBox = asDollars(adjustedBankroll * (pct.exacta || 0));
      const triBx = asDollars(adjustedBankroll * (pct.tri || 0));

      const lines = [];
      if (win > 1) lines.push(`WIN ${top} — $${win}`);
      if (plc > 1) lines.push(`PLACE ${top} — $${plc}`);
      if (shw > 1) lines.push(`SHOW ${top} — $${shw}`);
      if (gatesInfo.allow_exacta && exBox > 1 && top3.length === 3) lines.push(`EXACTA BOX ${top3.join(', ')} — $${exBox} total`);
      if (gatesInfo.allow_trifecta && triBx > 1 && top3.length === 3) lines.push(`TRIFECTA BOX ${top3.join(', ')} — $${triBx} total`);
      return { lines, recommended: rec };
    }

    function copyBetSlip(lines) {
      const txt = `FinishLine AI Bet Slip\nTrack: ${window.__fl_state?.track || ''}\nDistance: ${window.__fl_state?.distance_input || ''}\nSurface: ${window.__fl_state?.surface || ''}\n---\n` + lines.join('\n');
      navigator.clipboard?.writeText(txt).then(() => {
        const btn = elements.strategyWrap?.querySelector('#fl-copy-slip');
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 2000);
        }
      }).catch(() => {});
    }

    const wrap = elements.strategyWrap;
    wrap.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'fl-strategy-card';

    const metrics = s.metrics || {};
    const fallbackConf = Number(fallbackData.confidence || metrics.confidence || 0);
    const fallbackTop3 = Number(metrics.top3Mass ?? fallbackData.top3Mass ?? 0);
    const fallbackGap12 = Number(metrics.gap12 ?? metrics.gap1to2 ?? fallbackData.gap12 ?? fallbackData.gap1to2 ?? 0);
    const fallbackGap23 = Number(metrics.gap23 ?? metrics.gap2to3 ?? fallbackData.gap23 ?? fallbackData.gap2to3 ?? 0);

    function toPercent(value) {
      if (!Number.isFinite(value)) return NaN;
      return value <= 1 ? value * 100 : value;
    }

    function parseDistanceToYards(str) {
      if (!str) return NaN;
      if (typeof str === 'number' && Number.isFinite(str)) return str;
      const text = String(str).trim();
      const yardsMatch = /([0-9]+)\s*[Yy]/.exec(text);
      if (yardsMatch) return Number(yardsMatch[1]);
      const furlongMatch = /([0-9]+(?:\.[0-9]+)?)\s*[Ff]/.exec(text);
      if (furlongMatch) {
        const furlongs = Number(furlongMatch[1]);
        if (Number.isFinite(furlongs)) {
          return Math.round(furlongs * 220);
        }
      }
      const mileMatch = /([0-9]+(?:\.[0-9]+)?)\s*(?:M|mile|miles)/i.exec(text);
      if (mileMatch) {
        const miles = Number(mileMatch[1]);
        if (Number.isFinite(miles)) {
          return Math.round(miles * 1760);
        }
      }
      return NaN;
    }

    const confPct = toPercent(fallbackConf);
    const top3Pct = toPercent(fallbackTop3);
    const gap12Pct = toPercent(fallbackGap12);
    const gap23Pct = toPercent(fallbackGap23);

    const distanceContext = parseDistanceToYards(
      fallbackData.distance || metrics.distance || window.__fl_state?.distance_yards || window.__fl_state?.distance_input || ''
    );
    const surfaceContext = fallbackData.surface || metrics.surface || window.__fl_state?.surface || '';
    const classContext = fallbackData.class || metrics.class || window.__fl_state?.class || '';

    let gates = {
      stake_reco: 1,
      allow_win_only: confPct >= 80,
      allow_exacta: true,
      allow_trifecta: true,
      rationale: [],
    };

    if (window.FinishLineCalibration?.shouldOfferExotics) {
      try {
        gates = window.FinishLineCalibration.shouldOfferExotics({
          confidence: confPct,
          top3Mass: top3Pct,
          gap12: gap12Pct,
          gap23: gap23Pct,
          distance: distanceContext,
          surface: surfaceContext,
          class: classContext,
        });
      } catch (err) {
        console.debug('[FLResults] Calibration gating failed, falling back:', err?.message || err);
      }
    }

    const stakeMultiplier = window.FinishLineCalibration?.getStakeForConfidence
      ? window.FinishLineCalibration.getStakeForConfidence(confPct)
      : gates.stake_reco || 1;

    const gatesForPlan = {
      ...gates,
      stake_reco: Number.isFinite(stakeMultiplier) && stakeMultiplier > 0 ? stakeMultiplier : (gates.stake_reco || 1),
    };

    if (!Array.isArray(s.rationale)) s.rationale = [];
    if (Array.isArray(gates.rationale)) {
      gates.rationale.forEach(note => {
        if (note && !s.rationale.includes(note)) {
          s.rationale.push(note);
        }
      });
    }

    let effectiveRecommendation = s.recommended;
    if (effectiveRecommendation === 'Win Only' && !gates.allow_win_only) {
      effectiveRecommendation = 'Across the Board';
      s.rationale.push('Win-only disabled by calibration gate');
    }
    if (effectiveRecommendation && effectiveRecommendation.includes('Exacta') && !gates.allow_exacta) {
      effectiveRecommendation = gates.allow_win_only ? 'Win Only' : 'Across the Board';
      s.rationale.push('Exacta gated off; reverting to safer plan');
    }
    if (effectiveRecommendation && effectiveRecommendation.includes('Trifecta') && !gates.allow_trifecta) {
      effectiveRecommendation = gates.allow_exacta ? 'Exacta Box (Top 3)' : (gates.allow_win_only ? 'Win Only' : 'Across the Board');
      s.rationale.push('Trifecta gated off by calibration');
    }

    const h = document.createElement('div');
    h.className = 'fl-strategy-title';
    h.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    
    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'FinishLine AI Betting Strategy';
    h.appendChild(titleSpan);
    
    // Optional calibration status (behind env flag - check window variable set by server)
    if (window.FINISHLINE_SHOW_CAL_STATUS) {
      const statusSpan = document.createElement('span');
      statusSpan.className = 'fl-cal-status';
      statusSpan.style.cssText = 'font-size:11px;opacity:0.6;color:#b8bdd4;margin-left:12px;font-weight:normal;';
      statusSpan.textContent = 'Loading...';
      h.appendChild(statusSpan);
      
      // Fetch status once on mount (fail silently)
      fetch('/api/calibration_status')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || !data.ok) return;
          
          const parts = [];
          if (data.csv_rows != null) parts.push(`rows:${data.csv_rows}`);
          if (data.tau != null) parts.push(`τ:${data.tau}`);
          if (data.params_mtime) {
            const ago = getTimeAgo(new Date(data.params_mtime));
            parts.push(`updated:${ago}`);
          } else {
            parts.push('updated:—');
          }
          
          statusSpan.textContent = `Calibrated ✓ ${parts.join(' ')}`;
        })
        .catch(() => {
          // Fail silently - remove status on error
          try { statusSpan.remove(); } catch {}
        });
    }
    
    card.appendChild(h);

    // Render stop-light signal (extract metrics after card is created)
    const strategyConfidencePct = s.metrics?.confidence != null ? Math.round((Number(s.metrics.confidence) || 0) * 100) : NaN;
    const top3MassPct = s.metrics?.top3Mass != null ? Math.round((Number(s.metrics.top3Mass) || 0) * 100) : NaN;
    renderStoplightSignal(card, strategyConfidencePct, top3MassPct);

    const reco = document.createElement('div');
    reco.className = 'fl-strategy-reco';
    reco.innerHTML = `<div class="fl-reco-label">Recommended Play</div><div class="fl-reco-value">${effectiveRecommendation}</div>`;
    card.appendChild(reco);

    // rationale chips
    if (Array.isArray(s.rationale) && s.rationale.length) {
      const chips = document.createElement('div');
      chips.className = 'fl-strategy-chips';
      s.rationale.forEach(r => {
        const c = document.createElement('span');
        c.className = 'fl-chip';
        c.textContent = r;
        chips.appendChild(c);
      });
      card.appendChild(chips);
    }

    // small metrics row
    if (s.metrics) {
      const m = document.createElement('div');
      m.className = 'fl-strategy-metrics';
      const pct = (v) => `${Math.round((Number(v)||0)*100)}%`;
      m.innerHTML = `
        <div>Confidence: <strong>${pct(s.metrics.confidence)}</strong></div>
        <div>Top-3 mass: <strong>${pct(s.metrics.top3Mass)}</strong></div>
        <div>Gap #1→#2: <strong>${(s.metrics.gap12*100).toFixed(1)}%</strong></div>
        <div>Gap #2→#3: <strong>${(s.metrics.gap23*100).toFixed(1)}%</strong></div>
      `;
      card.appendChild(m);
    }

    // Bet Types by Profit Potential (static table w/ emojis)
    if (Array.isArray(s.betTypesTable)) {
      const tbl = document.createElement('table');
      tbl.className = 'fl-strategy-table';
      tbl.innerHTML = `
        <thead>
          <tr><th>Strategy</th><th>Best For</th><th>Description</th></tr>
        </thead>
        <tbody></tbody>
      `;
        const tb = tbl.querySelector('tbody');
        s.betTypesTable.forEach(row => {
          const tr = document.createElement('tr');
          const t = document.createElement('td');
          t.textContent = `${row.icon || ''} ${row.type}`;
          const b = document.createElement('td');
          b.textContent = row.bestFor || '';
          const d = document.createElement('td');
          d.textContent = row.desc || '';
          tr.appendChild(t); tr.appendChild(b); tr.appendChild(d);
          // Highlight recommended row
          if ((row.type || '').toLowerCase() === (s.recommended || '').toLowerCase()) {
            tr.classList.add('is-recommended');
            // Apply signal color to active row border
            const sig = computeSignal(strategyConfidencePct, top3MassPct);
            tr.classList.add('sig-' + sig.color);
          }
          tb.appendChild(tr);
        });
        card.appendChild(tbl);
      }

      // Suggested Plan with bankroll slider (race-specific, dynamic)
      const plan = document.createElement('div');
      plan.className = 'fl-strategy-plan';
      
      const { lines: planLines, recommended: resolvedReco } = planLinesFor(
        effectiveRecommendation || 'Across the Board',
        s.picks || fallbackData.picks || [],
        bankroll,
        gatesForPlan
      );

      plan.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h4 style="margin:0;font-size:14px;font-weight:600;color:#dfe3ff;">Suggested Plan</h4>
          <div style="display:flex;gap:8px;align-items:center;">
            <div style="font-size:13px;opacity:0.75;color:#b8bdd4;">Bankroll</div>
            <input id="fl-bk" type="range" min="50" max="500" step="10" value="${BK_DEFAULT}" style="width:120px;accent-color:#8b5cf6;" />
            <div id="fl-bk-val" style="font-weight:600;color:#dfe3ff;min-width:50px;text-align:right;">$${BK_DEFAULT}</div>
            <button id="fl-copy-slip" class="fl-button" style="padding:6px 12px;font-size:13px;">Copy Bet Slip</button>
          </div>
        </div>
        <ul id="fl-plan-lines" class="fl-list" style="margin:8px 0 6px 0;padding-left:20px;"></ul>
        <div class="fl-note">Increase stakes with higher confidence; lean into exotics when Top-3 mass is high.</div>
      `;
      card.appendChild(plan);

      wrap.appendChild(card);

      // Wire bankroll slider + live plan render
      const linesEl = wrap.querySelector('#fl-plan-lines');
      const bkEl = wrap.querySelector('#fl-bk');
      const bkVal = wrap.querySelector('#fl-bk-val');
      
      // Get picks from the prediction data (need to extract from parent context)
      // Try to get picks from lastPred or construct from strategy metrics
      const picks = fallbackData.picks || (s.metrics?.top || []).slice(0, 3).map(t => ({ name: t.name || '' })).filter(p => p.name);
      const rec = s.recommended || 'Across the Board';

      function renderPlan() {
        if (!linesEl) return;
        const lines = planLinesFor(rec, picks, bankroll, { ...gates, stake_reco: stakeMultiplier });
        linesEl.innerHTML = lines.lines.map(l => `<li style="margin:4px 0;color:#b8bdd4;font-size:13px;">${l}</li>`).join('');
      }

      renderPlan();

      bkEl?.addEventListener('input', (e) => {
        bankroll = Number(e?.target?.value || BK_DEFAULT);
        if (bkVal) bkVal.textContent = `$${bankroll}`;
        renderPlan();
      });

      wrap.querySelector('#fl-copy-slip')?.addEventListener('click', () => {
        if (!linesEl) return;
        const lines = Array.from(linesEl.querySelectorAll('li')).map(li => li.textContent);
        copyBetSlip(lines);
      });
    }

  // Show PayGate UI when locked
  function showPaygateUI() {
    if (!elements || !elements.tabContentPredictions) return;
    
    // Check if paygate UI already exists
    let paygateEl = elements.tabContentPredictions.querySelector('#fl-paygate-ui');
    if (paygateEl) {
      paygateEl.style.display = 'block';
      return;
    }
    
    // Create paygate UI
    paygateEl = document.createElement('div');
    paygateEl.id = 'fl-paygate-ui';
    paygateEl.style.cssText = `
      margin-top: 20px;
      padding: 24px;
      background: rgba(139, 92, 246, 0.1);
      border: 2px solid rgba(139, 92, 246, 0.3);
      border-radius: 12px;
      text-align: center;
    `;
    
    const dayPassUrl = paygate.DAY_PASS_URL || '#';
    const coreUrl = paygate.CORE_MONTHLY_URL || '#';
    
    paygateEl.innerHTML = `
      <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #dfe3ff;">
        Unlock FinishLine Premium
      </h3>
      <p style="margin: 0 0 20px 0; font-size: 14px; color: #b8bdd4; line-height: 1.5;">
        Get full access to confidence scores, T3M metrics, strategy insights, and exotic betting ideas.
      </p>
      <ul style="margin: 0 0 20px 0; padding-left: 24px; text-align: left; color: #b8bdd4; font-size: 13px; max-width: 400px; margin-left: auto; margin-right: auto;">
        <li style="margin-bottom: 8px;">Full confidence % and T3M % metrics — stay in race vs skip race</li>
        <li style="margin-bottom: 8px;">Complete strategy breakdown with betting recommendations</li>
        <li style="margin-bottom: 8px;">Exotic ticket ideas (Trifecta, Superfecta, Super High Five)</li>
        <li style="margin-bottom: 8px;">Detailed reasoning for picks</li>
      </ul>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        <a href="${dayPassUrl}" 
           target="_blank" 
           rel="noopener noreferrer"
           style="padding: 12px 24px; background: #8b5cf6; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; transition: background 0.2s;"
           onmouseover="this.style.background='#7c3aed'" 
           onmouseout="this.style.background='#8b5cf6'">
          Unlock Day Pass $7.99
        </a>
        <a href="${coreUrl}" 
           target="_blank" 
           rel="noopener noreferrer"
           style="padding: 12px 24px; background: #6b46c1; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; transition: background 0.2s;"
           onmouseover="this.style.background='#5b21b6'" 
           onmouseout="this.style.background='#6b46c1'">
          Unlock Core $24.99/mo
        </a>
        <button id="fl-paygate-already-paid" 
                style="padding: 12px 24px; background: transparent; border: 1px solid rgba(139, 92, 246, 0.5); color: #dfe3ff; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; transition: background 0.2s;"
                onmouseover="this.style.background='rgba(139, 92, 246, 0.1)'" 
                onmouseout="this.style.background='transparent'">
          I already paid
        </button>
      </div>
    `;
    
    // Insert after badges, before confidence section (or at end if structure differs)
    const badgesSection = elements.tabContentPredictions.querySelector('.fl-results__badges');
    if (badgesSection) {
      // Insert after badges
      if (badgesSection.nextSibling) {
        elements.tabContentPredictions.insertBefore(paygateEl, badgesSection.nextSibling);
      } else {
        elements.tabContentPredictions.appendChild(paygateEl);
      }
    } else {
      elements.tabContentPredictions.appendChild(paygateEl);
    }
    
    // Wire "I already paid" button
    const alreadyPaidBtn = paygateEl.querySelector('#fl-paygate-already-paid');
    if (alreadyPaidBtn) {
      alreadyPaidBtn.addEventListener('click', () => {
        try {
          // Re-check URL params and localStorage
          const result = paygate.checkUrlParams();
          if (result.unlocked || paygate.isUnlocked()) {
            // Re-render to show premium content
            if (lastPred) {
              render(lastPred);
            }
          } else {
            alert('No active subscription found. If you just paid, please wait a moment and try again, or contact support.');
          }
        } catch (err) {
          console.warn('[FLResults] "I already paid" error:', err);
          alert('Error checking subscription status. Please try refreshing the page.');
        }
      });
    }
  }

  function render(pred) {
    // Guard: ensure modal root exists before rendering
    if (!root || !document.body.contains(root)) {
      console.warn('[FLResults] Modal root not available; skipping render.');
      return;
    }

    ensure();

    const { win, place, show, confidence, horses = [], reasons = {}, tickets } = pred || {};

    // Check unlock state (fail-open: default to unlocked on any error)
    const isUnlocked = !PAYWALL_ENABLED || (() => {
      try {
        return paygate.isUnlocked();
      } catch (err) {
        console.warn('[FLResults] PayGate check error, defaulting to unlocked (fail-open):', err?.message || err);
        return true;
      }
    })();

    const getOdds = (name) => {
      if (!name) return '';
      const h = horses.find((x) => {
        const horseName = (x.name || x.horse || '').toLowerCase();
        const targetName = (name || '').toLowerCase();
        return horseName === targetName;
      });
      return h?.odds || '';
    };

    // Fill badges (always visible - free preview)
    fillBadge(elements.badgeWin, '🥇 Win', win, getOdds(win), 'fl-badge--gold');
    fillBadge(elements.badgePlace, '🥈 Place', place, getOdds(place), 'fl-badge--silver');
    fillBadge(elements.badgeShow, '🥉 Show', show, getOdds(show), 'fl-badge--bronze');

    // Show teaser text if locked
    if (!isUnlocked) {
      const winName = win || 'Top pick';
      let teaser = elements.tabContentPredictions.querySelector('#fl-teaser');
      if (!teaser) {
        teaser = document.createElement('div');
        teaser.id = 'fl-teaser';
        teaser.style.cssText = 'font-size: 13px; color: #b8bdd4; margin-top: 12px; text-align: center; font-style: italic;';
        const badgesSection = elements.tabContentPredictions.querySelector('.fl-results__badges');
        if (badgesSection && badgesSection.nextSibling) {
          elements.tabContentPredictions.insertBefore(teaser, badgesSection.nextSibling);
        } else {
          elements.tabContentPredictions.appendChild(teaser);
        }
      }
      teaser.textContent = `${winName} shown — unlock full card for confidence scores and strategy`;
      teaser.style.display = 'block';
    } else {
      const teaser = elements.tabContentPredictions?.querySelector('#fl-teaser');
      if (teaser) teaser.style.display = 'none';
    }

    // Premium sections: Confidence % and Reasons (gated)
    if (isUnlocked) {
      // Confidence - use calibrated value from strategy if available, otherwise fallback
      let conf = Math.max(0, Math.min(100, Number(confidence) || 0));
      
      // Prefer strategy confidence if available (calibrated value)
      if (pred.strategy?.metrics?.confidence != null) {
        const stratConf = Number(pred.strategy.metrics.confidence);
        if (!Number.isNaN(stratConf)) {
          conf = Math.max(0, Math.min(100, Math.round(stratConf * 100)));
        }
      }
      
      // Dynamic color based on confidence level
      let confColor = '#00e6a8'; // green default (≥ 68%)
      if (conf < 60) {
        confColor = '#ff4d4d'; // red (< 60)
      } else if (conf < 68) {
        confColor = '#ffcc00'; // yellow (60-67)
      }
      
      // Update confidence display
      elements.confPct.textContent = `${conf.toFixed(0)}%`;
      elements.confBar.style.width = `${conf}%`;
      elements.confBar.style.background = confColor;
      elements.confBar.style.transition = 'width 0.8s ease, background 0.5s ease';
      
      // Show confidence section
      const confSection = elements.confPct?.parentElement?.parentElement;
      if (confSection) confSection.style.display = 'block';

      // Reasons chips (show for winner) - now with +/- deltas
      const winnerReasons = reasons[win] || [];
      
      if (winnerReasons.length > 0 && elements.reasonsSection && elements.reasonsChips) {
        elements.reasonsChips.innerHTML = winnerReasons
          .map(reason => {
            // Format: "factor +0.25" or "factor -0.15"
            const isPositive = reason.includes('+') || (!reason.includes('-') && !reason.includes('0.00'));
            const chipColor = isPositive ? 'rgba(92,134,255,0.15)' : 'rgba(255,153,102,0.15)';
            const chipBorder = isPositive ? 'rgba(92,134,255,0.3)' : 'rgba(255,153,102,0.3)';
            return `<span class="fl-reason-chip" style="display:inline-block;padding:4px 10px;background:${chipColor};border:1px solid ${chipBorder};border-radius:12px;font-size:12px;color:#b8bdd4;">${reason}</span>`;
          })
          .join('');
        elements.reasonsSection.style.display = 'block';
      } else if (elements.reasonsSection) {
        elements.reasonsSection.style.display = 'none';
      }
    } else {
      // Hide confidence section
      const confSection = elements.confPct?.parentElement?.parentElement;
      if (confSection) confSection.style.display = 'none';
      
      // Hide reasons section
      if (elements.reasonsSection) {
        elements.reasonsSection.style.display = 'none';
      }
      
      // Show paygate UI
      showPaygateUI();
    }

    // Update pin button text
    const isPinned = localStorage.getItem('fl_results_pinned') === '1';
    elements.pinBtn.textContent = isPinned ? 'Unpin' : 'Pin';

    // Premium tabs: Exotics and Strategy (gated)
    if (isUnlocked) {
      // Show tabs
      if (elements.tabExotics) elements.tabExotics.style.display = 'inline-block';
      if (elements.tabStrategy) elements.tabStrategy.style.display = 'inline-block';
      
      // Render exotics if available
      if (tickets) {
        renderExotics(tickets);
      }

      // Render strategy if available (with fallback)
      renderStrategy(pred.strategy || null, { confidence: pred.confidence });
    } else {
      // Hide tabs
      if (elements.tabExotics) elements.tabExotics.style.display = 'none';
      if (elements.tabStrategy) elements.tabStrategy.style.display = 'none';
      
      // Hide tab contents
      if (elements.tabContentExotics) elements.tabContentExotics.style.display = 'none';
      if (elements.tabContentStrategy) elements.tabContentStrategy.style.display = 'none';
    }
    
    // Diagnostics: log strategy payload
    try {
      console.debug('[FLResults] Strategy payload:', pred.strategy ? 'present' : 'missing (using fallback)');
      if (pred.strategy) {
        console.debug('[FLResults] Strategy details:', {
          recommended: pred.strategy.recommended,
          rationale: pred.strategy.rationale?.length || 0,
          metrics: pred.strategy.metrics ? 'present' : 'missing'
        });
      }
    } catch (e) {
      // Ignore logging errors
    }

    // Show tester badge if bypass was used
    if (isUnlocked && PAYWALL_ENABLED) {
      try {
        const bypassUsed = paygate.getBypassUsed && paygate.getBypassUsed();
        if (bypassUsed) {
          let badge = elements.dialog.querySelector('#fl-tester-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.id = 'fl-tester-badge';
            badge.style.cssText = 'font-size: 10px; padding: 2px 6px; background: rgba(255, 193, 7, 0.2); color: #ffc107; border-radius: 4px; margin-left: 8px; font-weight: 600;';
            const title = elements.dialog.querySelector('.fl-results__title');
            if (title) title.appendChild(badge);
          }
          badge.textContent = 'Tester Access';
          badge.style.display = 'inline-block';
        } else {
          const badge = elements.dialog.querySelector('#fl-tester-badge');
          if (badge) badge.style.display = 'none';
        }
      } catch (err) {
        // Ignore badge errors (fail-open)
        console.warn('[FLResults] Tester badge error (ignored):', err?.message || err);
      }
    } else {
      const badge = elements.dialog.querySelector('#fl-tester-badge');
      if (badge) badge.style.display = 'none';
    }

    // Open and apply pinned state
    elements.root.classList.add(clsOpen);
    if (isPinned) {
      elements.root.classList.add(clsPinned);
    } else {
      elements.root.classList.remove(clsPinned);
    }

    elements.dialog.setAttribute('aria-hidden', 'false');
    elements.closeBtn.focus({ preventScroll: true });

    // Reset to predictions tab
    switchTab('predictions');

    try {
      const payload = buildPersistencePayload(pred);
      if (payload) {
        persistenceHelper.persist(payload);
      }
    } catch (err) {
      console.debug('[FLResults] persistence skipped', err?.message || err);
    }
  }

  function hide() {
    if (!elements) return;
    elements.root.classList.remove(clsOpen, clsPinned);
    elements.dialog.setAttribute('aria-hidden', 'true');
  }

  function copy() {
    if (!elements) return;

    const lines = [];
    const winName = elements.badgeWin.querySelector('.fl-badge__name')?.textContent || '—';
    const placeName = elements.badgePlace.querySelector('.fl-badge__name')?.textContent || '—';
    const showName = elements.badgeShow.querySelector('.fl-badge__name')?.textContent || '—';
    const conf = elements.confPct.textContent;

    lines.push(`Win: ${winName}`);
    lines.push(`Place: ${placeName}`);
    lines.push(`Show: ${showName}`);
    lines.push(`Confidence: ${conf}`);

    // Add exotic tickets if available
    if (lastPred && lastPred.tickets) {
      lines.push('');
      lines.push('Exotic Ticket Ideas:');
      
      if (lastPred.tickets.trifecta && lastPred.tickets.trifecta.length > 0) {
        lines.push('Trifecta:');
        lastPred.tickets.trifecta.forEach(t => {
          const confPct = Math.round((t.confidence || 0) * 100);
          lines.push(`  ${t.label} (~${confPct}%)`);
        });
      }
      
      if (lastPred.tickets.superfecta && lastPred.tickets.superfecta.length > 0) {
        lines.push('Superfecta:');
        lastPred.tickets.superfecta.forEach(t => {
          const confPct = Math.round((t.confidence || 0) * 100);
          lines.push(`  ${t.label} (~${confPct}%)`);
        });
      }
      
      if (lastPred.tickets.superHighFive && lastPred.tickets.superHighFive.length > 0) {
        lines.push('Super High Five:');
        lastPred.tickets.superHighFive.forEach(t => {
          const confPct = Math.round((t.confidence || 0) * 100);
          lines.push(`  ${t.label} (~${confPct}%)`);
        });
      }
    }

    // Add strategy summary
    if (lastPred && lastPred.strategy) {
      lines.push('');
      lines.push('Strategy:');
      lines.push(`  Recommended: ${lastPred.strategy.recommended || 'Across the Board'}`);
      if (lastPred.strategy.rationale && lastPred.strategy.rationale.length > 0) {
        lines.push(`  Why: ${lastPred.strategy.rationale.join('; ')}`);
      }
    }

    const text = lines.join('\n');
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const originalText = elements.copyBtn.textContent;
        elements.copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          elements.copyBtn.textContent = originalText;
        }, 2000);
      })
      .catch((err) => {
        console.error('[FLResults] Copy failed:', err);
        // Fallback: show in alert
        alert(text);
      });
  }

  function togglePin() {
    const isPinned = localStorage.getItem('fl_results_pinned') === '1';
    localStorage.setItem('fl_results_pinned', isPinned ? '0' : '1');

    if (elements.root.classList.contains(clsOpen)) {
      if (isPinned) {
        elements.root.classList.remove(clsPinned);
        elements.pinBtn.textContent = 'Pin';
      } else {
        elements.root.classList.add(clsPinned);
        elements.pinBtn.textContent = 'Unpin';
      }
    }

    // Re-render to apply new state
    if (lastPred) {
      render(lastPred);
    }
  }

  async function handleLogResult() {
    if (!elements || !elements.logSubmit) return;
    
    const race_id = (elements.logRaceId?.value || '').trim();
    const result = elements.logResult?.value || 'Miss';
    const roi_percent = (elements.logRoi?.value || '').trim();
    const notes = (elements.logNotes?.value || '').trim();
    
    if (!race_id) {
      if (elements.logStatus) {
        elements.logStatus.textContent = 'Error: Race ID required';
        elements.logStatus.style.color = '#ff6b6b';
        setTimeout(() => {
          if (elements.logStatus) elements.logStatus.textContent = '';
        }, 3000);
      }
      return;
    }
    
    elements.logSubmit.disabled = true;
    if (elements.logStatus) {
      elements.logStatus.textContent = 'Submitting...';
      elements.logStatus.style.color = '#b8bdd4';
    }
    
    try {
      const resp = await fetch('/api/record_result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ race_id, result, roi_percent, notes })
      });
      
      const data = await resp.json();
      
      if (data.ok) {
        if (elements.logStatus) {
          elements.logStatus.textContent = '✓ Result logged successfully';
          elements.logStatus.style.color = '#51cf66';
        }
        // Clear form
        if (elements.logRaceId) elements.logRaceId.value = '';
        if (elements.logResult) elements.logResult.value = 'Miss';
        if (elements.logRoi) elements.logRoi.value = '';
        if (elements.logNotes) elements.logNotes.value = '';
      } else {
        const errorText = data.error || data.detail || 'Failed to log result';
        throw new Error(errorText);
      }
    } catch (e) {
      if (elements.logStatus) {
        elements.logStatus.textContent = `Error: ${e.message || 'Failed to log result'}`;
        elements.logStatus.style.color = '#ff6b6b';
      }
    } finally {
      elements.logSubmit.disabled = false;
      setTimeout(() => {
        if (elements.logStatus) elements.logStatus.textContent = '';
      }, 5000);
    }
  }

  // Public API (null-safe)
  window.FLResults = {
    show(pred) {
      try {
        if (!pred || typeof pred !== 'object') {
          console.warn('[FLResults] Invalid prediction data');
          return;
        }
        lastPred = pred;
        render(pred);
      } catch (err) {
        console.error('[FLResults] show() error:', err);
      }
    },
    hide() {
      try {
        hide();
      } catch (err) {
        console.error('[FLResults] hide() error:', err);
      }
    },
  };
})();

