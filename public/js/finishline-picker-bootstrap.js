/* === State + UI Helpers === */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const byText = (el, txt) => el && el.textContent?.trim() === txt;

const FL_STATE = window.FL_STATE || (window.FL_STATE = {
  files: [],
  meta: null,
  analysis: null, // {scores:[{name,score,reason}], notes, version}
});

const state = { phase: 'idle', lastAnalysis: null };
let pickedFiles = [];
let analysisReady = false; // gate for Predict
let lastAnalyzedHorses = []; // for predict payload
let LAST_ANALYSIS = null; // Store full analysis response for predict

// ===== CONFIG =====
const MAX_HORSES = 24;
const rowsContainer = document.getElementById('horse-rows');
const addRowBtn = document.getElementById('add-row-btn');
const chooseBtn = document.getElementById('choose-btn');
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-selected-label');
const analyzeBtn = document.getElementById('analyze-btn');
const predictBtn = document.getElementById('predict-btn');
// Accuracy is always deep now
const FORCED_ACCURACY = 'deep';

function setChip(id, text, tone='idle') {
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

function toast(msg) {
  // Non-blocking toast
  console.log('[Toast]', msg);
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:12px 16px;border-radius:8px;z-index:10000;max-width:300px;box-shadow:0 4px 12px rgba(0,0,0,.3);';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ===== UTILITIES =====
function createEl(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

function createHorseRow(prefill = {}) {
  const row = createEl('div', 'horse-row');
  const name = createEl('input', 'input'); 
  name.placeholder = 'Horse Name';
  const odds = createEl('input', 'input'); 
  odds.placeholder = 'ML Odds (e.g. 5/2)';
  const jockey = createEl('input', 'input'); 
  jockey.placeholder = 'Jockey';
  const trainer = createEl('input', 'input'); 
  trainer.placeholder = 'Trainer';

  if (prefill.name) name.value = prefill.name;
  if (prefill.odds || prefill.ml_odds) odds.value = prefill.odds || prefill.ml_odds;
  if (prefill.jockey) jockey.value = prefill.jockey;
  if (prefill.trainer) trainer.value = prefill.trainer;

  name.dataset.role = 'horse-name';
  odds.dataset.role = 'horse-odds';
  jockey.dataset.role = 'horse-jockey';
  trainer.dataset.role = 'horse-trainer';

  row.append(name, odds, jockey, trainer);
  if (rowsContainer) rowsContainer.appendChild(row);
  return row;
}

function getAllHorseRows() {
  if (!rowsContainer) return [];
  return Array.from(rowsContainer.querySelectorAll('.horse-row'));
}

function collectHorseData() {
  const rows = getAllHorseRows();
  return rows.map(row => {
    const name = row.querySelector('[data-role="horse-name"]')?.value.trim() || '';
    const odds = row.querySelector('[data-role="horse-odds"]')?.value.trim() || '';
    const jockey = row.querySelector('[data-role="horse-jockey"]')?.value.trim() || '';
    const trainer = row.querySelector('[data-role="horse-trainer"]')?.value.trim() || '';
    return { name, odds, jockey, trainer };
  }).filter(h => h.name);
}

function ensureRowCapacity(minRows) {
  const current = getAllHorseRows().length;
  for (let i = current; i < Math.min(minRows, MAX_HORSES); i++) {
    createHorseRow();
  }
}

function populateHorseRowsFromOCR(horses=[]) {
  if (!Array.isArray(horses)) return;
  ensureRowCapacity(horses.length);
  const rows = getAllHorseRows();
  horses.forEach((h, i) => {
    const r = rows[i];
    if (!r) return;
    const nameEl = r.querySelector('[data-role="horse-name"]');
    const oddsEl = r.querySelector('[data-role="horse-odds"]');
    const jockeyEl = r.querySelector('[data-role="horse-jockey"]');
    const trainerEl = r.querySelector('[data-role="horse-trainer"]');
    if (nameEl) nameEl.value = h.name || '';
    if (oddsEl) oddsEl.value = h.ml_odds || h.odds || '';
    if (jockeyEl) jockeyEl.value = h.jockey || '';
    if (trainerEl) trainerEl.value = h.trainer || '';
  });
}

// Legacy compatibility function
function collectHorseRows() {
  return collectHorseData();
}

function getTypedHorsesFromForm() {
  return collectHorseData();
}

function collectMetaFromForm() {
  return {
    track: $('#race-track')?.value?.trim() || $('#track')?.value?.trim() || '',
    distance: $('#race-distance')?.value?.trim() || $('#distance')?.value?.trim() || '',
    surface: $('#race-surface')?.value?.trim() || $('#surface')?.value?.trim() || ''
  };
}

// ===== ROW MANAGEMENT =====
function addOneRow() {
  if (getAllHorseRows().length >= MAX_HORSES) {
    toast(`Maximum ${MAX_HORSES} horses allowed`);
    return;
  }
  createHorseRow();
}

if (addRowBtn) {
  addRowBtn.addEventListener('click', addOneRow);
}

// ===== FILE PICKER =====
if (chooseBtn) {
  chooseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (fileInput) fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    pickedFiles = Array.from(fileInput.files || []);
    if (!pickedFiles.length) {
      if (fileLabel) fileLabel.textContent = 'No file selected.';
      setChip('choose', 'Idle', 'idle');
      setChip('analyze', 'Idle', 'idle');
      enable(analyzeBtn, false);
      return;
    }
    const n = pickedFiles.length;
    if (fileLabel) fileLabel.textContent = `Loaded ${n} file${n>1?'s':''}`;
    setChip('choose', `Loaded ${n}`, 'done');
    setChip('analyze', 'Ready', 'ready');
    enable(analyzeBtn, true);
  });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    fr.onload = () => resolve(String(fr.result).split('base64,')[1] || '');
    fr.readAsDataURL(file);
  });
}

