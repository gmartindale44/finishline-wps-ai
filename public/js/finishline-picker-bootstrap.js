// public/js/finishline-picker-bootstrap.js
(function () {
  if (window.__fl_picker_boot__) return; window.__fl_picker_boot__ = true;

  function $(s){ return document.querySelector(s); }
  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn, { passive: true }); }

  const input  = $('#photo-input-main');
  const btn    = $('#choose-photos-btn');
  const label  = $('#choose-photos-label');
  const status = $('#picker-status');

  // Ensure nearby buttons do not submit forms unexpectedly
  document.querySelectorAll('.panel.actions button').forEach(b => {
    if (!b.getAttribute('type')) b.setAttribute('type','button');
  });

  // Primary path: explicit button triggers input.click()
  on(btn, 'click', (e) => {
    e.preventDefault();
    if (!input) return;
    try { input.value = ''; } catch {}
    input.click();
  });

  // Fallback: label-for works even if click delegation is blocked
  if (label && input && label.getAttribute('for') !== 'photo-input-main') {
    label.setAttribute('for','photo-input-main');
  }

  // Update small status text
  on(input, 'change', () => {
    const f = input.files && input.files[0];
    if (status) status.textContent = f ? `Selected: ${f.name}` : 'No file selected.';
  });

  // Final guard: ensure picker is always clickable
  const style = document.createElement('style');
  style.textContent = '.overlay, .backdrop, .mask, .modal-overlay, .loading, [data-blocking-overlay="true"]{pointer-events:none!important}';
  document.head.appendChild(style);

  console.log('[FLDBG] Picker bootstrap installed.');
})();
