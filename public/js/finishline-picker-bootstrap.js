/* === State + UI Helpers === */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const byText = (el, txt) => el && el.textContent?.trim() === txt;

const state = { phase: 'idle', lastAnalysis: null };
let pickedFiles = [];

function setChip(id, text, tone='idle') {
  // id is the small <span class="chip" data-chip="analyze"> etc
  const chip = document.querySelector(`[data-chip="${id}"]`);
  if (!chip) return;
  chip.textContent = text;
  chip.className = `chip chip--${tone}`;
}

function aura(el, on=true) {
  if (!el) return;
  el.classList.toggle('aura', !!on);
}

function enable(el, yes=true) {
  if (!el) return;
  if (yes) { 
    el.removeAttribute('disabled'); 
    el.classList.remove('is-disabled'); 
  } else { 
    el.setAttribute('disabled',''); 
    el.classList.add('is-disabled'); 
  }
}

/* === Row Scraper (stable) === */
function collectHorseRows() {
  // Expect rows that visually look like columns: Name | ML Odds | Jockey | Trainer
  // We'll look for the 4 input fields inside the same row container.
  const rows = [];
  const containers = $$('.horse-row, .row, .horseDataRow'); // include your actual row classes

  containers.forEach(row => {
    const name = $('input[placeholder*="Horse"][placeholder*="Name"], input[data-field="name"]', row);
    const odds = $('input[placeholder*="Odds"], input[data-field="odds"]', row);
    const jockey = $('input[placeholder*="Jockey"], input[data-field="jockey"]', row);
    const trainer = $('input[placeholder*="Trainer"], input[data-field="trainer"]', row);

    // Also support static text cells -> read textContent if no input present
    const getVal = (el, altSel) => el?.value?.trim()
      || $(altSel, row)?.textContent?.trim()
      || '';

    const item = {
      name: getVal(name, '[data-col="horse"], .horseName'),
      odds: getVal(odds, '[data-col="odds"], .mlodds'),
      jockey: getVal(jockey, '[data-col="jockey"], .jockey'),
      trainer: getVal(trainer, '[data-col="trainer"], .trainer'),
    };

    const any = item.name || item.odds || item.jockey || item.trainer;
    if (any) rows.push(item);
  });

  // Fallback: table layout
  if (rows.length === 0) {
    const tr = $$('table tr');
    tr.forEach(r => {
      const cells = $$('td,th', r);
      if (cells.length >= 4) {
        rows.push({
          name: cells[0].querySelector('input')?.value?.trim() || cells[0].textContent.trim(),
          odds: cells[1].querySelector('input')?.value?.trim() || cells[1].textContent.trim(),
          jockey: cells[2].querySelector('input')?.value?.trim() || cells[2].textContent.trim(),
          trainer: cells[3].querySelector('input')?.value?.trim() || cells[3].textContent.trim(),
        });
      }
    });
  }

  return rows.filter(h => h.name);
}

