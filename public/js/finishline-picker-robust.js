(() => {
  // Shared durable state
  const ST = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    parsedHorses: null,
    analyzed: false,
    ui: {}
  });

  const $ = (id) => document.getElementById(id);
  const q = (sel) => document.querySelector(sel);

  // Update this if your Analyze button has a different selector/id
  function getAnalyzeBtn() {
    return (
      $('#analyze-btn') ||
      $('#analyze-with-ai') ||
      q('[data-analyze-btn]') ||
      q('button#analyze') ||
      q('button[name="analyze"]')
    );
  }
  function setAnalyzeEnabled(on) {
    const btn = getAnalyzeBtn();
    if (btn) btn.disabled = !on;
  }
  function updateFileLabel() {
    const label = $('#file-selected-label');
    const n = ST.pickedFiles?.length || 0;
    if (label) label.textContent = n ? `Loaded ${n} file${n>1?'s':''}` : 'No file selected';
    setAnalyzeEnabled(n > 0);
  }

  // Canonical handler when files are chosen
  function onFilesChosen(list) {
    const files = Array.from(list || []);
    ST.pickedFiles = files;
    ST.analyzed = false; // new files => new analysis needed
    updateFileLabel();
  }

  function bindOnce() {
    const proxy   = $('#fl-file-proxy');
    const primary = $('#fl-file');
    const backup  = $('#fl-file-backup');
    if (!proxy || !primary || !backup) return;

    primary.disabled = false;
    backup.disabled  = false;

    // Some browsers (and PDFs) fire only 'input'; listen to both
    const wire = (inp) => {
      const onChange = (e) => onFilesChosen(inp.files);
      const onInput  = (e) => onFilesChosen(inp.files);
      inp.removeEventListener('change', onChange, true);
      inp.removeEventListener('input',  onInput,  true);
      inp.addEventListener('change', onChange, true);
      inp.addEventListener('input',  onInput,  true);
    };
    wire(primary);
    wire(backup);

    // Clicking the label: clear primary BEFORE opening so selecting the same file triggers 'change'
    const openPrimary = () => {
      try { primary.value = ''; } catch {}
      if (typeof primary.showPicker === 'function') primary.showPicker();
      else primary.click();
    };

    proxy.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();

      let selectionDetected = false;
      const prevCount = (primary.files || []).length;

      // Short post-click poll catches cases where events are swallowed by wrappers
      let ticks = 0;
      const poll = setInterval(() => {
        ticks++;
        const curCount = (primary.files || []).length;
        if (curCount !== prevCount && curCount > 0) {
          selectionDetected = true;
          clearInterval(poll);
          onFilesChosen(primary.files);
        }
        if (ticks > 30) clearInterval(poll); // ~1.5s
      }, 50);

      // Fallback: reveal backup input if primary seems blocked
      const fallbackTimer = setTimeout(() => {
        if (!selectionDetected && (!primary.files || primary.files.length === 0)) {
          backup.style.position = 'static';
          backup.style.opacity  = '1';
          backup.focus();
          backup.click();
        }
      }, 900);

      const cancelFallback = () => {
        selectionDetected = true;
        clearTimeout(fallbackTimer);
        primary.removeEventListener('change', cancelFallback, true);
      };
      primary.addEventListener('change', cancelFallback, true);

      openPrimary();
    });

    proxy.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        proxy.click();
      }
    });

    // Debug: show backup input if URL has ?debug=picker
    const debugPicker = new URLSearchParams(location.search).get('debug') === 'picker';
    if (debugPicker) {
      backup.style.position = 'static';
      backup.style.opacity  = '1';
    }

    updateFileLabel();
  }

  // Document-level delegation: even if your app swaps the <input>, we still catch file selection
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && (t.id === 'fl-file' || t.id === 'fl-file-backup') && t.files) onFilesChosen(t.files);
  }, true);
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t && (t.id === 'fl-file' || t.id === 'fl-file-backup') && t.files) onFilesChosen(t.files);
  }, true);

  // Re-bind if DOM mutates (prevents "lost picker" after UI re-renders)
  const mo = new MutationObserver(() => bindOnce());
  mo.observe(document.body || document.documentElement, { childList:true, subtree:true });

  document.addEventListener('DOMContentLoaded', bindOnce);
  bindOnce();

  // Small diag helper
  window.__fl_diag = () => ({
    pickedFiles: (ST.pickedFiles||[]).map(f => ({ name:f.name, size:f.size })),
    analyzed: !!ST.analyzed,
    parsedHorses: Array.isArray(ST.parsedHorses) ? ST.parsedHorses.length : 0
  });
})();

