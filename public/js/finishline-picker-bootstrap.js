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



  // ---------- FILE PICKER (robust) ----------

  function bindFilePicker() {
    const btn   = document.getElementById('fl-file-btn');
    const input = document.getElementById('fl-file');
    const label = document.getElementById('file-selected-label');

    if (!btn || !input) return;

    // z-index + pointer protections to beat overlays
    btn.style.position = 'relative';
    btn.style.zIndex   = '10010';
    btn.style.pointerEvents = 'auto';
    input.style.pointerEvents = 'auto';

    // Native picker must be opened by a user gesture
    btn.onclick = (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      input.disabled = false;
      input.click();
    };

    input.onchange = () => {
      const files = Array.from(input.files || []);
      window.__fl_state.pickedFiles = files;
      if (label) {
        const n = files.length;
        label.textContent = n ? `Loaded ${n} file${n>1?'s':''}` : 'No file selected';
      }
      // Do NOT clear parsed horses/analyzed here.
      // Do NOT wipe pickedFiles here; we allow re-use across UI updates.
    };
  }

  // Re-bind if the DOM changes (Hot reload / dynamic UI)
  const mo = new MutationObserver(() => bindFilePicker());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', bindFilePicker);
  bindFilePicker();

  // Small helper for quick diagnostics in DevTools
  window.__fl_diag = () => ({
    pickedFiles: window.__fl_state?.pickedFiles?.map(f => ({ name:f.name, size:f.size })),
    parsedHorses: Array.isArray(window.__fl_state?.parsedHorses) ? window.__fl_state.parsedHorses.length : 0,
    analyzed: !!window.__fl_state?.analyzed
  });



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

        // Persist analyzed state - keep parsedHorses intact
        state.parsedHorses = horses; // Ensure we keep the parsed horses
        state.analyzed = true; // Mark as analyzed (boolean)
        state.ui.lastAction = 'analyze';
        sessionStorage.setItem('fl_last_analysis', JSON.stringify(analysis));

        // Enable predict button
        if (predictBtnEl) predictBtnEl.disabled = false;

        // After successful analyze, allow re-selecting same file (only clear input control, NOT state)
        const fileInput = document.getElementById('fl-file');
        if (fileInput) fileInput.value = ''; // IMPORTANT: do NOT clear pickedFiles/state

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

      function getHorsesForPrediction() {
        // 1) Prefer the analyzed/parsed list
        if (window.__fl_state?.analyzed && Array.isArray(window.__fl_state.parsedHorses) && window.__fl_state.parsedHorses.length) {
          return window.__fl_state.parsedHorses;
        }
        // 2) Fallback: read from the current rows (typed-in)
        return readHorsesFromTable(); // your existing method
      }

      const horses = getHorsesForPrediction();
      if (!horses || !horses.length) {
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
