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
  // Note: State is managed in the file picker IIFE below
  const state = window.__fl_state || {
    pickedFiles: [],
    parsedHorses: null,
    analyzed: false,
    ui: {}
  };
  window.__fl_state = state;

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



  // ---------- FILE PICKER (robust, label-based with backup) ----------

  (() => {
    // Durable state shared with rest of app
    const ST = (window.__fl_state = window.__fl_state || {
      pickedFiles: [],
      parsedHorses: null,
      analyzed: false,
      ui: {}
    });

    function $(id){ return document.getElementById(id); }
    function q(sel){ return document.querySelector(sel); }

    // Try multiple selectors for the Analyze button (adjust if you have a known ID)
    function enableAnalyze(enable) {
      const btn = $('analyze-btn') || q('#analyze-with-ai, [data-analyze-btn], button#analyze, button[name="analyze"]');
      if (btn) btn.disabled = !enable;
    }

    function updateLabel() {
      const label = $('file-selected-label');
      const n = ST.pickedFiles?.length || 0;
      if (label) label.textContent = n ? `Loaded ${n} file${n>1?'s':''}` : 'No file selected';
      enableAnalyze(n > 0);
    }

    function bindPicker() {
      const proxy   = $('fl-file-proxy');
      const primary = $('fl-file');
      const backup  = $('fl-file-backup');

      if (!proxy || !primary || !backup) return;

      // z-index/pointer safety
      proxy.style.zIndex = '10010';

      // Primary "change" handler → persist files and enable analyze
      const onChosen = (files) => {
        ST.pickedFiles = Array.from(files || []);
        ST.analyzed = false;
        updateLabel();
      };

      primary.onchange = () => onChosen(primary.files);
      backup.onchange  = () => onChosen(backup.files);

      // If selecting the same file again, some browsers won't fire "change".
      // We clear the value *before* opening so change will fire.
      const openPrimary = () => {
        try {
          primary.value = '';
        } catch {}
        // Prefer native showPicker if available (some browsers)
        if (typeof primary.showPicker === 'function') {
          primary.showPicker();
        } else {
          primary.click();
        }
      };

      // Click / keyboard handlers on the label
      proxy.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();

        // Try primary first with a short timeout to detect failure
        let fired = false;
        const t = setTimeout(() => {
          if (!fired && (!primary.files || primary.files.length === 0)) {
            // Promote backup to visible if primary seems blocked
            backup.style.position = 'static';
            backup.style.opacity  = '1';
            backup.focus();
            backup.click();
          }
        }, 900);

        const prevCount = (primary.files || []).length;
        const onTempChange = () => {
          fired = true;
          clearTimeout(t);
          primary.removeEventListener('change', onTempChange);
        };
        primary.addEventListener('change', onTempChange);

        openPrimary();

        // Extra guard: if the element under the cursor isn't the proxy, log it
        const rect = proxy.getBoundingClientRect();
        const el = document.elementFromPoint(rect.left + 5, rect.top + 5);
        if (el && el !== proxy) {
          console.debug('[picker] overlay element on top of proxy:', el);
        }
      });

      proxy.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          proxy.click();
        }
      });

      // Debug mode: show backup input if ?debug=picker
      const isDebug = new URLSearchParams(location.search).get('debug') === 'picker';
      if (isDebug) {
        backup.style.position = 'static';
        backup.style.opacity  = '1';
      }

      updateLabel();
    }

    // Rebind when DOM mutates (prevents "lost" input on dynamic renders)
    const mo = new MutationObserver(() => bindPicker());
    mo.observe(document.body || document.documentElement, { childList:true, subtree:true });
    document.addEventListener('DOMContentLoaded', bindPicker);
    bindPicker();

    // Helpers for the rest of the app:

    window.__fl_markAnalyzeSuccess = (parsed=[]) => {
      ST.parsedHorses = parsed;
      ST.analyzed = true;
      // Do NOT clear ST.pickedFiles; only clear the primary input value so user can reselect same file later
      const primary = $('fl-file');
      if (primary) primary.value = '';
      enableAnalyze(false); // optional: disable analyze until new file is chosen
    };

    window.__fl_getHorsesForPrediction = (fallbackReaderFn) => {
      if (ST.analyzed && Array.isArray(ST.parsedHorses) && ST.parsedHorses.length) return ST.parsedHorses;
      return typeof fallbackReaderFn === 'function' ? fallbackReaderFn() : [];
    };

    window.__fl_diag = () => ({
      pickedFiles: ST.pickedFiles.map(f => ({ name:f.name, size:f.size })),
      analyzed: !!ST.analyzed,
      parsedHorses: Array.isArray(ST.parsedHorses) ? ST.parsedHorses.length : 0
    });
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
