// --- Global app state (safe across navigations) ---
window.__fl = window.__fl || {
  horses: [],           // normalized form horses
  meta: {},             // race meta (date/track/distance/surface)
  analysis: null,       // last analysis payload
  predict: null,        // last prediction payload
};

// --- Helpers ---
const $  = sel => document.querySelector(sel);
const chipPick    = $('#chip-pick');
const chipAnalyze = $('#chip-analyze');
const chipPredict = $('#chip-predict');
const btnPick     = $('#btn-pick');
const btnAnalyze  = $('#btn-analyze');
const btnPredict  = $('#btn-predict');
const debugEl     = $('#fl-debug');
const input       = $('#photo-input-main');
const pickerStatus = $('#picker-status');

function setChip(chipEl, btnEl, mode) {
  if (!chipEl || !btnEl) return;
  chipEl.classList.remove('chip-idle','chip-busy','chip-ready');
  btnEl.classList.remove('aura-busy','aura-ready');
  if (mode === 'busy') { 
    chipEl.classList.add('chip-busy'); 
    btnEl.classList.add('aura-busy'); 
    chipEl.textContent = 'Working…'; 
  }
  else if (mode === 'ready') { 
    chipEl.classList.add('chip-ready'); 
    btnEl.classList.add('aura-ready'); 
    chipEl.textContent = 'Ready'; 
  }
  else { 
    chipEl.classList.add('chip-idle'); 
    chipEl.textContent = 'Idle'; 
  }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function minDelay(promise, ms){ 
  return Promise.all([promise, sleep(ms)]).then(([x])=>x); 
}

function log(msg, obj){ 
  console.log('[FLDBG]', msg, obj||''); 
  if (debugEl) debugEl.textContent = String(msg); 
}

// Parse the current form into window.__fl
function collectForm() {
  const rows = Array.from(document.querySelectorAll('.horse-row, [data-horse-row]')); 
  const horses = rows.map(r => {
    const nameEl = r.querySelector('input[name="horseName"]') || r.querySelector('#horse-name') || r.querySelector('.horse-name');
    const oddsEl = r.querySelector('input[name="mlOdds"]') || r.querySelector('#ml-odds') || r.querySelector('.odds');
    const jockeyEl = r.querySelector('input[name="jockey"]') || r.querySelector('#jockey') || r.querySelector('.jockey');
    const trainerEl = r.querySelector('input[name="trainer"]') || r.querySelector('#trainer') || r.querySelector('.trainer');
    return {
      name: (nameEl?.value || nameEl?.textContent || '').trim(),
      odds_ml: (oddsEl?.value || oddsEl?.textContent || '').trim(),
      jockey: (jockeyEl?.value || jockeyEl?.textContent || '').trim(),
      trainer: (trainerEl?.value || trainerEl?.textContent || '').trim()
    };
  }).filter(h => h.name);

  const meta = {
    date:     $('#race-date')?.value || '',
    track:    $('#race-track')?.value || '',
    surface:  $('#race-surface')?.value || '',
    distance: $('#race-distance')?.value || ''
  };

  window.__fl.horses = horses;
  window.__fl.meta   = meta;
  return { horses, meta };
}

// Enable/disable buttons coherently
function setButtons({pick=true, analyze=false, predict=false}) {
  if (btnPick) btnPick.disabled = !pick;
  if (btnAnalyze) btnAnalyze.disabled = !analyze;
  if (btnPredict) btnPredict.disabled = !predict;
}

// Initial state
setButtons({ pick:true, analyze:false, predict:false });
if (chipPick && btnPick) setChip(chipPick, btnPick, 'idle');
if (chipAnalyze && btnAnalyze) setChip(chipAnalyze, btnAnalyze, 'idle');
if (chipPredict && btnPredict) setChip(chipPredict, btnPredict, 'idle');

// --- Choose handler (existing) should set Analyze ready once form is parsed ---
if (btnPick && input) {
  const openDialog = (e) => { 
    e?.preventDefault?.(); 
    if (input) { input.value = ''; input.click(); }
  };
  btnPick.addEventListener('click', openDialog);
  btnPick.addEventListener('keydown', e => { 
    if (e.key === 'Enter' || e.key === ' ') openDialog(e); 
  });

  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (pickerStatus) pickerStatus.textContent = `Selected: ${f.name} (${Math.round(f.size/1024)} KB). Parsing…`;
    setChip(chipPick, btnPick, 'busy');

    try {
      // File to base64
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = reject;
        r.readAsDataURL(f);
      });

      const res = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ image_b64: b64, mode: 'ocr_horse_list' })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `OCR ${res.status}`);

      if (!Array.isArray(body.horses) || body.horses.length === 0) {
        throw new Error('No horses found in the uploaded image.');
      }

      // Normalize and populate form
      const horses = body.horses.map(h => ({
        name: (h.name || '').trim(),
        odds_ml: (h.odds || '').toString().trim(),
        jockey: (h.jockey || '').trim(),
        trainer: (h.trainer || '').trim()
      })).filter(h => h.name);

      // Populate form (simplified - you may have existing populateHorseForm)
      const nameEl = $('input[name="horseName"]') || $('#horse-name');
      const oddsEl = $('input[name="mlOdds"]') || $('#ml-odds');
      const jockeyEl = $('input[name="jockey"]') || $('#jockey');
      const trainerEl = $('input[name="trainer"]') || $('#trainer');
      if (horses[0] && nameEl && oddsEl && jockeyEl && trainerEl) {
        nameEl.value = horses[0].name || '';
        oddsEl.value = horses[0].odds_ml || '';
        jockeyEl.value = horses[0].jockey || '';
        trainerEl.value = horses[0].trainer || '';
      }

      collectForm(); // Update window.__fl
      if (pickerStatus) pickerStatus.textContent = `Parsed ${horses.length} horses. Ready to Analyze.`;
      setChip(chipPick, btnPick, 'ready');
      setButtons({ pick:true, analyze: horses.length>0, predict:false });
    } catch (err) {
      console.error('[FLDBG] OCR parse failed:', err);
      if (pickerStatus) pickerStatus.textContent = `Parse failed: ${err.message}`;
      setChip(chipPick, btnPick, 'idle');
      alert('Parse failed. See console for details.');
    }
  });
}

