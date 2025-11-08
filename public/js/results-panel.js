// public/js/results-panel.js - Persistent results panel for predictions

(function () {
  'use strict';

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
      title: wrap.querySelector('.fl-results__title'),
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

  function computeSignal(metrics) {
    if (window.FLStrategyLogic?.evaluateStrategySignal) {
      return window.FLStrategyLogic.evaluateStrategySignal(metrics);
    }
    const c = Number(metrics?.confidence ?? NaN);
    const mRaw = Number(metrics?.top3Mass ?? metrics?.top3_mass ?? NaN);
    const m = Number.isFinite(mRaw) && mRaw <= 1 ? mRaw * 100 : mRaw;
    if (!Number.isFinite(c) || !Number.isFinite(m)) {
      return {
        color: 'yellow',
        label: 'Caution',
        action: '⚠️ Caution — Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%',
        message: '⚠️ Caution — Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%',
      };
    }
    if (c >= 82 && m >= 40) {
      return {
        color: 'green',
        label: 'Go',
        action: '✅ Go — Win-Only or ATB (bankroll-scaled)',
        message: '✅ Go — Win-Only or ATB (bankroll-scaled)',
      };
    }
    if (c >= 68 || m >= 33) {
      return {
        color: 'yellow',
        label: 'Caution',
        action: '⚠️ Caution — Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%',
        message: '⚠️ Caution — Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%',
      };
    }
    return {
      color: 'red',
      label: 'Avoid',
      action: '⛔ Avoid — Low edge',
      message: '⛔ Avoid — Low edge',
    };
  }

  function openModal() {
    ensure();
    const isPinned = localStorage.getItem('fl_results_pinned') === '1';
    elements.root.classList.add(clsOpen);
    if (isPinned) {
      elements.root.classList.add(clsPinned);
    } else {
      elements.root.classList.remove(clsPinned);
    }

    elements.dialog.setAttribute('aria-hidden', 'false');
    try {
      elements.closeBtn?.focus({ preventScroll: true });
    } catch (_) {
      // ignore focus errors
    }
    switchTab('predictions');
  }

  function setWorking(isWorking) {
    if (!elements) ensure();
    if (!elements) return;
    if (isWorking) {
      elements.root.classList.add('fl-results--working');
    } else {
      elements.root.classList.remove('fl-results--working');
    }
    if (elements.title) {
      elements.title.textContent = isWorking ? 'Predictions · Working…' : 'Predictions';
    }
  }

  function renderSkeletonView() {
    openModal();
    setWorking(true);
    fillBadge(elements.badgeWin, '🥇 Win', 'Loading…', '', 'fl-badge--gold');
    fillBadge(elements.badgePlace, '🥈 Place', 'Loading…', '', 'fl-badge--silver');
    fillBadge(elements.badgeShow, '🥉 Show', 'Loading…', '', 'fl-badge--bronze');
    if (elements.confPct) elements.confPct.textContent = '--';
    if (elements.confBar) {
      elements.confBar.style.width = '15%';
      elements.confBar.style.background = '#4b5563';
    }
    if (elements.reasonsSection) elements.reasonsSection.style.display = 'none';
    if (elements.exoticsContent) {
      elements.exoticsContent.innerHTML = `<div style="opacity:0.7;font-size:13px;">Loading ticket ideas…</div>`;
    }
    if (elements.strategyWrap) {
      elements.strategyWrap.innerHTML = `<div style="opacity:0.7;font-size:13px;">Loading strategy…</div>`;
    }
  }

  function renderErrorView(message) {
    openModal();
    setWorking(false);
    const msg = message || 'Prediction failed.';
    fillBadge(elements.badgeWin, '🥇 Win', '—', '', 'fl-badge--gold');
    fillBadge(elements.badgePlace, '🥈 Place', '—', '', 'fl-badge--silver');
    fillBadge(elements.badgeShow, '🥉 Show', '—', '', 'fl-badge--bronze');
    if (elements.confPct) elements.confPct.textContent = '--';
    if (elements.confBar) {
      elements.confBar.style.width = '0%';
      elements.confBar.style.background = '#4b5563';
    }
    if (elements.reasonsSection) elements.reasonsSection.style.display = 'none';
    const errHtml = `<div style="padding:12px;border:1px solid rgba(255,99,99,0.4);background:rgba(255,99,99,0.08);color:#ff9999;border-radius:8px;">${msg}</div>`;
    if (elements.exoticsContent) elements.exoticsContent.innerHTML = errHtml;
    if (elements.strategyWrap) elements.strategyWrap.innerHTML = errHtml;
  }

  function renderStoplightSignal(container, metrics) {
    const sig = computeSignal(metrics);
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
    const message = sig.message || sig.action || `${sig.label}`;
    dot.title = `${sig.label} · Uses confidence, Top-3 mass, and gap deltas`;
    txt.textContent = `${sig.label} — ${message}`;

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
      if (rec === 'Skip / Observe') {
        return { lines: ['⛔ Signal red — sit out this race.'], recommended: rec };
      }
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
    if (strategySignal.color === 'green' && gates.allow_win_only) {
      effectiveRecommendation = 'Win Only';
    }
    if (strategySignal.color === 'red') {
      effectiveRecommendation = 'Skip / Observe';
      if (!s.rationale.includes('Signal red — sit out')) {
        s.rationale.push('Signal red — sit out');
      }
    }
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
    const signalMetrics = {
      confidence: strategyConfidencePct,
      top3Mass: top3MassPct,
      gap1: gap12Pct,
      gap2: gap23Pct,
    };
    const strategySignal = computeSignal(signalMetrics);
    renderStoplightSignal(card, signalMetrics);

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
            const sig = computeSignal({
              confidence: strategyConfidencePct,
              top3Mass: top3MassPct,
              gap1: gap12Pct,
              gap2: gap23Pct,
            });
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

      const recoValueEl = reco.querySelector('.fl-reco-value');
      if (recoValueEl && resolvedReco) {
        recoValueEl.textContent = resolvedReco;
      }
      const noteEl = plan.querySelector('.fl-note');
      if (noteEl) {
        const noteByColor = {
          green: '✅ Strong edge detected — scale stakes or lean Win-only when bankroll allows.',
          yellow: '⚠️ Mixed edge — stay light with ATB ($1–$3) or Win-only if ≥80% confidence.',
          red: '⛔ Signal red — sit out and preserve bankroll.',
        };
        noteEl.textContent = noteByColor[strategySignal.color] || noteEl.textContent;
      }

      wrap.appendChild(card);

      // Wire bankroll slider + live plan render
      const linesEl = wrap.querySelector('#fl-plan-lines');
      const bkEl = wrap.querySelector('#fl-bk');
      const bkVal = wrap.querySelector('#fl-bk-val');
      
      // Get picks from the prediction data (need to extract from parent context)
      // Try to get picks from lastPred or construct from strategy metrics
      const picks = fallbackData.picks || (s.metrics?.top || []).slice(0, 3).map(t => ({ name: t.name || '' })).filter(p => p.name);
      const rec = effectiveRecommendation || 'Across the Board';

      function renderPlan() {
        if (!linesEl) return;
        const lines = planLinesFor(rec, picks, bankroll, gatesForPlan);
        linesEl.innerHTML = lines.lines.map(l => `<li style="margin:4px 0;color:#b8bdd4;font-size:13px;">${l}</li>`).join('');
        if (recoValueEl && lines.recommended) {
          recoValueEl.textContent = lines.recommended;
        }
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

  function renderContent(pred = {}) {
    openModal();
    setWorking(false);
    lastPred = pred;
    // Guard: ensure modal root exists before rendering
    if (!root || !document.body.contains(root)) {
      console.warn('[FLResults] Modal root not available; skipping render.');
      return;
    }

    ensure();

    const { win, place, show, confidence, horses = [], reasons = {}, tickets } = pred || {};

    const getOdds = (name) => {
      if (!name) return '';
      const h = horses.find((x) => {
        const horseName = (x.name || x.horse || '').toLowerCase();
        const targetName = (name || '').toLowerCase();
        return horseName === targetName;
      });
      return h?.odds || '';
    };

    // Fill badges
    fillBadge(elements.badgeWin, '🥇 Win', win, getOdds(win), 'fl-badge--gold');
    fillBadge(elements.badgePlace, '🥈 Place', place, getOdds(place), 'fl-badge--silver');
    fillBadge(elements.badgeShow, '🥉 Show', show, getOdds(show), 'fl-badge--bronze');

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

    // Update pin button text
    const isPinned = localStorage.getItem('fl_results_pinned') === '1';
    elements.pinBtn.textContent = isPinned ? 'Unpin' : 'Pin';

    // Render exotics if available
    if (tickets) {
      renderExotics(tickets);
    }

    // Render strategy if available (with fallback)
    renderStrategy(pred.strategy || null, { confidence: pred.confidence });
    
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

  }

  function hide() {
    if (!elements) return;
    elements.root.classList.remove(clsOpen, clsPinned);
    elements.dialog.setAttribute('aria-hidden', 'true');
    setWorking(false);
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
  const ResultsPanelAPI = {
    open(opts = {}) {
      if (opts.renderSkeleton) {
        renderSkeletonView();
        return;
      }
      if (opts.working) {
        setWorking(true);
      }
      openModal();
    },
    render({ pred, calibration } = {}) {
      try {
        const safePred = pred || {};
        renderContent(safePred);
      } catch (err) {
        console.error('[ResultsPanel] render error:', err);
        renderErrorView('Could not render results.');
      }
    },
    renderSkeleton() {
      renderSkeletonView();
    },
    renderError(message) {
      renderErrorView(message);
    },
    setWorking(isWorking) {
      setWorking(isWorking);
    },
    hide() {
      hide();
    },
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
      const payload = event?.data;
      if (!payload || payload.type !== 'predict:error') return;
      const error = payload.error || {};
      const code = error.code || error.context?.code;
      const message = error.message || '';
      let displayMessage = '';

      if (code === 'CALIBRATION_NOT_FOUND') {
        displayMessage = 'Calibration not found on server. Try a hard refresh or contact support.';
      } else if (message) {
        displayMessage = message;
      } else {
        displayMessage = 'Prediction failed, but UI is still usable. Try Analyze again or add race details.';
      }

      console.error('[ResultsPanel] predict error', error);
      ResultsPanelAPI.renderError(displayMessage);
    });
  }

  window.ResultsPanel = ResultsPanelAPI;

  window.FLResults = {
    show(pred) {
      try {
        if (!pred || typeof pred !== 'object') {
          console.warn('[FLResults] Invalid prediction data');
          return;
        }
        ResultsPanelAPI.open();
        ResultsPanelAPI.render({ pred });
      } catch (err) {
        console.error('[FLResults] show() error:', err);
      }
    },
    hide() {
      try {
        ResultsPanelAPI.hide();
      } catch (err) {
        console.error('[FLResults] hide() error:', err);
      }
    },
  };
})();

