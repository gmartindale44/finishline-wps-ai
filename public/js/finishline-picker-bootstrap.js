/* === State + UI Helpers === */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const byText = (el, txt) => el && el.textContent?.trim() === txt;

const state = { phase: 'idle', lastAnalysis: null };

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

chooseBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  fileInput?.click();
});

fileInput?.addEventListener('change', () => {
  const files = Array.from(fileInput?.files ?? []);
  if (!files.length) {
    setChip('choose', 'Idle', 'idle');
    return;
  }
  setChip('choose', `Loaded ${files.length}`, 'done');
  
  // Flip Analyze to Ready and enable the button, do NOT auto-analyze here.
  const analyzeBtnEl = document.getElementById('analyze-btn');
  if (analyzeBtnEl) {
    analyzeBtnEl.removeAttribute('disabled');
    analyzeBtnEl.classList.remove('is-disabled');
  }
  setChip('analyze', 'Ready', 'ready');
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

async function onAnalyze() {
  try {
    if (state.phase !== 'idle' && state.phase !== 'ready') return;
    setPhase('analyzing');

    const horses = collectHorseRows();
    const meta = {
      track: $('#race-track')?.value?.trim() || $('#track')?.value?.trim() || '',
      distance: $('#race-distance')?.value?.trim() || $('#distance')?.value?.trim() || '',
      surface: $('#race-surface')?.value?.trim() || $('#surface')?.value?.trim() || ''
    };

    if (!horses.length) {
      throw new Error('No horses found in the form.');
    }

    const json = await postJSON('/api/analyze', { horses, meta });
    state.lastAnalysis = json.analysis;

    setPhase('ready');
  } catch (e) {
    setPhase('idle');
    alert(`Analyze failed: ${e.message}`);
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
