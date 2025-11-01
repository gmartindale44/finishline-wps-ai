/* public/js/finishline-picker-bootstrap.js

   Predict gating + reliable analyze cache + schema-safe payload + always-deep

*/

(() => {

  // ---------- DOM ----------

  const fileInput = document.getElementById('file-input') || document.getElementById('photo-picker');

  const fileLabel = document.getElementById('file-selected-label') || document.getElementById('picker-status');

  const analyzeBtnEl = document.getElementById('analyze-btn') || document.querySelector('[data-action="analyze"]');

  const predictBtnEl = document.getElementById('predict-btn') || document.querySelector('[data-action="predict"]');



  // Accuracy dropdown removed - always using deep mode



  // ---------- GLOBAL STATE (durable, explicit) ----------

  window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    parsedHorses: null,
    analyzed: false,
    ui: {}
  };

  const state = window.__fl_state;

  // Lock predict button initially
  if (predictBtnEl && !state.analyzed) {
    predictBtnEl.disabled = true;
  }



  // Restore last analysis (optional; helps with reloads)
  try {
    const cached = sessionStorage.getItem('fl_last_analysis');
    if (cached) {
      const parsed = JSON.parse(cached);
      state.analyzed = hasValidAnalysis(parsed);
      if (state.analyzed && predictBtnEl) {
        predictBtnEl.disabled = false;
      }
    }
  } catch {}



  // ---------- HELPERS ----------

  function $(sel, root=document) { return root.querySelector(sel); }

  function enable(el, yes=true){ if(!el) return; el.disabled = !yes; el.classList.toggle('disabled', !yes); }

  // —— CSS guard so overlays can't block the button

  (() => {

    const id = 'fl-picker-zfix';

    if (!document.getElementById(id)) {

      const s = document.createElement('style');

      s.id = id;

      s.textContent = `

        #fl-file-btn { position: relative; z-index: 5; pointer-events: auto !important; }

        #fl-picker-wrap { position: relative; z-index: 4; }

        /* If any overlay exists, keep it below the picker */

        .overlay, .modal, .toast { z-index: 3 !important; }

      `;

      document.head.appendChild(s);

    }

  })();



  function toast(msg) {

    try { alert(msg); } catch {}

  }



  function hasValidAnalysis(analysis) {
    return !!(analysis && Array.isArray(analysis.scores) && analysis.scores.length > 0);
  }



  function minimalScoresForPredict(scores) {

    // Only the fields the API schema accepts

    return scores.map(s => ({

      name: s.name,

      odds: s.odds,

      jockey: s.jockey,

      trainer: s.trainer,

      score: typeof s.score === 'number' ? s.score : Number(s.score ?? 0)

    }));

  }



  function readMetaFromForm() {
    return {
      track:    (document.querySelector('#race-track')    ?.value || '').trim(),
      surface:  (document.querySelector('#race-surface')  ?.value || '').trim(),
      distance: (document.querySelector('#race-distance') ?.value || '').trim(),
    };
  }

  function readHorsesFromTable() {
    const rows = [...document.querySelectorAll('[data-horse-row]')];
    const horses = rows.map(r => ({
      name:   r.querySelector('[data-horse-name]')   ?.value?.trim() || '',
      odds:   r.querySelector('[data-horse-odds]')   ?.value?.trim() || '',
      jockey: r.querySelector('[data-horse-jockey]') ?.value?.trim() || '',
      trainer:r.querySelector('[data-horse-trainer]')?.value?.trim() || ''
    })).filter(h => h.name); // keep only rows with a name
    return horses;
  }

  // Alias for backward compatibility
  function collectMeta() {
    const meta = readMetaFromForm();
    const date = (document.getElementById('race-date') || {}).value || '';
    return { ...meta, date };
  }

  function readHorseRows() {
    return readHorsesFromTable();
  }



  async function readAsBase64(file) {

    return new Promise((resolve, reject) => {

      const fr = new FileReader();

      fr.onload = () => resolve(fr.result);

      fr.onerror = reject;

      fr.readAsDataURL(file);

    });

  }



  function setWorking(isWorking) {

    const chip = document.getElementById('chip-working');

    if (!chip) return;

    chip.textContent = isWorking ? 'Working…' : 'Done';

  }



  // ---------- FILE PICKER (robust, button-based) ----------

  (() => {
    // Shared state for the page
    const st = (window.__fl_state = window.__fl_state || {
      pickedFiles: [],
      parsedHorses: null,
      analyzed: false,
      ui: {}
    });

    function $(id){ return document.getElementById(id); }
    function enableAnalyze(enable){
      // Try common IDs/selectors from prior versions
      const btn = $('analyze-btn') || document.querySelector('#analyze-with-ai, [data-analyze-btn], button#analyze, button[name="analyze"]');
      if (btn) btn.disabled = !enable;
    }

    function updateLabel() {
      const label = $('file-selected-label');
      const n = st.pickedFiles?.length || 0;
      if (label) label.textContent = n ? `Loaded ${n} file${n>1?'s':''}` : 'No file selected';
      enableAnalyze(n > 0);
    }

    function bindPicker() {
      const proxy = $('fl-file-proxy');
      const input = $('fl-file');
      if (!proxy || !input) return;

      // Always ensure input is enabled and present
      input.disabled = false;

      // If you select the same file twice, browsers won't fire "change".
      // Clearing the value BEFORE opening guarantees change will fire.
      proxy.onclick = () => {
        input.value = '';
        // run in microtask so the clear lands before open()
        queueMicrotask(() => input.click());
      };

      input.onchange = () => {
        st.pickedFiles = Array.from(input.files || []);
        st.analyzed = false; // new files mean new analysis
        updateLabel();
      };
    }

    // Rebind on DOM changes in case a framework re-rendered the row
    const mo = new MutationObserver(() => bindPicker());
    mo.observe(document.body || document.documentElement, { childList:true, subtree:true });
    document.addEventListener('DOMContentLoaded', bindPicker);
    bindPicker();

    // Expose a tiny diag helper if you need it
    window.__fl_diag = () => ({
      pickedFiles: st.pickedFiles.map(f => ({name:f.name, size:f.size})),
      analyzed: !!st.analyzed,
      parsedHorses: Array.isArray(st.parsedHorses) ? st.parsedHorses.length : 0
    });

    // --- Hook these into your existing Analyze/Predict handlers ---

    // Call this at the end of a successful ANALYZE:
    window.__fl_markAnalyzeSuccess = (parsedHorses=[]) => {
      st.parsedHorses = parsedHorses;
      st.analyzed = true;
      // Do NOT clear st.pickedFiles so Predict can rely on it if needed
      const input = $('fl-file');
      if (input) input.value = ''; // allows re-selecting same file later
      enableAnalyze(false); // optional: disable Analyze until user picks new files
    };

    // Use this in PREDICT to gather horses (prefers analyzed set):
    window.__fl_getHorsesForPrediction = (fallbackReaderFn) => {
      if (st.analyzed && Array.isArray(st.parsedHorses) && st.parsedHorses.length) {
        return st.parsedHorses;
      }
      return typeof fallbackReaderFn === 'function' ? fallbackReaderFn() : [];
    };
  })();



  // ---------- ANALYZE ----------

  if (analyzeBtnEl) {

    analyzeBtnEl.addEventListener('click', async () => {

      if (state.lock) return;

      state.lock = true;

      setWorking(true);

      enable(analyzeBtnEl, false);

      enable(predictBtnEl, false);



      try {

        const meta = collectMeta();



        // If files selected ⇒ OCR first; else fall back to typed rows

        const haveFiles = Array.isArray(state.pickedFiles) && state.pickedFiles.length > 0;

        let horses = [];

        if (haveFiles) {

          const images = await Promise.all(state.pickedFiles.map(readAsBase64));

          const resp = await fetch("/api/photo_extract_openai_b64", {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({ images, meta })

          });

          const json = await resp.json();

          if (!resp.ok || !json.ok) throw new Error(json?.error || "OCR failed");

          horses = Array.isArray(json.horses) ? json.horses : [];

          if (horses.length > 0) {

            if (typeof window.populateHorseRows === 'function') {

              window.populateHorseRows(horses);

            }

          }

        } else {

          horses = readHorseRows();

        }



        if (!horses || horses.length === 0) {
          toast("No horses to analyze.");
          enable(predictBtnEl, false);
          return;
        }

        // Persist parsed horses BEFORE analyze
        state.parsedHorses = horses;
        if (process.env.FINISHLINE_PROVIDER_DEBUG) {
          console.debug('[OCR] parsedHorses length:', horses.length);
        }

        const meta = readMetaFromForm();
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            horses, 
            meta,
            mode: { deep: true, consensus_passes: 3 }
          })
        });



        if (!res.ok) {

          const t = await res.text();

          throw new Error(`Analyze failed: ${t || res.status}`);

        }



        const analysis = await res.json(); // {scores:[...], meta:{...}, ...}

        if (!hasValidAnalysis(analysis)) {

          throw new Error('Analyze returned no scores.');

        }



        if (process.env.FINISHLINE_PROVIDER_DEBUG) {
          console.debug('[Analyze] analyzed scores length:', analysis.scores?.length || 0);
        }

        // Persist analyzed state using the helper function
        if (typeof window.__fl_markAnalyzeSuccess === 'function') {
          window.__fl_markAnalyzeSuccess(horses);
        } else {
          // Fallback if helper not available
          window.__fl_state = window.__fl_state || {};
          window.__fl_state.parsedHorses = horses;
          window.__fl_state.analyzed = true;
        }

        state.parsedHorses = horses;
        state.analyzed = true;
        state.ui.lastAction = 'analyze';
        sessionStorage.setItem('fl_last_analysis', JSON.stringify(analysis));

        // Enable predict button
        if (predictBtnEl) predictBtnEl.disabled = false;

        toast(`Analysis complete — ${horses.length} entries parsed and ready.`);

      } catch (err) {

        console.error(err);

        toast(String(err.message || err));

      } finally {

        setWorking(false);

        enable(analyzeBtnEl, true);

        state.lock = false;

      }

    });

  }



  // ---------- PREDICT ----------

  if (predictBtnEl) {

    predictBtnEl.addEventListener('click', async () => {

      // Use the helper function if available, otherwise fallback
      let horses;
      if (typeof window.__fl_getHorsesForPrediction === 'function') {
        horses = window.__fl_getHorsesForPrediction(readHorsesFromTable);
      } else {
        // Fallback implementation
        if (window.__fl_state?.analyzed &&
            Array.isArray(window.__fl_state.parsedHorses) &&
            window.__fl_state.parsedHorses.length) {
          horses = window.__fl_state.parsedHorses;
        } else {
          horses = readHorsesFromTable();
        }
      }

      if (!horses?.length) {
        alert('Please analyze first (no horses available).');
        return;
      }

      if (process.env.FINISHLINE_PROVIDER_DEBUG) {
        console.debug('[Predict] horses length:', horses.length);
      }

      try {
        const meta = readMetaFromForm();
        const body = { 
          horses, 
          meta, 
          mode: { deep: true, consensus_passes: 3 } 
        };

        const res = await fetch('/api/predict_wps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Predict failed: ${t || res.status}`);
        }

        const pred = await res.json(); // { win, place, show, confidence, consensus }

        const consensusInfo = pred.consensus ? ` (consensus: ${pred.consensus.passes} passes, ${(pred.consensus.agreement * 100).toFixed(0)}% agreement)` : '';
        const msg = [
          '⭐ Predictions:',
          `🥇 Win: ${pred.win || 'N/A'}`,
          `🥈 Place: ${pred.place || 'N/A'}`,
          `🥉 Show: ${pred.show || 'N/A'}`,
          `📊 Confidence: ${pred.confidence ?? 'n/a'}${consensusInfo}`
        ].join('\n');

        alert(msg);

      } catch (err) {

        console.error(err);

        toast(String(err.message || err));

      }

    });

  }

})();
