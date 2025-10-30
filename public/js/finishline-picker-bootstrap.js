(function initFinishLinePicker() {
  const input   = document.getElementById('photo-input-main');
  const pickBtn = document.getElementById('choose-photos-btn');
  const status  = document.getElementById('picker-status');
  const analyzeBtn = document.getElementById('analyze-btn');
  const predictBtn = document.getElementById('predict-btn');

  if (!input || !pickBtn) return;

  const state = { horses: [], features: null };
  window.__finishline = state;

  // Front-end FSM and shared cache
  const FL = window.FL || (window.FL = {});
  FL.state = { analysis: null, horses: [] };

  const analyzeChip = document.getElementById('chip-analyze');
  const predictChip = document.getElementById('chip-predict');

  // Button aura & chip helpers
  function setBtnRunning(btn, chip, labelBusy) {
    if (btn) {
      btn.classList.add('running');
      btn.disabled = true;
    }
    if (chip) {
      chip.textContent = labelBusy;
      chip.className = 'chip chip-busy';
    }
  }

  function setBtnReady(btn, chip, labelReady = 'Ready') {
    if (btn) {
      btn.classList.remove('running');
      btn.disabled = false;
    }
    if (chip) {
      chip.textContent = labelReady;
      chip.className = 'chip chip-ok';
    }
  }

  function setBtnIdle(btn, chip, label = 'Idle') {
    if (btn) {
      btn.classList.remove('running');
      btn.disabled = false;
    }
    if (chip) {
      chip.textContent = label;
      chip.className = 'chip chip-muted';
    }
  }

  function setBtnError(btn, chip, msg = 'Error') {
    if (btn) {
      btn.classList.remove('running');
      btn.disabled = false;
    }
    if (chip) {
      chip.textContent = msg;
      chip.className = 'chip chip-err';
    }
  }

  // Retry-enabled API caller
  async function callJson(url, body, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      if (r.ok) return await r.json();
      if (r.status >= 500 && i < retries) {
        await new Promise(res => setTimeout(res, 300 + Math.random() * 400));
        continue;
      }
      const txt = await r.text().catch(() => `${r.status}`);
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
  }

  function getRaceMetaFromUI() {
    return {
      surface: (document.getElementById('race-surface')?.value || '').trim(),
      distance: (document.getElementById('race-distance')?.value || '').trim(),
      track: (document.getElementById('race-track')?.value || '').trim()
    };
  }

  function showPredictionAlert(result) {
    alert(
      `⭐ Predictions:\n\n` +
      `🏆 Win: ${result.win}\n` +
      `🥈 Place: ${result.place}\n` +
      `🥉 Show: ${result.show}\n\n` +
      `🔎 Confidence: ${(result.confidence * 100).toFixed(1)}%`
    );
  }

  // Wire Add Horse button to create new rows
  const addHorseBtn = document.getElementById('add-horse-btn');
  const horseRowsContainer = document.getElementById('horse-rows');
  if (addHorseBtn && horseRowsContainer) {
    addHorseBtn.addEventListener('click', () => {
      const templateRow = document.querySelector('.horse-row[data-horse-row]');
      if (!templateRow) return;
      const newRow = templateRow.cloneNode(true);
      // Clear values and remove IDs (ids must be unique)
      newRow.querySelectorAll('input').forEach(inp => {
        inp.value = '';
        inp.removeAttribute('id');
      });
      // Move Add Horse button to the new row (or hide it)
      const btn = newRow.querySelector('#add-horse-btn');
      if (btn) btn.style.display = 'none';
      horseRowsContainer.appendChild(newRow);
    });
  }

  const openDialog = (e) => { e?.preventDefault?.(); input.value = ''; input.click(); };
  pickBtn.addEventListener('click', openDialog);
  pickBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDialog(e); });

  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (status) status.textContent = `Selected: ${f.name} (${Math.round(f.size/1024)} KB). Parsing…`;

    try {
      const b64 = await fileToBase64(f);
      const res = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ image_b64: b64, mode: 'ocr_horse_list' })
      });
      const body = await safeJson(res);
      if (!res.ok) throw new Error(body?.error || `OCR ${res.status}`);

      if (!Array.isArray(body.horses) || body.horses.length === 0) {
        throw new Error('No horses found in the uploaded image.');
      }

      state.horses = normalizeHorses(body.horses);
      await populateHorseForm(state.horses);

      if (status) status.textContent = `Parsed ${state.horses.length} horses. Ready to Analyze.`;
      analyzeBtn?.removeAttribute('disabled');
      predictBtn?.setAttribute('disabled', 'true');
      state.features = null;
    } catch (err) {
      console.error('[FLDBG] OCR parse failed:', err);
      if (status) status.textContent = `Parse failed: ${err.message}`;
      alert('Analyze failed. See console for details.');
    }
  });

  // Analyze button: collect horses already on the form and POST to /api/analyze
  function mlToImplied(ml) {
    if (!ml) return null;
    const t = String(ml).trim().toUpperCase();
    if (t === 'EVEN' || t === 'EVENS' || t === '1/1') return 0.5;
    if (/^\d+(\.\d+)?$/.test(t)) {
      const num = parseFloat(t);
      return 1 / (num + 1);
    }
    const m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      if (b === 0) return null;
      return b / (a + b);
    }
    return null;
  }

  function collectHorsesFromDOM() {
    const rows = Array.from(document.querySelectorAll('.horse-row'));
    const horses = [];
    for (const row of rows) {
      const name = row.querySelector('input[name="horseName"]')?.value?.trim();
      const ml = row.querySelector('input[name="mlOdds"]')?.value?.trim();
      const jockey = row.querySelector('input[name="jockey"]')?.value?.trim();
      const trainer = row.querySelector('input[name="trainer"]')?.value?.trim();
      if (name) {
        horses.push({
          name,
          ml: ml || '',
          ml_implied: mlToImplied(ml),
          jockey: jockey || '',
          trainer: trainer || ''
        });
      }
    }
    return horses;
  }

  async function safeJsonParse(res) {
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      const match = txt.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
      }
      throw new Error('Invalid JSON response:\n' + txt);
    }
  }

  // Analyze handler
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
      const horses = collectHorsesFromDOM();
      if (!horses || horses.length < 3) {
        alert('Add horses first.');
        return;
      }

      setBtnRunning(analyzeBtn, analyzeChip, 'Analyzing…');
      predictBtn.disabled = true;
      if (predictChip) {
        predictChip.textContent = 'Waiting';
        predictChip.className = 'chip chip-warn';
      }

      try {
        const payload = {
          meta: getRaceMetaFromUI(),
          horses
        };
        const data = await callJson('/api/analyze', payload);
        FL.state.analysis = data;
        FL.state.horses = horses;
        setBtnReady(predictBtn, predictChip, 'Predict ready');
        setBtnReady(analyzeBtn, analyzeChip, 'Done');
        if (status) status.textContent = 'Analysis complete. Ready to Predict.';
        console.log('[FLDBG] Analysis complete; ready to predict.', { count: horses.length });
      } catch (e) {
        console.error('[FLDBG] Analyze fail:', e);
        setBtnError(analyzeBtn, analyzeChip, 'Error');
        alert('Analyze failed. See console for details.');
      }
    });
    analyzeBtn.removeAttribute('disabled');
  }

  // Predict handler
  if (predictBtn) {
    predictBtn.addEventListener('click', async () => {
      const analysis = FL.state.analysis;
      if (!analysis) {
        alert('Please analyze first.');
        setBtnError(predictBtn, predictChip, 'Analyze first');
        return;
      }

      setBtnRunning(predictBtn, predictChip, 'Predicting…');
      try {
        const result = await callJson('/api/predict_wps', {
          analysis,
          meta: getRaceMetaFromUI()
        });
        setBtnReady(predictBtn, predictChip, 'Done');
        showPredictionAlert(result);
        console.log('[FLDBG] Predictions:', result);
        if (status) status.textContent = 'Prediction complete.';
      } catch (e) {
        console.error('[FLDBG] Predict error:', e);
        setBtnError(predictBtn, predictChip, 'Error');
        alert('Predict failed. See console for details.');
      }
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  const safeJson = async (res) => { try { return await res.json(); } catch { return null; } };

  function normalizeHorses(horses) {
    return horses.map(h => ({
      name: (h.name || '').trim(),
      odds: (h.odds || '').toString().trim(),
      jockey: (h.jockey || '').trim(),
      trainer: (h.trainer || '').trim()
    })).filter(h => h.name);
  }

  async function populateHorseForm(horses) {
    const [first, ...rest] = horses;
    const nameEl   = document.querySelector('input[name="horseName"]') || document.querySelector('#horse-name');
    const oddsEl   = document.querySelector('input[name="mlOdds"]')    || document.querySelector('#ml-odds');
    const jockeyEl = document.querySelector('input[name="jockey"]')    || document.querySelector('#jockey');
    const trainerEl_case = document.querySelector('input[name="trainer"]')   || document.querySelector('#trainer');
    const addBtn   = document.getElementById('add-horse-btn') || document.querySelector('button.add-horse');

    if (first && nameEl && oddsEl && jockeyEl && trainerEl_case) {
      nameEl.value   = first.name || '';
      oddsEl.value   = first.odds || '';
      jockeyEl.value = first.jockey || '';
      trainerEl_case.value= first.trainer || '';
      [nameEl, oddsEl, jockeyEl, trainerEl_case].forEach(el => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    if (addBtn && rest.length > 0) {
      for (const h of rest) {
        addBtn.click();
        await new Promise(r => setTimeout(r, 150));
        const rows = document.querySelectorAll('.horse-row');
        const lastRow = rows[rows.length - 1];
        if (!lastRow) continue;
        const lastName = lastRow.querySelector('input[name="horseName"]') || lastRow.querySelector('#horse-name') || lastRow.querySelector('.horse-name');
        const lastOdds = lastRow.querySelector('input[name="mlOdds"]')    || lastRow.querySelector('#ml-odds') || lastRow.querySelector('.ml-odds');
        const lastJockey = lastRow.querySelector('input[name="jockey"]')    || lastRow.querySelector('#jockey') || lastRow.querySelector('.jockey');
        const lastTrainer = lastRow.querySelector('input[name="trainer"]')   || lastRow.querySelector('#trainer') || lastRow.querySelector('.trainer');
        if (lastName) lastName.value = h.name || '';
        if (lastOdds) lastOdds.value = h.odds || '';
        if (lastJockey) lastJockey.value = h.jockey || '';
        if (lastTrainer) lastTrainer.value = h.trainer || '';
      }
    }
  }

  function collectMeta() {
    const date      = (document.querySelector('#race-date') || {}).value || '';
    const track     = (document.querySelector('#race-track') || {}).value || '';
    const surface   = (document.querySelector('#race-surface') || {}).value || '';
    const distance  = (document.querySelector('#race-distance') || {}).value || '';
    return { date, track, surface, distance };
  }

  // Initialize on load
  setBtnIdle(analyzeBtn, analyzeChip);
  setBtnIdle(predictBtn, predictChip);
  if (predictBtn) predictBtn.disabled = true;
})();