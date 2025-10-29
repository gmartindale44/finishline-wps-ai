(function initFinishLinePicker() {
  const input   = document.getElementById('photo-input-main');
  const pickBtn = document.getElementById('choose-photos-btn');
  const status  = document.getElementById('picker-status');
  const analyzeBtn = document.getElementById('analyze-btn');
  const predictBtn = document.getElementById('predict-btn');

  if (!input || !pickBtn) return;

  const state = { horses: [], features: null };
  window.__finishline = state;

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

  analyzeBtn?.addEventListener('click', async () => {
    if (!state.horses?.length) return alert('No horses to analyze.');
    analyzeBtn.setAttribute('disabled', 'true');
    if (status) status.textContent = 'Analyzing…';

    try {
      const meta = collectMeta();
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ horses: state.horses, meta })
      });
      const body = await safeJson(res);
      if (!res.ok) throw new Error(body?.error || `Analyze ${res.status}`);

      window.__lastAnalyze = body; // Store for Predict
      state.features = body.features || null;
      if (status) status.textContent = 'Analysis complete. Ready to Predict.';
      predictBtn?.removeAttribute('disabled');
    } catch (err) {
      console.error('[FLDBG] Analyze failed:', err);
      if (status) status.textContent = `Analyze failed: ${err.message}`;
      alert('Analyze failed. See console for details.');
    } finally {
      analyzeBtn.removeAttribute('disabled');
    }
  });

  predictBtn?.addEventListener('click', async () => {
    if (!window.__lastAnalyze) {
      alert('Analyze first to compute features.');
      return;
    }
    predictBtn.setAttribute('disabled', 'true');
    if (status) status.textContent = 'Predicting W/P/S…';

    try {
      const res = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(window.__lastAnalyze)
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || 'Prediction failed');

      const { picks, probs, confidence } = data;
      // Find displayed % for chosen picks
      const winP = probs.find(h => h.name === picks.win)?.winPct ?? 0;
      const plcP = probs.find(h => h.name === picks.place)?.plcPct ?? 0;
      const shwP = probs.find(h => h.name === picks.show)?.shwPct ?? 0;

      console.log('[FLDBG] Predictions:', { picks, confidence, top6: probs.slice(0, 6) });

      const head = confidence < 0.22 ? 'Predictions (low confidence)' : 'Predictions';
      alert(`⭐ ${head}:\n\n🏆 Win: ${picks.win} (${winP.toFixed(1)}%)\n🥈 Place: ${picks.place} (${plcP.toFixed(1)}%)\n🥉 Show: ${picks.show} (${shwP.toFixed(1)}%)`);

      if (status) status.textContent = 'Prediction complete.';
    } catch (err) {
      console.error('[FLDBG] Predict error:', err);
      if (status) status.textContent = `Predict failed: ${err.message}`;
      alert(`Predict failed: ${err.message}`);
    } finally {
      predictBtn.removeAttribute('disabled');
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
      // Trigger input events
      [nameEl, oddsEl, jockeyEl, trainerEl_case].forEach(el => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    if (addBtn && rest.length > 0) {
      for (const h of rest) {
        addBtn.click();
        // Wait for DOM update
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

})();