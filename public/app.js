// ===== Configuration
const API_BASE = window.__API_BASE__ || import.meta?.env?.VITE_API_BASE || process.env.NEXT_PUBLIC_API_BASE || '';

const ROUTES = {
  ocr: `${API_BASE}/api/photo_extract_openai_b64`,
  analyze: `${API_BASE}/api/research_predict`,
  predict: `${API_BASE}/api/predict_wps`,
};

// ===== Element lookups
const $ = (sel) => document.querySelector(sel);
const choosePhotosBtn= $('#choosePhotosBtn');
const horseList      = $('#horseList');
const addHorseBtn    = $('#addHorseBtn');
const horseNameInput = $('#horseNameInput');
const mlOddsInput    = $('#mlOddsInput');
const jockeyInput    = $('#jockeyInput');
const trainerInput   = $('#trainerInput');
const analyzeBtn     = $('#analyzeBtn');
const predictBtn     = $('#predictBtn');
const ocrBadge       = $('#ocrStateBadge');

const required = [
  choosePhotosBtn, horseList, addHorseBtn,
  analyzeBtn, predictBtn, ocrBadge
];
if (required.some(el => !el)) {
  console.error('Missing required DOM elements', { required });
  alert('UI failed to load: missing form elements. Please refresh.');
}

// ===== Local state
let horses = []; // {name, odds, jockey, trainer}

// ===== Utilities
const setBadge = (txt, cls) => {
  if (!ocrBadge) return;
  ocrBadge.textContent = txt;
  ocrBadge.className = 'badge ' + (cls || '');
};

const toast = (msg) => {
  alert(msg); // Simple alert for now, can be replaced with toast library
};

function setButtonProgress(which, pct) {
  const btn = document.querySelector(which === 'analyze' ? '#analyzeBtn' : '#predictBtn');
  if (!btn) return;
  if (pct === 0) btn.dataset.busy = '1';
  btn.textContent = `${which === 'analyze' ? 'Analyzing' : 'Predicting'}… ${pct}%`;
  if (pct >= 100) {
    delete btn.dataset.busy;
    btn.textContent = which === 'analyze' ? 'Analyze Photos with AI' : 'Predict W/P/S';
  }
}

function clearHorseRows() {
  horses = [];
  renderHorses();
}

