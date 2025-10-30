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
  FL.state = 'idle'; // 'idle' | 'analyzing' | 'ready' | 'predicting'
  FL.last = { payload: null };

  // ---- STATUS CHIP ----
  function updateChip() {
    let chip = document.getElementById('fl-status-chip');
    if (!chip) {
      const chipEl = document.createElement('span');
      chipEl.id = 'fl-status-chip';
      chipEl.style.marginLeft = '12px';
      chipEl.style.padding = '4px 10px';
      chipEl.style.borderRadius = '12px';
      chipEl.style.fontSize = '0.85em';
      chipEl.style.transition = 'all 0.4s ease';
      chipEl.style.display = 'inline-block';
      chipEl.textContent = '🟢 Idle';
      document.querySelector('.actions')?.appendChild(chipEl)
        || document.querySelector('#analyze-btn')?.insertAdjacentElement('afterend', chipEl);
      chip = chipEl;
    }

    const c = chip;
    c.style.opacity = '1';
    if (FL.state === 'idle') {
      c.textContent = '🟢 Idle';
      c.style.background = 'rgba(0,255,100,0.15)';
      c.style.color = '#5CFF89';
    } else if (FL.state === 'analyzing') {
      c.textContent = '🟡 Analyzing...';
      c.style.background = 'rgba(255,200,0,0.15)';
      c.style.color = '#FFD85C';
    } else if (FL.state === 'ready') {
      c.textContent = '🔵 Ready';
      c.style.background = 'rgba(100,180,255,0.15)';
      c.style.color = '#5CB8FF';
    } else if (FL.state === 'predicting') {
      c.textContent = '🟣 Predicting...';
      c.style.background = 'rgba(180,100,255,0.15)';
      c.style.color = '#C890FF';
    }
  }

  function setState(next) {
    FL.state = next;
    updateChip();
    if (!analyzeBtn || !predictBtn) return;
    if (next === 'idle') {
      analyzeBtn.disabled = false;
      if (analyzeBtn.querySelector('.label')) {
        analyzeBtn.querySelector('.label').textContent = 'Analyze with AI';
      } else {
        analyzeBtn.textContent = 'Analyze with AI';
      }
      predictBtn.disabled = true;
      if (predictBtn.querySelector('.label')) {
        predictBtn.querySelector('.label').textContent = 'Predict W/P/S';
      } else {
        predictBtn.textContent = 'Predict W/P/S';
      }
    }
    if (next === 'analyzing') {
      analyzeBtn.disabled = true;
      if (analyzeBtn.querySelector('.label')) {
        analyzeBtn.querySelector('.label').textContent = 'Analyzing...';
      } else {
        analyzeBtn.textContent = 'Analyzing...';
      }
      predictBtn.disabled = true;
      if (predictBtn.querySelector('.label')) {
        predictBtn.querySelector('.label').textContent = 'Predict W/P/S';
      } else {
        predictBtn.textContent = 'Predict W/P/S';
      }
    }
    if (next === 'ready') {
      analyzeBtn.disabled = false;
      if (analyzeBtn.querySelector('.label')) {
        analyzeBtn.querySelector('.label').textContent = 'Analyze with AI';
      } else {
        analyzeBtn.textContent = 'Analyze with AI';
      }
      predictBtn.disabled = false;
      if (predictBtn.querySelector('.label')) {
        predictBtn.querySelector('.label').textContent = 'Predict W/P/S';
      } else {
        predictBtn.textContent = 'Predict W/P/S';
      }
    }
    if (next === 'predicting') {
      analyzeBtn.disabled = true;
      predictBtn.disabled = true;
      if (predictBtn.querySelector('.label')) {
        predictBtn.querySelector('.label').textContent = 'Predicting...';
      } else {
        predictBtn.textContent = 'Predicting...';
      }
    }
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

  async function runAnalyze() {
    if (FL.state === 'analyzing' || FL.state === 'predicting') return;
    try {
      setState('analyzing');

      const horses = collectHorsesFromDOM();
      if (!horses.length) {
        alert('Analyze failed: No horses found.');
        setState('idle');
        return;
      }

      const meta = {
        track: document.getElementById('race-track')?.value?.trim() || '',
        distance: document.getElementById('race-distance')?.value?.trim() || '',
        surface: document.getElementById('race-surface')?.value?.trim() || '',
        date: document.getElementById('race-date')?.value?.trim() || ''
      };

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ horses, meta })
      });
      const json = await safeJsonParse(res);
      if (!res.ok || !json.ok) {
        console.error('[FLDBG] Analyze failed:', json);
        alert(`Analyze failed: ${json.error || 'Unknown error'}`);
        setState('idle');
        return;
      }

      FL.last.payload = json.payload;
      if (status) status.textContent = 'Analysis complete. Ready to Predict.';
      console.log('[FLDBG] Analysis complete; ready to predict.', { count: horses.length });

      setState('ready');
    } catch (err) {
      console.error('[FLDBG] Analyze error:', err);
      alert(`Analyze failed: ${err.message}`);
      setState('idle');
    }
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      runAnalyze();
    });
    analyzeBtn.removeAttribute('disabled');
  }

  predictBtn?.addEventListener('click', async () => {
    const payload = FL.last.payload;
    if (!payload) {
      alert('Please run Analyze with AI first.');
      return;
    }

    if (FL.state !== 'ready') {
      alert('Predict failed: Analyze first.');
      return;
    }

    setState('predicting');
    if (status) status.textContent = 'Predicting W/P/S…';

    try {
      const res = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ payload })
      });
      const json = await safeJsonParse(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Prediction failed');
      }

      const { picks, confidence } = json;
      console.log('[FLDBG] Predictions:', { picks, confidence });

      alert(
        `⭐ Predictions:\n\n` +
        `🏆 Win: ${picks.win}\n` +
        `🥈 Place: ${picks.place}\n` +
        `🥉 Show: ${picks.show}\n\n` +
        `🔎 Confidence: ${(confidence*100).toFixed(1)}%`
      );

      if (status) status.textContent = 'Prediction complete.';
      setState('idle');
    } catch (err) {
      console.error('[FLDBG] Predict error:', err);
      if (status) status.textContent = `Predict failed: ${err.message}`;
      alert(`Predict failed: ${err.message}`);
      setState('idle');
    }
  });

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

  // Initialize FSM on load
  setState('idle');
  window.addEventListener('DOMContentLoaded', updateChip);
  updateChip();
})();