// --- Analyze: calls /api/analyze, stores analysis, lights Predict when done ---
if (btnAnalyze) {
  btnAnalyze.addEventListener('click', async () => {
    const { horses, meta } = collectForm();

    if (!horses.length) {
      alert('Please provide horse rows before analyzing.');
      return;
    }

    setChip(chipAnalyze, btnAnalyze, 'busy');
    setButtons({ pick:true, analyze:false, predict:false });

    try {
      const t0 = Date.now();
      const ANALYZE_MIN_MS = 8000 + Math.floor(Math.random()*4000); // 8–12s minimum
      const resp = await minDelay(
        fetch('/api/analyze', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ horses, meta })
        }).then(r => r.json()), 
        ANALYZE_MIN_MS
      );

      if (resp?.error) throw new Error(resp.error);

      window.__fl.analysis = resp; // save full analysis

      log('Analysis complete; ready to predict.', {count: horses.length, confidence: resp?.confidence});
      setChip(chipAnalyze, btnAnalyze, 'ready');
      setButtons({ pick:true, analyze:true, predict:true });
      setChip(chipPredict, btnPredict, 'idle'); // prediction not run yet

      alert(`Analysis complete.\nConfidence: ${Math.round((resp?.confidence||0)*100)/100}%\nReady to Predict.`);

    } catch (err) {
      console.error(err);
      alert(`Analyze failed: ${err.message}`);
      setChip(chipAnalyze, btnAnalyze, 'idle');
      setButtons({ pick:true, analyze:true, predict:false });
    }
  });
}

// --- Predict: consumes previous analysis + current horses ---
if (btnPredict) {
  btnPredict.addEventListener('click', async () => {
    const { horses, meta } = collectForm();

    if (!window.__fl.analysis) {
      alert('Please run Analyze first.');
      return;
    }

    setChip(chipPredict, btnPredict, 'busy');
    setButtons({ pick:true, analyze:false, predict:false });

    try {
      const PREDICT_MIN_MS = 4000 + Math.floor(Math.random()*3000); // 4–7s minimum
      const resp = await minDelay(
        fetch('/api/predict_wps', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ horses, meta, analysis: window.__fl.analysis })
        }).then(r => r.json()), 
        PREDICT_MIN_MS
      );

      if (resp?.error) throw new Error(resp.error);

      window.__fl.predict = resp;

      setChip(chipPredict, btnPredict, 'ready');
      setButtons({ pick:true, analyze:true, predict:true });

      const { win, place, show, confidence=0, notes=[] } = resp;
      const pct = Math.round(confidence*100)/100;
      const winName = typeof win === 'string' ? win : (win?.name || '—');
      const placeName = typeof place === 'string' ? place : (place?.name || '—');
      const showName = typeof show === 'string' ? show : (show?.name || '—');

      alert(`⭐ Predictions:
🥇 Win: ${winName}
🥈 Place: ${placeName}
🥉 Show: ${showName}
Confidence: ${pct}%
${notes?.length ? '\nNotes:\n- ' + notes.join('\n- ') : ''}`);

    } catch (err) {
      console.error(err);
      alert(`Predict failed: ${err.message}`);
      setChip(chipPredict, btnPredict, 'idle');
      setButtons({ pick:true, analyze:true, predict:true });
    }
  });
}

// Wire Add Horse button to create new rows
const addHorseBtn = $('#add-horse-btn');
const horseRowsContainer = $('#horse-rows');
if (addHorseBtn && horseRowsContainer) {
  addHorseBtn.addEventListener('click', () => {
    const templateRow = document.querySelector('.horse-row[data-horse-row]');
    if (!templateRow) return;
    const newRow = templateRow.cloneNode(true);
    newRow.querySelectorAll('input').forEach(inp => {
      inp.value = '';
      inp.removeAttribute('id');
    });
    const btn = newRow.querySelector('#add-horse-btn');
    if (btn) btn.style.display = 'none';
    horseRowsContainer.appendChild(newRow);
  });
}