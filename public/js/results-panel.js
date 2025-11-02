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
      tabContentPredictions: wrap.querySelector('#fl-tab-predictions'),
      tabContentExotics: wrap.querySelector('#fl-tab-exotics'),
      exoticsContent: wrap.querySelector('#fl-exotics-content'),
    };

    // Event listeners
    wrap.addEventListener('click', (e) => {
      if (e.target.matches('[data-close]') || e.target.classList.contains('fl-results__backdrop')) {
        hide();
      } else if (e.target.matches('[data-copy]')) {
        copy();
      } else if (e.target.matches('[data-pin]')) {
        togglePin();
      } else if (e.target.matches('[data-tab]')) {
        const tab = e.target.getAttribute('data-tab');
        switchTab(tab);
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
    if (tab === 'predictions') {
      elements.tabPredictions.style.borderBottomColor = '#8b5cf6';
      elements.tabPredictions.style.color = '#dfe3ff';
      elements.tabExotics.style.borderBottomColor = 'transparent';
      elements.tabExotics.style.color = '#b8bdd4';
      elements.tabContentPredictions.style.display = 'block';
      elements.tabContentExotics.style.display = 'none';
    } else if (tab === 'exotics') {
      elements.tabPredictions.style.borderBottomColor = 'transparent';
      elements.tabPredictions.style.color = '#b8bdd4';
      elements.tabExotics.style.borderBottomColor = '#8b5cf6';
      elements.tabExotics.style.color = '#dfe3ff';
      elements.tabContentPredictions.style.display = 'none';
      elements.tabContentExotics.style.display = 'block';
    }
  }

  function renderExotics(tickets) {
    if (!elements || !elements.exoticsContent) return;
    if (!tickets || (!tickets.trifecta && !tickets.superfecta && !tickets.superHighFive)) {
      elements.exoticsContent.innerHTML = '<p style="opacity:0.7;text-align:center;padding:20px;">No exotic ticket suggestions available.</p>';
      return;
    }

    let html = '';

    // Trifecta
    if (tickets.trifecta && tickets.trifecta.length > 0) {
      html += '<div style="margin-bottom:20px;"><h4 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#dfe3ff;">Trifecta Ideas</h4>';
      tickets.trifecta.forEach(t => {
        const confPct = Math.round((t.confidence || 0) * 100);
        html += `<div style="padding:10px;background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.3);border-radius:10px;margin-bottom:8px;">
          <div style="font-weight:600;color:#dfe3ff;margin-bottom:4px;">${t.label}</div>
          <div style="font-size:12px;opacity:0.75;">~confidence ${confPct}%</div>
        </div>`;
      });
      html += '</div>';
    }

    // Superfecta
    if (tickets.superfecta && tickets.superfecta.length > 0) {
      html += '<div style="margin-bottom:20px;"><h4 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#dfe3ff;">Superfecta Ideas</h4>';
      tickets.superfecta.forEach(t => {
        const confPct = Math.round((t.confidence || 0) * 100);
        html += `<div style="padding:10px;background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.3);border-radius:10px;margin-bottom:8px;">
          <div style="font-weight:600;color:#dfe3ff;margin-bottom:4px;">${t.label}</div>
          <div style="font-size:12px;opacity:0.75;">~confidence ${confPct}%</div>
        </div>`;
      });
      html += '</div>';
    }

    // Super High Five
    if (tickets.superHighFive && tickets.superHighFive.length > 0) {
      html += '<div style="margin-bottom:20px;"><h4 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#dfe3ff;">Super High Five Ideas</h4>';
      tickets.superHighFive.forEach(t => {
        const confPct = Math.round((t.confidence || 0) * 100);
        html += `<div style="padding:10px;background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.3);border-radius:10px;margin-bottom:8px;">
          <div style="font-weight:600;color:#dfe3ff;margin-bottom:4px;">${t.label}</div>
          <div style="font-size:12px;opacity:0.75;">~confidence ${confPct}%</div>
        </div>`;
      });
      html += '</div>';
    }

    elements.exoticsContent.innerHTML = html;
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

