/* === State + UI Helpers === */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const byText = (el, txt) => el && el.textContent?.trim() === txt;

const state = { phase: 'idle', lastAnalysis: null };
let pickedFiles = [];
let analysisReady = false; // gate for Predict
let lastAnalyzedHorses = []; // for predict payload

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

function toast(msg) {
  // Non-blocking toast (simple console for now; can enhance later)
  console.log('[Toast]', msg);
  // Optionally show a small notification
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:12px 16px;border-radius:8px;z-index:10000;max-width:300px;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function getTypedHorsesFromForm() {
  const rows = Array.from(document.querySelectorAll('[data-horse-row]'));
  return rows.map(r => {
    const nameEl = $('input[placeholder*="Horse"][placeholder*="Name"], input[name="horseName"], input[data-field="name"], .horse-name', r);
    const oddsEl = $('input[placeholder*="Odds"], input[name="mlOdds"], input[data-field="odds"], .ml-odds', r);
    const jockeyEl = $('input[placeholder*="Jockey"], input[name="jockey"], input[data-field="jockey"], .jockey', r);
    const trainerEl = $('input[placeholder*="Trainer"], input[name="trainer"], input[data-field="trainer"], .trainer', r);
    return {
      name: nameEl?.value?.trim() || '',
      odds: oddsEl?.value?.trim() || undefined,
      jockey: jockeyEl?.value?.trim() || undefined,
      trainer: trainerEl?.value?.trim() || undefined,
    };
  }).filter(h => h.name);
}

function clearHorseRows() {
  // Keep first template row; clear dynamically added rows
  const rows = Array.from(document.querySelectorAll('[data-horse-row]'));
  const host = $('#horse-rows');
  if (!host) return;
  // Remove all but keep template if it exists
  rows.forEach((row, i) => {
    if (i > 0 || row.closest('#horse-rows')) {
      row.remove();
    }
  });
}

function addHorseRow(h) {
  const host = $('#horse-rows');
  if (!host) return;
  
  // Find template row or create from existing structure
  const templateRow = $('[data-horse-row]');
  if (!templateRow) return;
  
  const row = templateRow.cloneNode(true);
  row.setAttribute('data-horse-row', '');
  
  const nameEl = $('input[placeholder*="Horse"][placeholder*="Name"], input[name="horseName"], input[data-field="name"], .horse-name', row);
  const oddsEl = $('input[placeholder*="Odds"], input[name="mlOdds"], input[data-field="odds"], .ml-odds', row);
  const jockeyEl = $('input[placeholder*="Jockey"], input[name="jockey"], input[data-field="jockey"], .jockey', row);
  const trainerEl = $('input[placeholder*="Trainer"], input[name="trainer"], input[data-field="trainer"], .trainer', row);
  
  if (nameEl) nameEl.value = h.name || '';
  if (oddsEl) oddsEl.value = h.ml_odds || h.odds || '';
  if (jockeyEl) jockeyEl.value = h.jockey || '';
  if (trainerEl) trainerEl.value = h.trainer || '';
  
  host.appendChild(row);
}

function populateHorseRows(horses) {
  clearHorseRows();
  (horses || []).forEach(addHorseRow);
}

function collectMetaFromForm() {
  return {
    track: $('#race-track')?.value?.trim() || $('#track')?.value?.trim() || '',
    distance: $('#race-distance')?.value?.trim() || $('#distance')?.value?.trim() || '',
    surface: $('#race-surface')?.value?.trim() || $('#surface')?.value?.trim() || ''
  };
}

async function onAnalyze() {
  const analyzeBtn = document.getElementById('analyze-btn');
  const predictBtn = document.getElementById('predict-btn');
  
  try {
    setChip('analyze', 'Analyzing…', 'working');
    enable(analyzeBtn, false);
    enable(predictBtn, false);
    analysisReady = false;
    
    let horses = [];

    if (pickedFiles.length) {
      // Build payload
      const filesPayload = [];
      for (const f of pickedFiles) {
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onerror = () => rej(new Error(`Read fail ${f.name}`));
          fr.onload = () => res(String(fr.result).split('base64,')[1] || '');
          fr.readAsDataURL(f);
        });
        filesPayload.push({ name: f.name, type: f.type, b64 });
      }

      const meta = collectMetaFromForm();
      const ocr = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesPayload, meta })
      });

      if (!ocr.ok) {
        const text = await ocr.text();
        throw new Error(`OCR ${ocr.status}: ${text || 'failed'}`);
      }

      const { horses: parsed = [] } = await ocr.json();

      if (parsed.length >= 1) {
        populateHorseRows(parsed);
      }

      if (parsed.length < 2) {
        console.warn('[OCR] Only', parsed.length, 'horse(s) parsed.');
        toast(`Only ${parsed.length} horse(s) extracted. You can edit the rows manually.`);
      }

      // Allow picking the same file again
      if (fileInput) fileInput.value = '';
      pickedFiles = [];
    }

    // Now score whatever is in the form
    horses = getTypedHorsesFromForm();
    if (!horses.length) {
      throw new Error('No horses to analyze');
    }

    const meta2 = collectMetaFromForm();
    const analysis = await postJSON('/api/analyze', { horses, meta: meta2 });

    // Cache and gate predict
    lastAnalyzedHorses = horses;
    state.lastAnalysis = analysis.analysis;
    analysisReady = true;

    setChip('analyze', 'Done', 'done');
    enable(predictBtn, true);
    setChip('predict', 'Ready', 'ready');

  } catch (err) {
    console.error('[Analyze] error', err);
    alert(`Analyze failed: ${err?.message || err}`);
    setChip('analyze', 'Error', 'error');
  } finally {
    enable(analyzeBtn, true);
  }
}

async function onPredict() {
  try {
    if (!analysisReady) {
      return alert('Please Analyze first.');
    }

    setChip('predict', 'Working…', 'working');

    const horses = lastAnalyzedHorses.length > 0 ? lastAnalyzedHorses : getTypedHorsesFromForm();
    const meta = state.lastAnalysis?.meta || collectMetaFromForm();

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
    setChip('predict', 'Done', 'done');
  } catch (e) {
    setChip('predict', 'Error', 'error');
    alert(`Predict failed: ${e?.message || e}`);
  }
}

if (analyzeBtn) analyzeBtn.addEventListener('click', onAnalyze);
if (predictBtn) predictBtn.addEventListener('click', onPredict);

/* Initialize */
setPhase('idle');
