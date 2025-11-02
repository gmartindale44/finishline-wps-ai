(() => {
  const state = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    analyzed: false,
    parsedHorses: []
  });
  function findPicker() {
    const wrap = document.querySelector('#fl-picker-wrap') || document;
    const btn = wrap.querySelector('[data-fl-file-btn]') || document.querySelector('[data-fl-file-btn]');
    const input = wrap.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
    const label = wrap.querySelector('#file-selected-label') || document.querySelector('#file-selected-label');
    return { btn, input, label };
  }
  function setLabel(n) {
    const { label } = findPicker();
    if (!label) return;
    label.textContent = n > 0 ? `Loaded ${n} file${n > 1 ? 's' : ''}` : 'No file selected';
  }
  function enableAnalyzeIfNeeded() {
    const analyzeBtn = document.querySelector('[data-action="analyze"], #analyzeBtn, button:contains("Analyze with AI")');
    // Fallback: find by visible text
    let btn = analyzeBtn;
    if (!btn) {
      btn = Array.from(document.querySelectorAll('button')).find(b => /analyze with ai/i.test(b.textContent));
    }
    if (btn) btn.disabled = !(state.pickedFiles && state.pickedFiles.length > 0);
  }
  function bind() {
    const { btn, input } = findPicker();
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
      input.click();
    });
    input.addEventListener('change', () => {
      state.pickedFiles = Array.from(input.files || []);
      setLabel(state.pickedFiles.length);
      enableAnalyzeIfNeeded();
    });
  }
  // Expose a tiny diag helper
  window.__fl_diag = function () {
    return {
      pickedFiles: state.pickedFiles?.map(f => ({ name: f.name, size: f.size })),
      analyzed: state.analyzed,
      parsedHorses: state.parsedHorses?.length || 0
    };
  };
  // Initial bind + observers
  bind();
  const mo = new MutationObserver(() => bind());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  // Poll just in case some libraries swallow events
  setInterval(() => bind(), 1000);
})();
