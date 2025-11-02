// public/js/results-panel.js - Persistent results panel for predictions

(function () {
  'use strict';

  const root = document.getElementById('fl-results-root');
  if (!root) {
    console.error('[FLResults] Container #fl-results-root not found');
    return;
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
    };

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

  function renderExotics(tickets) {
    if (!elements || !elements.exoticsContent) return;
    if (!tickets || (!tickets.trifecta && !tickets.superfecta && !tickets.superHighFive)) {
      elements.exoticsContent.innerHTML = '<p style="opacity:0.7;text-align:center;padding:20px;">No exotic ticket suggestions available.</p>';
      return;
    }

    const fmtPct = (v) => {
      const p = Math.max(0, Math.min(1, Number(v || 0)));
      return (p * 100).toFixed(0) + '%';
    };

    let html = '';

    // Trifecta
    if (tickets.trifecta && tickets.trifecta.length > 0) {
      html += '<div style="margin-bottom:20px;"><h4 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#dfe3ff;">Trifecta Ideas</h4>';
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

  function renderStrategy(strategy) {
    if (!elements || !elements.strategyWrap || !strategy) return;

    const s = strategy;
    const wrap = elements.strategyWrap;

    wrap.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'fl-strategy-card';

    const h = document.createElement('div');
    h.className = 'fl-strategy-title';
    h.textContent = 'FinishLine AI Betting Strategy';
    card.appendChild(h);

    const reco = document.createElement('div');
    reco.className = 'fl-strategy-reco';
    reco.innerHTML = `<span class="fl-badge">Recommended</span> <strong>${s.recommended || 'Across the Board'}</strong>`;
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
          }
          tb.appendChild(tr);
        });
        card.appendChild(tbl);
      }

      // Suggested $200 Plan (race-specific, simple presets)
      const plan = document.createElement('div');
      plan.className = 'fl-strategy-plan';
      const top = (s.metrics?.top || []).map(x => x.name);
      const H1 = top[0] || 'Top 1';
      const H2 = top[1] || 'Top 2';
      const H3 = top[2] || 'Top 3';
      const H4 = top[3] || 'Top 4';
      const H5 = top[4] || 'Top 5';
      const H6 = top[5] || 'Top 6';
      
      let lines = [];
      const rec = (s.recommended || '').toLowerCase();
      
      if (rec.includes('trifecta box')) {
        lines = [
          `Win ${H1} — $60`,
          `Tri BOX ${H1},${H2},${H3} — $0.50 base × 6 = $3 → stake $90 total (multiple units)`,
          `Super (part-wheel) ${H1} / ${H2} / (${H3},${H4}) / (${H3},${H4},${H5}) — $0.10 base × combos ≈ $50`
        ];
      } else if (rec.includes('across the board')) {
        lines = [
          `ATB on ${H1} — Win/Place/Show $50 each = $150`,
          `Exacta ${H1} → ${H2},${H3} — $25 each = $50`
        ];
      } else if (rec.includes('win only')) {
        lines = [
          `Win ${H1} — $160`,
          `Saver Exacta ${H1} → ${H2} — $40`
        ];
      } else if (rec.includes('exacta box')) {
        lines = [
          `Win ${H1} — $80`,
          `Exacta BOX ${H1},${H2},${H3} — $2 base × 6 = $12 → stake $60 total`,
          `Tri ${H1} → ${H2} → ${H3},${H4} — $0.50 units = $60`
        ];
      } else {
        lines = [
          `Win ${H1} — $100`,
          `Exacta ${H1} → ${H2},${H3} — $50 total`,
          `Tri ${H1} → ${H2} → ${H3},${H4} — $50`
        ];
      }
      
      plan.innerHTML = `
        <h4>Suggested $200 Plan</h4>
        <ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>
        <div class="fl-note">Adjust stakes upward on higher confidence and toward exotics when Top-3 mass is high.</div>
      `;
      card.appendChild(plan);

      wrap.appendChild(card);
    }

  function render(pred) {
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

    // Confidence
    const pct = Math.max(0, Math.min(100, Number(confidence) || 0));
    elements.confPct.textContent = `${pct.toFixed(0)}%`;
    elements.confBar.style.width = `${pct}%`;

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

    // Render strategy if available
    if (pred.strategy) {
      renderStrategy(pred.strategy);
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

