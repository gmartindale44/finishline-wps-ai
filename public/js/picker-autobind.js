/* public/js/picker-autobind.js */

(function () {
  // Global shared state
  const state = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    analyzed: false,
    parsedHorses: [],
    speedFile: null,
    features: {},
  });

  // Prevent multiple binders: abort previous listeners if we re-init
  if (window.__fl_pickerAbort) {
    try { window.__fl_pickerAbort.abort(); } catch (_) {}
  }

  const abort = new AbortController();
  window.__fl_pickerAbort = abort;

  // Helper queries (resilient hooks)
  function $btn() {
    return document.querySelector('[data-fl-file-btn]') || document.getElementById('fl-file-btn');
  }

  function $input() {
    return document.getElementById('fl-file') || document.querySelector('input[type="file"][id="fl-file"]');
  }

  function $label() {
    return document.getElementById('file-selected-label') || document.querySelector('#file-selected-label');
  }

  function $analyze() {
    return document.querySelector('[data-fl-analyze]') || document.getElementById('analyze-btn');
  }

  function $speedBtn() {
    return document.getElementById('fl-speed-btn');
  }

  function $speedInput() {
    return document.getElementById('fl-speed-file');
  }

  function $speedLabel() {
    return document.getElementById('speed-file-label');
  }

  function enable(el, on = true) {
    if (!el) return;
    el.disabled = !on;
    el.classList.toggle('disabled', !on);
    el.setAttribute('aria-disabled', String(!on));
  }

  function setLabel(n) {
    const l = $label();
    if (!l) return;
    l.textContent = n > 0 ? `Loaded ${n} file${n > 1 ? 's' : ''}` : 'No file selected';
  }

  // Change handler -> update state + enable Analyze
  function onChange() {
    const input = $input();
    const analyze = $analyze();
    const files = Array.from((input && input.files) || []);
    state.pickedFiles = files;
    setLabel(files.length);
    enable(analyze, files.length > 0 || (state.parsedHorses && state.parsedHorses.length > 0));
  }

  // Single binding
  function bindOnce() {
    const pickBtn = $btn();
    const input = $input();
    const analyze = $analyze();

    if (!pickBtn || !input) return;

    // Button opens the native dialog (single listener via AbortController)
    pickBtn.addEventListener('click', () => input.click(), { signal: abort.signal, passive: true });

    // File change updates state
    input.addEventListener('change', onChange, { signal: abort.signal, passive: true });

    // If browser already has a file (bfcache), reflect it
    if (input.files && input.files.length) onChange();

    // If we already parsed horses earlier, keep Analyze enabled
    enable(analyze, (input.files && input.files.length > 0) || (state.parsedHorses && state.parsedHorses.length > 0));

    // Bind speed file picker
    const speedBtn = $speedBtn();
    const speedInput = $speedInput();
    const speedLabel = $speedLabel();

    if (speedBtn && speedInput && speedLabel) {
      speedBtn.addEventListener('click', () => speedInput.click(), { signal: abort.signal, passive: true });
      
      speedInput.addEventListener('change', () => {
        const file = speedInput.files && speedInput.files[0];
        state.speedFile = file || null;
        if (speedLabel) {
          speedLabel.textContent = file ? `Loaded: ${file.name}` : 'No file selected';
        }
      }, { signal: abort.signal, passive: true });

      if (speedInput.files && speedInput.files[0]) {
        state.speedFile = speedInput.files[0];
        speedLabel.textContent = `Loaded: ${speedInput.files[0].name}`;
      }
    }
  }

  // Bind once now; do NOT re-bind via MutationObserver (prevents double dialogs)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOnce, { once: true, signal: abort.signal });
  } else {
    bindOnce();
  }

  // Tiny debug helper
  window.__fl_diag = () => ({
    pickedFiles: state.pickedFiles.length,
    analyzed: state.analyzed,
    parsedHorses: (state.parsedHorses || []).length,
    bound: !abort.signal.aborted,
  });
})();
