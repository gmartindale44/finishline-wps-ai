/* public/js/picker-autobind.js */
(() => {
  const ST = (window.__fl_state = window.__fl_state || { pickedFiles: [], analyzed:false, parsedHorses:null });

  const find = {
    input() {
      const horsePanel = Array.from(document.querySelectorAll('*'))
        .find(n => /horse data/i.test(n.textContent||''));
      return (horsePanel && horsePanel.querySelector('input[type="file"]')) ||
             document.querySelector('input[type="file"]');
    },
    analyzeBtn() {
      return document.querySelector('#analyze-btn,#analyze-with-ai,[data-analyze-btn]') ||
             Array.from(document.querySelectorAll('button'))
               .find(b => /analyze/i.test(b.textContent||''));
    },
    label() {
      return document.querySelector('#file-selected-label') ||
             Array.from(document.querySelectorAll('span,div'))
               .find(n => /no file selected|loaded \d+ file/i.test(n.textContent||''));
    },
    proxy() {
      return Array.from(document.querySelectorAll('label,button,span,div'))
        .find(n => /choose photos|pdf/i.test(n.textContent||''));
    }
  };

  function setAnalyzeEnabled(on) { const b = find.analyzeBtn(); if (b) b.disabled = !on; }
  function updateLabel() {
    const n = ST.pickedFiles.length;
    const lbl = find.label();
    if (lbl) lbl.textContent = n ? `Loaded ${n} file${n>1?'s':''}` : 'No file selected';
    setAnalyzeEnabled(n > 0);
  }
  function onFiles(list) {
    ST.pickedFiles = Array.from(list||[]);
    ST.analyzed = false;
    updateLabel();
  }

  function bindInput(input) {
    if (!input) return;
    const handler = () => onFiles(input.files);
    input.addEventListener('change', handler, true);
    input.addEventListener('input',  handler, true);
  }

  function bindProxy(input) {
    const proxy = find.proxy();
    if (!proxy || !input) return;
    const clicker = (e) => {
      e.preventDefault(); e.stopPropagation();
      try { input.value = ''; } catch{}
      (input.showPicker || input.click).call(input);
      // Small poll for swallowed events
      let t=0; const id=setInterval(()=>{ t++; if ((input.files||[]).length){ onFiles(input.files); clearInterval(id); }
        if (t>40) clearInterval(id); }, 50);
    };
    proxy.addEventListener('click', clicker, true);
    proxy.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clicker(e); }
    }, true);
  }

  function wire() {
    const input = find.input();
    if (!input) return;
    bindInput(input);
    bindProxy(input);
    onFiles(input.files); // initial sync
  }

  // Global delegates (survive DOM swaps)
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t?.type === 'file' && t.files) onFiles(t.files);
  }, true);
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t?.type === 'file' && t.files) onFiles(t.files);
  }, true);

  new MutationObserver(wire).observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', wire);
  wire();

  window.__fl_diag = () => ({
    pickedFiles: ST.pickedFiles.map(f=>({name:f.name,size:f.size})),
    analyzed: ST.analyzed,
    parsedHorses: Array.isArray(ST.parsedHorses)?ST.parsedHorses.length:0
  });
})();