function renderHorses() {
  if (!horseList) return;
  horseList.innerHTML = '';
  horses.forEach((h, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="pill">${i+1}</span>
      <span>${h.name || ''}</span>
      <span>${h.odds || ''}</span>
      <span>${h.jockey || ''}</span>
      <span>${h.trainer || ''}</span>
      <button class="button remove-btn" data-index="${i}">Remove</button>
    `;
    horseList.appendChild(li);
  });
}

function addHorseRow(init) {
  const horse = {
    name:   init?.name?.trim()   || horseNameInput?.value?.trim() || '',
    odds:   init?.mlOdds?.trim() || init?.odds?.trim() || mlOddsInput?.value?.trim() || '',
    jockey: init?.jockey?.trim() || jockeyInput?.value?.trim() || '',
    trainer:init?.trainer?.trim()|| trainerInput?.value?.trim() || '',
  };
  
  if (!horse.name) return false; // Require at least name
  
  horses.push(horse);
  
  // Clear form inputs
  if (horseNameInput) horseNameInput.value = '';
  if (mlOddsInput)    mlOddsInput.value = '';
  if (jockeyInput)    jockeyInput.value = '';
  if (trainerInput)   trainerInput.value = '';
  
  renderHorses();
  return true;
}

horseList?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-index]');
  if (!btn) return;
  const idx = +btn.dataset.index;
  horses.splice(idx, 1);
  renderHorses();
});

addHorseBtn?.addEventListener('click', () => addHorseRow());

// ===== File Upload → Auto-extract → Populate horses
async function handleFilesSelected(files) {
  if (!files || files.length === 0) return;

  setBadge('Extracting...', 'badge-working');
  try {
    const form = new FormData();
    [...files].forEach(f => form.append('files', f));

    const res = await fetch(ROUTES.ocr, {
      method: 'POST',
      body: form,
    });

    // Even if status is 200, you've seen "OCR error". Always parse and inspect:
    const payload = await res.json();
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || payload?.message || 'OCR failed');
    }

    const horses = payload?.data?.extracted?.horses || payload?.extracted?.horses || [];
    if (!Array.isArray(horses) || horses.length === 0) {
      throw new Error('No horses found in the image(s)');
    }

    // Replace the list in the UI
    clearHorseRows();
    horses.forEach(h => addHorseRow(h));  // This calls the same builder as "Add Horse" button

    setBadge(`Ready to analyze`, 'badge-ok');
  } catch (err) {
    console.error('OCR error:', err);
    setBadge('OCR error', 'badge-bad');
    toast(`OCR failed: ${err.message ?? err}`);
  }
}

// --- one-time "self-healing" wiring for the file picker ---
function ensureFilePicker(onFiles) {
  let input = document.getElementById('fl-file-input');

  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'fl-file-input';
    input.multiple = true;                       // up to 6 images / PDFs
    input.accept = '.png,.jpg,.jpeg,.webp,.pdf'; // align with your UI text
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';
    document.body.appendChild(input);
  }

  // always (re)bind change handler
  input.onchange = () => {
    if (input?.files && input.files.length) onFiles(input.files);
    // reset so selecting the same file again still fires
    if (input) input.value = '';
  };

  // wire the visible button
  const btn = document.querySelector('#choosePhotosBtn, button.choose-photos, [data-role="choose-photos"]');
  if (btn) {
    btn.type = 'button';
    btn.onclick = () => input.click();
    btn.disabled = false;
  }
}

// Drag and drop functionality
function wireDropzone(el) {
  ['dragenter','dragover'].forEach(evt =>
    el.addEventListener(evt, e => { e.preventDefault(); el.classList.add('dropping'); })
  );
  ['dragleave','drop'].forEach(evt =>
    el.addEventListener(evt, e => { e.preventDefault(); el.classList.remove('dropping'); })
  );
  el.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (dt?.files?.length) handleFilesSelected(dt.files);
  });
}

// Initialize file picker and drag & drop
ensureFilePicker((files) => handleFilesSelected(files));

// Wire drag and drop zone
const dz = document.querySelector('#mainPanel, .panel');
if (dz) wireDropzone(dz);

// ===== Analyze & Predict
async function callJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // This will show the exact "detail" you saw in the alert
    throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
  }
  return data;
}

function collectForm() {
  return {
    race: {
      date:    document.querySelector('#raceDate')?.value?.trim() || '',
      track:   document.querySelector('#raceTrack')?.value?.trim() || '',
      surface: document.querySelector('#raceSurface')?.value || 'Dirt',
      distance:document.querySelector('#raceDistance')?.value?.trim() || ''
    },
    horses
  };
}

async function analyzeWithAI() {
  if (!horses.length) return toast('Add horses first.');
  try {
    setBadge('Analyzing...', 'badge-working');
    setButtonProgress('analyze', 0);
    const payload = collectForm();
    const res = await callJSON(ROUTES.analyze, payload);
    setButtonProgress('analyze', 100);
    setBadge('Ready to predict', 'badge-ok');
    console.log('analyze result:', res);
  } catch (e) {
    toast(`Analyze error: ${e.message}`);
    setBadge('Idle');
  }
}

async function predictWPS() {
  if (!horses.length) return toast('Add horses first.');
  try {
    setBadge('Predicting...', 'badge-working');
    setButtonProgress('predict', 0);
    const payload = collectForm();
    const res = await callJSON(ROUTES.predict, payload);
    setButtonProgress('predict', 100);
    setBadge('Done', 'badge-ok');
    console.log('predict result:', res);
    // TODO: showPredictions(res); // render W/P/S results
  } catch (e) {
    toast(`Predict error: ${e.message}`);
    setBadge('Idle');
  }
}

analyzeBtn?.addEventListener('click', analyzeWithAI);
predictBtn?.addEventListener('click', predictWPS);