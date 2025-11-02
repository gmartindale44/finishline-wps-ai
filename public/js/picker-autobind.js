(function () {
  const state = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    analyzed: false,
    parsedHorses: [],
  });

  function els() {
    const pickBtn = document.querySelector('[data-fl-file-btn]') || document.getElementById('fl-file-btn');
    const fileInput = document.getElementById('fl-file') || document.querySelector('input[type="file"][id="fl-file"]') || document.querySelector('input[type="file"]');
    const analyzeBtn = document.querySelector('[data-fl-analyze]') || document.getElementById('analyze-btn') || document.querySelector('button.analyze');
    const label = document.getElementById('file-selected-label') || document.querySelector('#file-selected-label');
    return { pickBtn, fileInput, analyzeBtn, label };
  }

  function enable(el, on = true) {
    if (!el) return;
    el.disabled = !on;
    el.classList.toggle('disabled', !on);
    el.setAttribute('aria-disabled', String(!on));
  }

  function updateLabel(label, n) {
    if (!label) return;
    label.textContent = n > 0 ? `Loaded ${n} file${n > 1 ? 's' : ''}` : 'No file selected';
  }

  function onFileChange() {
    const { fileInput, analyzeBtn, label } = els();
    if (!fileInput) return;
    const files = Array.from(fileInput.files || []);
    state.pickedFiles = files;
    updateLabel(label, files.length);
    enable(analyzeBtn, files.length > 0 || state.parsedHorses.length > 0);
  }

  function bind() {
    const { pickBtn, fileInput, analyzeBtn } = els();
    if (!pickBtn || !fileInput) return;
    pickBtn.addEventListener('click', () => fileInput.click(), { passive: true });
    fileInput.addEventListener('change', onFileChange, { passive: true });
    // Reflect existing browser state (bfcache/navigation)
    if (fileInput.files && fileInput.files.length) onFileChange();
    // Ensure Analyze is enabled if parsed horses already exist
    enable(analyzeBtn, (fileInput.files && fileInput.files.length > 0) || state.parsedHorses.length > 0);
  }

  // Bind now and on DOM mutations (handles re-renders)
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', bind, { once: true })
    : bind();

  const mo = new MutationObserver(() => bind());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Debug helper for manual checks
  window.__fl_diag = () => ({
    pickedFiles: state.pickedFiles?.length || 0,
    analyzed: state.analyzed,
    parsedHorses: state.parsedHorses?.length || 0,
  });
})();
