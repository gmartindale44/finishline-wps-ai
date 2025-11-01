/* public/js/finishline-picker-bootstrap.js

   Predict gating + reliable analyze cache + schema-safe payload + always-deep

*/

(() => {

  // ---------- DOM ----------

  const fileInput = document.getElementById('photo-picker');

  const fileLabel = document.getElementById('file-selected-label') || document.getElementById('picker-status');

  const analyzeBtnEl = document.getElementById('analyze-btn') || document.querySelector('[data-action="analyze"]');

  const predictBtnEl = document.getElementById('predict-btn') || document.querySelector('[data-action="predict"]');



  // If you kept the Accuracy dropdown, we'll ignore it and always run deep

  const accuracySelect = document.getElementById('accuracy-select');



  // ---------- STATE ----------

  const state = {

    files: [],

    horses: [],       // current table rows

    analysis: null,   // last successful analysis

    lock: false

  };



  // Restore last analysis (optional; helps with reloads)

  try {

    const cached = sessionStorage.getItem('fl_last_analysis');

    if (cached) {

      state.analysis = JSON.parse(cached);

      enable(predictBtnEl, hasValidAnalysis(state.analysis));

    }

  } catch {}



  // ---------- HELPERS ----------

  function enable(el, yes = true) {

    if (!el) return;

    el.disabled = !yes;

    el.classList.toggle('opacity-50', !yes);

    el.classList.toggle('cursor-not-allowed', !yes);

  }



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



  function collectMeta() {

    // Read the 4 meta inputs on the page

    const date = (document.getElementById('race-date') || {}).value || '';

    const track = (document.getElementById('race-track') || {}).value || '';

    const surface = (document.getElementById('race-surface') || {}).value || '';

    const distance = (document.getElementById('race-distance') || {}).value || '';

    return { date, track, surface, distance, accuracy: 'deep' }; // force deep

  }



  function readHorseRows() {

    // Reads the 8/12/etc visible rows into objects

    // Adapt selectors to your markup if they differ

    const rows = Array.from(document.querySelectorAll('[data-horse-row]'));

    return rows.map(r => ({

      name: r.querySelector('[data-horse-name]')?.value?.trim() || '',

      odds: r.querySelector('[data-horse-odds]')?.value?.trim() || '',

      jockey: r.querySelector('[data-horse-jockey]')?.value?.trim() || '',

      trainer: r.querySelector('[data-horse-trainer]')?.value?.trim() || ''

    })).filter(h => h.name);

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



  // ---------- FILE PICKER ----------

  if (fileInput) {

    fileInput.addEventListener('change', () => {

      state.files = Array.from(fileInput.files || []);

      const n = state.files.length;

      if (fileLabel) fileLabel.textContent = n ? `Loaded ${n} file${n>1?'s':''}` : 'No file selected';

      enable(analyzeBtnEl, true);

    });

  }



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



        // Prefer OCR path if a file is selected

        if (state.files.length) {

          const images = await Promise.all(state.files.map(readAsBase64));

          const ocrRes = await fetch('/api/photo_extract_openai_b64', {

            method: 'POST',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify({ images, meta })

          });



          if (!ocrRes.ok) {

            const t = await ocrRes.text();

            throw new Error(`OCR failed: ${t || ocrRes.status}`);

          }



          const ocr = await ocrRes.json();

          // Expecting { horses: [...] }

          if (Array.isArray(ocr?.horses) && ocr.horses.length) {

            // Fill the table (you have a function for this in your code)

            if (typeof window.populateHorseRows === 'function') {

              window.populateHorseRows(ocr.horses);

            }

          }

        }



        // Read current rows and analyze

        const horses = readHorseRows();

        if (!horses.length) throw new Error('No horses to analyze.');



        const res = await fetch('/api/analyze', {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify({ horses, meta })

        });



        if (!res.ok) {

          const t = await res.text();

          throw new Error(`Analyze failed: ${t || res.status}`);

        }



        const analysis = await res.json(); // {scores:[...], meta:{...}, ...}

        if (!hasValidAnalysis(analysis)) {

          throw new Error('Analyze returned no scores.');

        }



        // Cache & enable predict

        state.analysis = analysis;

        sessionStorage.setItem('fl_last_analysis', JSON.stringify(analysis));

        enable(predictBtnEl, true);



        toast(`Analysis complete — ${analysis.scores.length} horses scored. Confidence: ${analysis.confidence ?? 'n/a'}.`);

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

      // Guard: require a valid analysis

      if (!hasValidAnalysis(state.analysis)) {

        toast('Please Analyze first.');

        return;

      }



      try {

        const meta = collectMeta(); // track/surface/distance only are used server-side

        const payload = {

          // Send only what the schema allows

          scores: minimalScoresForPredict(state.analysis.scores),

          meta: { track: meta.track, surface: meta.surface, distance: meta.distance }

        };



        const res = await fetch('/api/predict_wps', {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify(payload)

        });



        if (!res.ok) {

          const t = await res.text();

          throw new Error(`Predict failed: ${t || res.status}`);

        }



        const pred = await res.json(); // { win, place, show, confidence }

        const msg = [

          '⭐ Predictions:',

          `🥇 Win: ${pred.win}`,

          `🥈 Place: ${pred.place}`,

          `🥉 Show: ${pred.show}`,

          `📊 Confidence: ${pred.confidence ?? 'n/a'}`

        ].join('\n');



        alert(msg);

      } catch (err) {

        console.error(err);

        toast(String(err.message || err));

      }

    });

  }

})();