// ===== API =====
async function safeJSON(res){
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { error: txt.slice(0,200) }; }
}

async function postJsonSafe(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const j = await safeJSON(res);

  if (!res.ok || j?.ok === false) {
    const msg = j?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return j; // { ok:true, ... }
}

// ===== ANALYZE =====
async function onAnalyzeClick() {
  const analyzeChip = document.querySelector('[data-chip="analyze"]');
  try {
    setChip('analyze', 'Working...', 'working');
    enable(analyzeBtn, false);
    enable(predictBtn, false);
    analysisReady = false;

    let horses = collectHorseData();

    // If files are loaded, run OCR first to populate rows
    if (pickedFiles.length) {
      const b64s = await Promise.all(pickedFiles.map(readAsBase64));
      const filesPayload = pickedFiles.map((f, i) => ({ 
        name: f.name, 
        type: f.type, 
        b64: b64s[i] 
      }));

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
        populateHorseRowsFromOCR(parsed);
        horses = collectHorseData();
      }

      if (parsed.length < 2) {
        console.warn('[OCR] Only', parsed.length, 'horse(s) parsed.');
        toast(`Only ${parsed.length} horse(s) extracted. You can edit the rows manually.`);
      }

      // Allow picking the same file again
      if (fileInput) fileInput.value = '';
      pickedFiles = [];
    }

    if (!horses.length) {
      throw new Error('No horses to analyze');
    }

    const meta2 = collectMetaFromForm();
    FL_STATE.meta = meta2;

    const accuracy = FORCED_ACCURACY;
    const r = await fetch('/api/analyze', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body: JSON.stringify({ horses, meta: meta2, accuracy }) 
    });

    const j = await safeJSON(r);
    if(!r.ok || j.error){
      throw new Error(j.error || 'Unknown error');
    }

    LAST_ANALYSIS = j;
    FL_STATE.analysis = { scores: j.scores || [], picks: j.picks, confidence: j.meta?.confidence || j.confidence };
    
    // Cache and gate predict
    lastAnalyzedHorses = horses;
    state.lastAnalysis = { analysis: FL_STATE.analysis };
    analysisReady = true;

    setChip('analyze', 'Done', 'done');
    enable(predictBtn, true);
    setChip('predict', 'Ready', 'ready');

  } catch (err) {
    console.error('[Analyze] error', err);
    alert(`Analyze failed: ${err?.message || err}`);
    setChip('analyze', 'Error', 'error');
    enable(predictBtn, false);
  } finally {
    enable(analyzeBtn, true);
  }
}

if (analyzeBtn) {
  analyzeBtn.addEventListener('click', onAnalyzeClick);
}

// ===== PREDICT =====
async function onPredictClick() {
  const predictChip = document.querySelector('[data-chip="predict"]');
  
  try {
    if (!LAST_ANALYSIS || !LAST_ANALYSIS.picks) {
      alert("Please Analyze first.");
      return;
    }

    setChip('predict', 'Working...', 'working');
    enable(predictBtn, false);

    const r = await fetch('/api/predict_wps', {
      method:'POST', 
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ lastAnalysis: LAST_ANALYSIS })
    });

    const j = await safeJSON(r);
    if(!r.ok || j.error){
      throw new Error(j.error || 'Unknown error');
    }

    const picks = j.picks || {};
    const win = picks.win || '—';
    const place = picks.place || '—';
    const show = picks.show || '—';
    const conf = Number(j.confidence || 0) / 100; // API returns 0-100, convert to 0-1 for color coding
    const confidence = (conf * 100).toFixed(1) + "%";
    
    // Confidence color coding
    let confColor = '#bbb';
    if (conf >= 0.75) confColor = '#16a34a'; // green
    else if (conf >= 0.50) confColor = '#eab308'; // yellow
    else confColor = '#f97316'; // orange

    const msg = [
      '⭐ Predictions:',
      `🏆 Win: ${win}`,
      `🥈 Place: ${place}`,
      `🥉 Show: ${show}`,
      `✨ Confidence: ${confidence}`
    ].join('\n');

    alert(msg);
    setChip('predict', 'Done', 'done');
  } catch (err) {
    console.error('[Predict] error', err);
    alert(`Predict failed: ${err?.message || err}`);
    setChip('predict', 'Error', 'error');
  } finally {
    enable(predictBtn, true);
  }
}

if (predictBtn) {
  predictBtn.addEventListener('click', onPredictClick);
}

/* Initialize */
if (rowsContainer && getAllHorseRows().length === 0) {
  // Add one initial row
  createHorseRow();
}
