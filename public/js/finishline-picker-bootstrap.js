// public/js/finishline-picker-bootstrap.js

(() => {
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  // Buttons
  const btnFiles   = $('#btn-files') || $('#photo-input-main');  // Fallback to existing ID
  const btnAnalyze = $('#btn-analyze');
  const btnPredict = $('#btn-predict');

  // Chips next to buttons (span elements)
  const chipFiles   = $('#chip-files') || $('#chip-pick');  // Fallback to existing ID
  const chipAnalyze = $('#chip-analyze');
  const chipPredict = $('#chip-predict');

  // Table inputs (8 rows) - try both ID patterns and dynamic row patterns
  const rows = [];
  for (let i = 1; i <= 8; i++) {
    // Try exact ID pattern first
    let nameEl = $(`#horse-${i}-name`);
    let oddsEl = $(`#horse-${i}-odds`);
    let jockeyEl = $(`#horse-${i}-jockey`);
    let trainerEl = $(`#horse-${i}-trainer`);

    // Fallback: try dynamic rows by index
    if (!nameEl || !oddsEl) {
      const dynamicRows = $$('[data-horse-row], .horse-row').filter(r => 
        r.querySelector('input[name="horseName"], input[placeholder*="Horse Name"]')
      );
      const row = dynamicRows[i - 1];
      if (row) {
        nameEl = row.querySelector('input[name="horseName"], input[placeholder*="Horse Name"]');
        oddsEl = row.querySelector('input[name="mlOdds"], input[placeholder*="ML Odds"]');
        jockeyEl = row.querySelector('input[name="jockey"], input[placeholder*="Jockey"]');
        trainerEl = row.querySelector('input[name="trainer"], input[placeholder*="Trainer"]');
      }
    }

    rows.push({ name: nameEl, odds: oddsEl, jockey: jockeyEl, trainer: trainerEl });
  }

  // In-memory state
  let lastExtract = null;   // horses[]
  let lastAnalysis = null;  // analysis object
  let lastMeta = {};        // race meta

  const setChip = (chipEl, state, text) => {
    if (!chipEl) return;
    chipEl.classList.remove('chip--ready','chip--working','chip--done','chip--idle','chip--error');
    chipEl.classList.add(`chip--${state}`);
    if (text) chipEl.textContent = text;
  };

  const getHorsesFromUI = () => {
    const horses = [];
    for (const row of rows) {
      const name = (row.name?.value || '').trim();
      const odds = (row.odds?.value || '').trim();
      const jockey = (row.jockey?.value || '').trim();
      const trainer = (row.trainer?.value || '').trim();
      if (name) {
        horses.push({ name, odds, jockey, trainer });
      }
    }
    return horses;
  };

  const getMetaFromUI = () => ({
    track: ($('#race-track')?.value || '').trim(),
    distance: ($('#race-distance')?.value || '').trim(),
    surface: ($('#race-surface')?.value || '').trim(),
    date: ($('#race-date')?.value || '').trim(),
  });

  const safeJson = async (res) => {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const t = await res.text();
      const err = new Error(t.slice(0, 300) || `HTTP ${res.status}`);
      err.status = res.status;
      err.plain = true;
      throw err;
    }
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  const fillUI = (horses=[]) => {
    for (let i = 0; i < rows.length && i < horses.length; i++) {
      const h = horses[i] || {};
      if (rows[i].name) rows[i].name.value = h.name ?? '';
      if (rows[i].odds) rows[i].odds.value = h.odds ?? '';
      if (rows[i].jockey) rows[i].jockey.value = h.jockey ?? '';
      if (rows[i].trainer) rows[i].trainer.value = h.trainer ?? '';
    }
  };

  const uploadToBase64 = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  // Ensure we have at least 8 rows in the UI (if using dynamic rows)
  const ensureRows = async () => {
    const addBtn = $('#add-horse-btn');
    if (!addBtn) return;
    
    const currentRows = $$('[data-horse-row], .horse-row').filter(r => 
      r.querySelector('input[name="horseName"]')
    );
    
    while (currentRows.length < 8) {
      addBtn.click();
      await new Promise(r => setTimeout(r, 50));
      const newRows = $$('[data-horse-row], .horse-row').filter(r => 
        r.querySelector('input[name="horseName"]')
      );
      if (newRows.length === currentRows.length) break; // No progress
      currentRows.length = newRows.length;
    }

    // Re-scan rows after creating them
    for (let i = 1; i <= 8; i++) {
      const dynamicRows = $$('[data-horse-row], .horse-row').filter(r => 
        r.querySelector('input[name="horseName"]')
      );
      const row = dynamicRows[i - 1];
      if (row) {
        rows[i - 1] = {
          name: row.querySelector('input[name="horseName"]'),
          odds: row.querySelector('input[name="mlOdds"]'),
          jockey: row.querySelector('input[name="jockey"]'),
          trainer: row.querySelector('input[name="trainer"]'),
        };
      }
    }
  };

  // ---- Handlers ----

  // Wire file input to button click (if btn-pick exists)
  const pickBtn = $('#btn-pick');
  if (pickBtn && btnFiles) {
    pickBtn.addEventListener('click', () => btnFiles.click());
  }

  btnFiles?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await ensureRows();

    setChip(chipFiles, 'working', 'Parsing…');
    setChip(chipAnalyze, 'idle', 'Idle');
    setChip(chipPredict, 'idle', 'Idle');
    if (btnAnalyze) btnAnalyze.setAttribute('disabled', 'true');
    if (btnPredict) btnPredict.setAttribute('disabled', 'true');
    lastAnalysis = null;

    try {
      const b64 = await uploadToBase64(file);
      lastMeta = getMetaFromUI();

      const res = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ image_b64: b64, meta: lastMeta }),
      });

      const data = await safeJson(res);
      const horses = Array.isArray(data?.horses) ? data.horses : [];
      lastExtract = horses;

      fillUI(horses);

      const count = horses.length;
      const msg = `Parsed ${count} horses. Ready to Analyze.`;
      setChip(chipFiles, 'done', 'Done');
      setChip(chipAnalyze, 'ready', 'Ready');
      if (chipAnalyze) chipAnalyze.setAttribute('data-tip', msg);
      if (btnAnalyze) btnAnalyze.removeAttribute('disabled');
    } catch (err) {
      console.error('[UPLOAD/EXTRACT ERROR]', err);
      setChip(chipFiles, 'error', 'Error');
      alert(`Extract failed: ${err.message || err}`);
    }
  });

  btnAnalyze?.addEventListener('click', async () => {
    setChip(chipAnalyze, 'working', 'Analyzing…');
    setChip(chipPredict, 'idle', 'Idle');
    if (btnPredict) btnPredict.setAttribute('disabled', 'true');
    lastAnalysis = null;

    try {
      const horses = getHorsesFromUI();
      lastMeta = getMetaFromUI();

      if (!horses.length) throw new Error('No horses found in the form.');

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ horses, meta: lastMeta }),
      });

      const data = await safeJson(res);
      lastAnalysis = data;

      setChip(chipAnalyze, 'done', 'Done');
      setChip(chipPredict, 'ready', 'Ready');
      if (btnPredict) btnPredict.removeAttribute('disabled');
      console.debug('[FLDBG] Analysis complete; ready to predict.', { count: horses.length });
    } catch (err) {
      console.error('[ANALYZE ERROR]', err);
      setChip(chipAnalyze, 'error', 'Error');
      alert(`Analyze failed: ${err.message || err}`);
    }
  });

  btnPredict?.addEventListener('click', async () => {
    setChip(chipPredict, 'working', 'Predicting…');

    try {
      const horses = getHorsesFromUI();
      lastMeta = getMetaFromUI();

      if (!horses.length) throw new Error('No horses found in the form.');
      if (!lastAnalysis) throw new Error('Please Analyze first.');

      const res = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ horses, meta: lastMeta, analysis: lastAnalysis }),
      });

      const data = await safeJson(res);
      setChip(chipPredict, 'done', 'Done');

      // Handle different response shapes: {win:{name}, place:{name}, show:{name}} or {predictions:{...}}
      const winName = data?.win?.name || data?.win || data?.predictions?.win?.name || data?.predictions?.win || '—';
      const placeName = data?.place?.name || data?.place || data?.predictions?.place?.name || data?.predictions?.place || '—';
      const showName = data?.show?.name || data?.show || data?.predictions?.show?.name || data?.predictions?.show || '—';
      const conf = data?.confidence ?? data?.predictions?.confidence;
      alert(
        `⭐ Predictions:\n\n` +
        `🏆 Win: ${winName}\n` +
        `🥈 Place: ${placeName}\n` +
        `🥉 Show: ${showName}\n\n` +
        (conf ? `🔒 Confidence: ${Math.round(conf*100)/100}%` : '')
      );
      console.debug('[FLDBG] Predictions:', data);
    } catch (err) {
      console.error('[PREDICT ERROR]', err);
      setChip(chipPredict, 'error', 'Error');
      alert(`Predict failed: ${err.message || err}`);
    }
  });

})();
