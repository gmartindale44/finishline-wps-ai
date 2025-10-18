// ===== Element lookups
const $ = (sel) => document.querySelector(sel);
const photosInput    = $('#photosInput');
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
  photosInput, choosePhotosBtn, horseList, addHorseBtn,
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

function addHorse(h) {
  horses.push({
    name:   h?.name?.trim()   || horseNameInput?.value?.trim() || '',
    odds:   h?.odds?.trim()   || mlOddsInput?.value?.trim()    || '',
    jockey: h?.jockey?.trim() || jockeyInput?.value?.trim()    || '',
    trainer:h?.trainer?.trim()|| trainerInput?.value?.trim()   || '',
  });
  if (horseNameInput) horseNameInput.value = '';
  if (mlOddsInput)    mlOddsInput.value = '';
  if (jockeyInput)    jockeyInput.value = '';
  if (trainerInput)   trainerInput.value = '';
  renderHorses();
}

horseList?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-index]');
  if (!btn) return;
  const idx = +btn.dataset.index;
  horses.splice(idx, 1);
  renderHorses();
});

addHorseBtn?.addEventListener('click', () => addHorse());

// ===== Upload → Auto-extract → Populate horses
choosePhotosBtn?.addEventListener('click', () => photosInput?.click());

photosInput?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  try {
    setBadge('Extracting…', 'badge-working');
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    const res = await fetch('/api/photo_extract_openai_b64', {
      method: 'POST',
      body: fd
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'extract failed');
    const list = data?.data?.extracted || [];
    // Normalize and append
    list.forEach(row => addHorse({
      name: row?.name || row?.horse || '',
      odds: row?.odds || row?.ml_odds || '',
      jockey: row?.jockey || '',
      trainer: row?.trainer || ''
    }));
    setBadge(`OCR parsed and populated ${list.length} horses.`, 'badge-ok');
  } catch (err) {
    console.error(err);
    setBadge('OCR error', 'badge-bad');
    alert('OCR failed. See console for details.');
  } finally {
    // reset file input so same file can be re-selected
    if (photosInput) photosInput.value = '';
  }
});

// ===== Analyze & Predict
async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `${url} failed`);
  return data;
}

analyzeBtn?.addEventListener('click', async () => {
  if (!horses.length) return alert('Add horses first.');
  try {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
    setBadge('Analyzing…', 'badge-working');
    const payload = { race: collectRace(), horses };
    const data = await postJSON('/api/research_predict', payload);
    console.log('analyze', data);
    setBadge('Ready to predict', 'badge-ok');
  } catch (e) {
    console.error(e);
    alert(`Analyze error: ${e.message}`);
    setBadge('Analyze error', 'badge-bad');
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze Photos with AI';
  }
});

predictBtn?.addEventListener('click', async () => {
  if (!horses.length) return alert('Add horses first.');
  try {
    predictBtn.disabled = true;
    predictBtn.textContent = 'Predicting…';
    setBadge('Predicting…', 'badge-working');
    const payload = { race: collectRace(), horses };
    const data = await postJSON('/api/predict_wps', payload);
    console.log('predict', data);
    setBadge('Prediction complete', 'badge-ok');
    // TODO: render predictions UI if needed
  } catch (e) {
    console.error(e);
    alert(`Predict error: ${e.message}`);
    setBadge('Predict error', 'badge-bad');
  } finally {
    predictBtn.disabled = false;
    predictBtn.textContent = 'Predict W/P/S';
  }
});

function collectRace() {
  return {
    date:    document.querySelector('#raceDate')?.value?.trim() || '',
    track:   document.querySelector('#raceTrack')?.value?.trim() || '',
    surface: document.querySelector('#raceSurface')?.value || 'Dirt',
    distance:document.querySelector('#raceDistance')?.value?.trim() || ''
  };
}