/* === API === */
async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let json;
  try { 
    json = JSON.parse(text); 
  } catch (e) {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0,120)}`);
  }

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }

  return json;
}

/* === File Picker Wiring === */
const chooseBtn = document.getElementById('choose-btn');
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-selected-label');
const analyzeBtnEl = document.getElementById('analyze-btn');

chooseBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  fileInput?.click();
});

fileInput?.addEventListener('change', () => {
  pickedFiles = Array.from(fileInput?.files ?? []);
  if (!pickedFiles.length) {
    if (fileLabel) fileLabel.textContent = 'No file selected.';
    setChip('choose', 'Idle', 'idle');
    setChip('analyze', 'Idle', 'idle');
    enable(analyzeBtnEl, false);
    return;
  }
  const n = pickedFiles.length;
  if (fileLabel) fileLabel.textContent = `Loaded ${n} file${n>1?'s':''}`;
  setChip('choose', `Loaded ${n}`, 'done');
  setChip('analyze', 'Ready', 'ready');
  enable(analyzeBtnEl, true);
});

/* === Handlers === */
const analyzeBtn = $('#analyze-btn') || $('#btn-analyze');       // your Analyze with AI button
const predictBtn = $('#predict-btn') || $('#btn-predict');       // Predict W/P/S button
const analyzeChip = $('[data-chip="analyze"]');
const predictChip = $('[data-chip="predict"]');

function setPhase(p) {
  state.phase = p;
  if (p === 'idle') {
    setChip('analyze', 'Idle', 'idle');
    setChip('predict', 'Idle', 'idle');
    aura(analyzeBtn, false);
    aura(predictBtn, false);
    if (analyzeBtn) analyzeBtn.setAttribute('disabled', 'true');
  } else if (p === 'analyzing') {
    setChip('analyze', 'Working…', 'working');
    setChip('predict', 'Idle', 'idle');
    aura(analyzeBtn, true);
  } else if (p === 'ready') {
    setChip('analyze', 'Done', 'done');
    setChip('predict', 'Ready', 'ready');
    aura(analyzeBtn, false);
    aura(predictBtn, true);
  } else if (p === 'predicting') {
    setChip('predict', 'Working…', 'working');
  }
}

async function readAsBase64(file) {
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error(`Failed to read ${file.name}`));
    fr.onload = () => res(String(fr.result || ''));
    fr.readAsDataURL(file);
  });
}

function populateHorseRows(horses) {
  const containers = $$('.horse-row, .row, .horseDataRow, [data-horse-row]');
  const addBtn = $('#add-horse-btn');
  
  // Ensure we have enough rows
  while (containers.length < horses.length && addBtn) {
    addBtn.click();
    const newContainers = $$('.horse-row, .row, .horseDataRow, [data-horse-row]');
    if (newContainers.length === containers.length) break;
    containers.length = newContainers.length;
  }
  
  const finalContainers = $$('.horse-row, .row, .horseDataRow, [data-horse-row]');
  for (let i = 0; i < Math.min(horses.length, finalContainers.length); i++) {
    const h = horses[i] || {};
    const row = finalContainers[i];
    const nameEl = $('input[placeholder*="Horse"][placeholder*="Name"], input[name="horseName"], input[data-field="name"]', row);
    const oddsEl = $('input[placeholder*="Odds"], input[name="mlOdds"], input[data-field="odds"]', row);
    const jockeyEl = $('input[placeholder*="Jockey"], input[name="jockey"], input[data-field="jockey"]', row);
    const trainerEl = $('input[placeholder*="Trainer"], input[name="trainer"], input[data-field="trainer"]', row);
    
    if (nameEl) nameEl.value = String(h.name || '').trim();
    if (oddsEl) oddsEl.value = String(h.odds || '').trim();
    if (jockeyEl) jockeyEl.value = String(h.jockey || '').trim();
    if (trainerEl) trainerEl.value = String(h.trainer || '').trim();
  }
}

async function onAnalyze() {
  try {
    if (state.phase !== 'idle' && state.phase !== 'ready') return;
    setChip('analyze', 'Analyzing...', 'working');
    enable(analyzeBtnEl, false);
    
    let analysis;
    const meta = {
      track: $('#race-track')?.value?.trim() || $('#track')?.value?.trim() || '',
      distance: $('#race-distance')?.value?.trim() || $('#distance')?.value?.trim() || '',
      surface: $('#race-surface')?.value?.trim() || $('#surface')?.value?.trim() || ''
    };

    if (pickedFiles.length) {
      // Read files to base64
      const payloadFiles = [];
      for (const f of pickedFiles) {
        const dataUrl = await readAsBase64(f);
        const b64 = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl;
        payloadFiles.push({ name: f.name, type: f.type, b64 });
      }

      const ocrResult = await postJSON('/api/photo_extract_openai_b64', { image_b64: payloadFiles[0]?.b64, meta });
      
      // Populate horse rows from OCR result
      if (Array.isArray(ocrResult?.horses) && ocrResult.horses.length) {
        populateHorseRows(ocrResult.horses);
      }

      // Now analyze the populated horses
      const horses = collectHorseRows();
      if (!horses.length) {
        throw new Error('No horses found after OCR extraction.');
      }

      analysis = await postJSON('/api/analyze', { horses, meta });
    } else {
      // No files: fall back to analyzing typed rows
      const horses = collectHorseRows();
      if (!horses.length) {
        throw new Error('No horses found in the form.');
      }
      analysis = await postJSON('/api/analyze', { horses, meta });
    }

    state.lastAnalysis = analysis.analysis;
    setChip('analyze', 'Done', 'done');
    
    const predictBtnEl = document.getElementById('predict-btn');
    enable(predictBtnEl, true);
    setChip('predict', 'Ready', 'ready');
    
    // Allow re-selecting the same file later
    if (fileInput) fileInput.value = '';
    pickedFiles = [];

  } catch (e) {
    console.error('[Analyze] Failed:', e);
    alert(`Analyze failed: ${e?.message || e}`);
    setChip('analyze', 'Error', 'error');
    enable(analyzeBtnEl, true);
  }
}

async function onPredict() {
  try {
    if (state.phase !== 'ready') {
      return alert('Please Analyze first.');
    }

    setPhase('predicting');

    const horses = collectHorseRows(); // re-capture in case user tweaked anything
    const meta = state.lastAnalysis?.meta || {
      track: $('#race-track')?.value?.trim() || $('#track')?.value?.trim() || '',
      distance: $('#race-distance')?.value?.trim() || $('#distance')?.value?.trim() || '',
      surface: $('#race-surface')?.value?.trim() || $('#surface')?.value?.trim() || ''
    };

    const json = await postJSON('/api/predict_wps', { horses, meta });

    const { prediction } = json;
    const picks = prediction?.picks || [];
    const conf = prediction?.confidence ?? 0;

    const msg = [
      '⭐ Predictions:',
      `🏆 Win: ${picks[0]?.name || '—'}`,
      `🥈 Place: ${picks[1]?.name || '—'}`,
      `🥉 Show: ${picks[2]?.name || '—'}`,
      `✨ Confidence: ${(conf*100).toFixed(1)}%`
    ].join('\n');

    alert(msg);
    setPhase('idle');
  } catch (e) {
    setPhase('idle');
    alert(`Predict failed: ${e.message}`);
  }
}

if (analyzeBtn) analyzeBtn.addEventListener('click', onAnalyze);
if (predictBtn) predictBtn.addEventListener('click', onPredict);

/* Initialize */
setPhase('idle');
