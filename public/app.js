// ---- CONFIG ----
const API_BASE = '/api';
const OCR_ENDPOINT = `${API_BASE}/photo_extract_openai_b64`;
const ANALYZE_ENDPOINT = `${API_BASE}/research_predict`;
const PREDICT_ENDPOINT = `${API_BASE}/predict_wps`;

// Elements
const fileInput   = document.querySelector('#photosInput');            // hidden <input type="file" multiple>
const chooseBtn   = document.querySelector('#choosePhotosBtn');        // "Choose Photos / PDF"
const analyzeBtn  = document.querySelector('#analyzeBtn');
const predictBtn  = document.querySelector('#predictBtn');
const ocrBadge    = document.querySelector('#ocrStateBadge');

// Horse list containers (canonical, already working)
const horseList = document.querySelector('#horseList');                // <ul> / container
const addHorseBtn = document.querySelector('#addHorseBtn');

// ---- Helpers ----
const showBadge = (text, cls) => {
  if (!ocrBadge) return;
  ocrBadge.textContent = text;
  ocrBadge.className = `badge ${cls||''}`;
};

const setRunBtn = (btn, runningText, isRunning) => {
  if (!btn) return;
  btn.disabled = !!isRunning;
  btn.dataset.originalText ??= btn.textContent;
  btn.textContent = isRunning ? runningText : btn.dataset.originalText;
};

const postJSON = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.message || data.detail)) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
};

// ---- Upload & OCR ----
chooseBtn?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  try {
    showBadge('Extracting...', 'badge-working');
    const fd = new FormData();
    for (const f of files) fd.append('files', f); // tolerant: backend also accepts `photos`
    const res = await fetch(OCR_ENDPOINT, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok || data?.ok === false) {
      const msg = data?.error?.message || data?.message || 'OCR failed';
      throw new Error(msg);
    }
    // Expect data.extracted.horses = [{name, odds, jockey, trainer}, ...]
    const horses = data?.data?.extracted?.horses || data?.extracted?.horses || [];
    if (!horses.length) throw new Error('No horses found in OCR.');

    // Populate canonical form rows (existing working routine)
    // This function already adds rows + fills fields; keep as-is:
    populateHorseRows(horses);

    showBadge(`OCR parsed and populated ${horses.length} horses.`, 'badge-ok');
  } catch (err) {
    console.error(err);
    showBadge(`OCR error: ${err.message}`, 'badge-bad');
  } finally {
    fileInput.value = '';
  }
});

// ---- Analyze with AI ----
analyzeBtn?.addEventListener('click', async () => {
  try {
    setRunBtn(analyzeBtn, 'Analyzing 0%', true);
    const payload = collectPayload(); // { race, horses }
    // Simple progress ticker
    let p = 0; const t = setInterval(() => { p=Math.min(99,p+7); setRunBtn(analyzeBtn, `Analyzing ${p}%`, true); }, 350);
    const data = await postJSON(ANALYZE_ENDPOINT, payload);
    clearInterval(t);
    setRunBtn(analyzeBtn, `Analyzing 100%`, true);
    showBadge('Ready to predict', 'badge-ok');
  } catch (err) {
    alert(`Analyze error: ${err.message}`);
  } finally {
    setRunBtn(analyzeBtn, '', false);
  }
});

// ---- Predict W/P/S ----
predictBtn?.addEventListener('click', async () => {
  try {
    setRunBtn(predictBtn, 'Predicting 0%', true);
    const payload = collectPayload();
    let p = 0; const t = setInterval(() => { p=Math.min(99,p+9); setRunBtn(predictBtn, `Predicting ${p}%`, true); }, 300);
    const data = await postJSON(PREDICT_ENDPOINT, payload);
    clearInterval(t);
    setRunBtn(predictBtn, `Predicting 100%`, true);
    renderPredictions(data?.data || data);
  } catch (err) {
    alert(`Predict error: ${err.message}`);
  } finally {
    setRunBtn(predictBtn, '', false);
  }
});

// ---- Payload collector (existing inputs) ----
function collectPayload() {
  const race = {
    date: (document.querySelector('#raceDate')?.value || '').trim(),
    track: (document.querySelector('#raceTrack')?.value || '').trim(),
    surface: (document.querySelector('#raceSurface')?.value || '').trim(),
    distance: (document.querySelector('#raceDistance')?.value || '').trim(),
  };
  const horses = readHorseRows(); // [{name, odds, jockey, trainer}, ...]
  return { race, horses };
}

// ---- Existing helper functions (keep as-is) ----
function populateHorseRows(horses) {
  // Your existing implementation that adds rows to the form
  // This should already be working
}

function readHorseRows() {
  // Your existing implementation that reads horses from the form
  // This should already be working
}

function renderPredictions(data) {
  // Your existing implementation that renders prediction results
  // This should already be working
}