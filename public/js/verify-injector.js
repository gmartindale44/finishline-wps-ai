(function () {
  const BTN_ID = 'fl-verify-btn';
  const BTN_CLASS = 'fl-verify-btn';
  const TOAST_ID = 'fl-verify-toast';

  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function once(el, id) { return el && !el.querySelector('#' + id); }

  function makeBtn() {
    const btn = document.createElement('button');
    btn.id = BTN_ID + '-' + Math.random().toString(36).slice(2, 7); // prevent duplicate IDs across two toolbars
    btn.className = BTN_CLASS;
    btn.type = 'button';
    btn.textContent = 'Verify result';
    btn.style.cssText = `
      margin-left: .5rem;
      padding: .4rem .6rem;
      border-radius: .4rem;
      border: 1px solid var(--fl-accent, #6ea8fe);
      background: transparent;
      color: #dbe7ff;
      cursor: pointer;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(110,168,254,0.15)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    btn.addEventListener('click', onVerifyClick);
    return btn;
  }

  function toast(msg, ok = true) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.style.cssText = `
        position: fixed; right: 16px; bottom: 16px; z-index: 99999;
        padding: 10px 14px; border-radius: 8px; font: 14px/1.3 system-ui, sans-serif;
        color: #0b1020; background: #bde5b8; box-shadow: 0 6px 22px rgba(0,0,0,.25);
      `;
      document.body.appendChild(el);
    }
    el.style.background = ok ? '#bde5b8' : '#ffc9c9';
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 4000);
  }

  function coerceInt(v) {
    const n = parseInt(String(v||'').replace(/[^\d]/g,''), 10);
    return Number.isFinite(n) ? n : undefined;
  }

  // Try to read values from common inputs used in FinishLine UI
  function readContext() {
    // Adjust selectors if your inputs differ
    const trackInput = $('[name="track"], input[data-fl="track"]') || $('.fl-track-input');
    const raceInput  = $('[name="race"], input[data-fl="race"]') || $('.fl-race-input');
    const dateInput  = $('[name="date"], input[type="date"], input[data-fl="date"]');

    const track = trackInput && trackInput.value ? trackInput.value.trim() : undefined;
    const raceNo = coerceInt(raceInput && raceInput.value);
    // Accept YYYY-MM-DD or today if missing
    const date = (dateInput && dateInput.value) ? dateInput.value.trim() : new Date().toISOString().slice(0,10);

    return { track, raceNo, date };
  }

  async function onVerifyClick() {
    try {
      let { track, raceNo, date } = readContext();

      if (!track) track = prompt('Track name (e.g., Penn National):', track || '');
      if (!raceNo) raceNo = coerceInt(prompt('Race number:', '') || '');
      if (!date)   date   = prompt('Date (YYYY-MM-DD):', new Date().toISOString().slice(0,10));

      if (!track || !raceNo || !date) {
        toast('Canceled: need track, race #, and date.', false);
        return;
      }

      const res = await fetch('/api/verify_race', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track, raceNo, date })
      });

      if (!res.ok) {
        const text = await res.text().catch(()=> '');
        toast(`Verify failed (${res.status}) ${text || ''}`, false);
        return;
      }

      const data = await res.json().catch(()=>({}));
      toast('Verification stored ✅');
      console.info('[verify_race] response:', data);
    } catch (err) {
      console.error(err);
      toast('Verify error. See console.', false);
    }
  }

  // Decide where to inject: look for modal toolbars used by Predictions/Strategy
  function findToolbars(root=document) {
    // Typical structure: a dialog/modal with a header bar containing buttons (Copy/Pin/New Race)
    // We attach next to those.
    const modal = root.querySelector('.fl-modal, .fl-dialog, .modal, [data-fl="predictions-modal"]') || root;
    const toolbars = [];
    // Both tabs often share the same header; grab all visible button rows in the modal
    $all('.fl-toolbar, .predictions-toolbar, .strategy-toolbar, .modal-header-buttons', modal)
      .forEach(row => toolbars.push(row));
    // Fallback: look for button clusters inside the modal
    if (!toolbars.length) {
      $all('.fl-modal button, .fl-dialog button, .modal button', modal)
        .map(btn => btn.closest('div'))
        .filter(Boolean)
        .forEach(row => { if (!toolbars.includes(row)) toolbars.push(row); });
    }
    return toolbars;
  }

  function injectButtons() {
    const toolbars = findToolbars();
    if (!toolbars.length) return;

    toolbars.forEach(tb => {
      // Guard: if we already inserted a verify button in this row, skip
      if (tb.querySelector('.' + BTN_CLASS)) return;
      tb.appendChild(makeBtn());
    });
  }

  // Observe DOM for the modal opening + tab swaps
  const obs = new MutationObserver(() => injectButtons());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Also try once after load (for SSR d content)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButtons, { once: true });
  } else {
    injectButtons();
  }

})();

