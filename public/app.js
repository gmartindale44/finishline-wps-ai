/* ============================================================
   🏇 FinishLine WPS AI — Stable File Picker + Auto Extract
   Restores full Choose → Auto Extract → Populate flow
   ============================================================ */

function setBadge(text) {
  const badge = document.getElementById('ocrStateBadge');
  if (badge) badge.textContent = text;
}

/* ============================================================
   ✅ UNIVERSAL FILE PICKER (never breaks after reload)
   ============================================================ */
function ensureFilePicker(onFiles) {
  let input = document.getElementById('fl-file-input');

  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'fl-file-input';
    input.multiple = true;
    input.accept = '.png,.jpg,.jpeg,.webp,.pdf';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';
    document.body.appendChild(input);
  }

  input.onchange = () => {
    if (input?.files?.length) onFiles(input.files);
    input.value = ''; // allow reselection of same file
  };

  const btn =
    document.querySelector('#choosePhotosBtn') ??
    document.querySelector('button.choose-photos,[data-role="choose-photos"]');

  if (btn) {
    btn.type = 'button';
    btn.disabled = false;
    btn.onclick = () => input.click();
  }
}

/* ============================================================
   🧠 AUTO EXTRACT AFTER CHOOSE - ROBUST OCR FLOW
   ============================================================ */
async function uploadAndExtract(file) {
  const fd = new FormData();
  fd.append("file", file);

  setBadge("Extracting…");

  try {
    const res = await fetch("/api/photo_extract_openai_b64", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      const msg = data?.error || `OCR failed (${res.status})`;
      console.error("OCR error:", msg);
      alert(msg);
      setBadge("OCR error");
      return;
    }

    const horses = Array.isArray(data.horses) ? data.horses : [];
    // IMPORTANT: Add rows using the existing "Add Horse" button logic / function,
    // not by printing JSON below the form.
    clearHorseRows();
    for (const h of horses) {
      addHorseRow({
        name: h.name ?? "",
        mlOdds: h.odds ?? "",
        jockey: h.jockey ?? "",
        trainer: h.trainer ?? "",
      });
    }

    setBadge(`Parsed ${horses.length} horses.`);
    setBadge("Ready to analyze");
  } catch (err) {
    console.error("Network error:", err);
    alert("Network error while extracting");
    setBadge("OCR error");
  }
}

async function handleFilesSelected(files) {
  if (!files || files.length === 0) return;
  // Use the first file for OCR
  await uploadAndExtract(files[0]);
}

/* ============================================================
   🏇 HORSE ROW BUILDER
   ============================================================ */
function clearHorseRows() {
  const list = document.getElementById('horseList');
  if (list) list.innerHTML = '';
}

function addHorseRow(init) {
  const list = document.getElementById('horseList');
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'horse-row flex items-center gap-2 mb-1';
  row.innerHTML = `
    <input class="horse-name input" placeholder="Horse" value="${init?.name || ''}" />
    <input class="horse-odds input" placeholder="ML Odds" value="${init?.mlOdds || ''}" />
    <input class="horse-jockey input" placeholder="Jockey" value="${init?.jockey || ''}" />
    <input class="horse-trainer input" placeholder="Trainer" value="${init?.trainer || ''}" />
    <button class="btn-remove">Remove</button>
  `;

  row.querySelector('.btn-remove')?.addEventListener('click', () => row.remove());
  list.appendChild(row);
}

document.getElementById('addHorseBtn')?.addEventListener('click', () => addHorseRow());

/* ============================================================
   🧩 ANALYZE + PREDICT
   ============================================================ */
async function callJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
  return data;
}

function collectForm() {
  const horses = [];
  document.querySelectorAll('.horse-row').forEach((r) => {
    const inputs = r.querySelectorAll('input');
    horses.push({
      name: inputs[0].value,
      mlOdds: inputs[1].value,
      jockey: inputs[2].value,
      trainer: inputs[3].value,
    });
  });
  
  const meta = {
    date: document.querySelector('#raceDate')?.value?.trim() || null,
    track: document.querySelector('#raceTrack')?.value?.trim() || null,
    surface: document.querySelector('#raceSurface')?.value || null,
    distance: document.querySelector('#raceDistance')?.value?.trim() || null,
  };
  
  return { entries: horses, meta };
}

// Analyze and Predict functionality
async function analyzePhotosWithAI() {
  setBadge("Analyzing…");
  
  try {
    const { entries, meta } = collectForm();
    if (!entries.length) {
      alert("No horses found on the form.");
      return;
    }

    const res = await fetch("/api/research_predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, meta }),
    });
    const data = await res.json();
    
    if (!res.ok || !data?.ok) {
      console.error("Analyze failed:", data);
      alert(`Analyze error: ${data?.error || res.statusText}`);
      setBadge("Analyze error");
      return;
    }
    
    // Store analyzed data for predict step
    window.__FL_ANALYZED__ = data.features || [];
    setBadge("Ready to predict");
    
  } catch (e) {
    console.error("Analyze error:", e);
    alert("Analyze error — see console for details.");
    setBadge("Analyze error");
  }
}

async function predictWPS() {
  setBadge("Predicting…");
  
  try {
    const { entries, meta } = collectForm();
    if (!entries.length) {
      alert("No horses found on the form.");
      return;
    }
    
    const analyzed = window.__FL_ANALYZED__;
    if (!analyzed) {
      alert("Please analyze first.");
      return;
    }

    const res = await fetch("/api/predict_wps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, meta, analyzed }),
    });
    const data = await res.json();
    
    if (!res.ok || !data?.ok) {
      console.error("Predict failed:", data);
      alert(`Predict error: ${data?.error || res.statusText}`);
      setBadge("Predict error");
      return;
    }

    setBadge("Done");
    // TODO: render predictions; keep your prior UI
    alert("Prediction complete! Check console for details.");
    
  } catch (e) {
    console.error("Predict error:", e);
    alert("Predict error — see console for details.");
    setBadge("Predict error");
  }
}

/* ============================================================
   🚀 INITIALIZE EVERYTHING
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const btnChoose  = qs('#btnChoose');
  const btnAnalyze = qs('#btnAnalyze');

  if (btnChoose)  btnChoose.addEventListener('click', () => qs('#fileInput')?.click());
  if (btnAnalyze) btnAnalyze.addEventListener('click', analyzeWithAI);
  
  // Keep existing functionality
  ensureFilePicker((files) => handleFilesSelected(files));
  setBadge('Idle');
  
  // Wire analyze and predict buttons
  const analyzeBtn = document.getElementById('analyzeBtn');
  const predictBtn = document.getElementById('predictBtn');
  
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', analyzePhotosWithAI);
    analyzeBtn.dataset.busyLabel = 'Analyzing… ⏳';
  }
  if (predictBtn) {
    predictBtn.addEventListener('click', predictWPS);
    predictBtn.dataset.busyLabel = 'Predicting… ⏳';
  }
});

async function analyzeWithAI() {
  setBadge('Analyzing…');
  try {
    const input = document.querySelector('#fileInput');
    if (!input || !input.files || !input.files[0]) {
      setBadge('Idle');
      return alert('Choose a photo or PDF first.');
    }

    const form = new FormData();
    form.append('file', input.files[0]);

    const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: form });
    const text = await res.text();
    console.group('AI Extraction Response');
    console.log('Raw text:', text);
    console.groupEnd();

    let data = {};
    try { data = JSON.parse(text); } catch (e) {
      setBadge('Idle');
      return alert('Response not JSON - check server logs.');
    }

    console.table(data?.race || {});
    console.table(data?.horses || []);

    if (!data.ok) {
      setBadge('Idle');
      return alert(`Analyze error: ${data.error || 'Unknown error'}`);
    }

    fillFormFromExtraction(data);
    setBadge('Ready to predict');
  } catch (err) {
    console.error(err);
    setBadge('Idle');
    alert(`Analyze error: ${err.message || err}`);
  }
}

function fillFormFromExtraction(payload) {
  const r = payload?.race ?? {};
  const raceFields = {
    date: document.querySelector('#raceDate'),
    track: document.querySelector('#raceTrack'),
    surface: document.querySelector('#raceSurface'),
    distance: document.querySelector('#raceDistance')
  };

  console.log('Detected form fields:', raceFields);

  Object.entries(raceFields).forEach(([k, el]) => {
    if (el) el.value = r[k] ?? '';
    else console.warn(`Missing element for race field: ${k}`);
  });

  const horses = Array.isArray(payload?.horses) ? payload.horses : [];
  const list = document.querySelector('#horseList') || document.querySelector('.horse-list') || document.querySelector('.horseData');
  if (!list) console.warn('Horse list container not found.');

  horses.forEach((h, i) => {
    const entry = `${i + 1}. ${h.name} | ${h.odds} | ${h.jockey} | ${h.trainer}`;
    console.log('Horse', entry);
    if (list) {
      const div = document.createElement('div');
      div.className = 'horse-row';
      div.textContent = entry;
      list.appendChild(div);
    }
  });
}

// Helper utilities
function qs(sel) { return document.querySelector(sel); }
function setVal(sel, v) { const el = qs(sel); if (el) el.value = v ?? ''; }
function setBadge(txt) {
  const b = document.querySelector('[data-badge]') || qs('#statusBadge');
  if (b) b.textContent = txt;
}
function clearHorseRows() {
  const wrap = qs('#horseList');
  if (wrap) wrap.innerHTML = '';
}
function pushHorseRowFallback({ name, odds, jockey, trainer }) {
  const wrap = qs('#horseList');
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'horse-row';
  div.textContent = `${name} | ${odds} | ${jockey} | ${trainer}`;
  wrap.appendChild(div);
}

/* ============================================================
   🌐 GLOBAL HELPER FOR EXTRACTED ENTRIES
   ============================================================ */
window.FL_applyExtractedEntries = (entries) => {
  const list = document.getElementById('horseList');
  if (!list) return;

  // Clear & populate UI
  list.innerHTML = '';
  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'horse-row flex items-center gap-2 mb-1';
    row.innerHTML = `
      <input class="horse-name input" placeholder="Horse" value="${e.name || ''}" />
      <input class="horse-odds input" placeholder="ML Odds" value="${e.mlOdds || ''}" />
      <input class="horse-jockey input" placeholder="Jockey" value="${e.jockey || ''}" />
      <input class="horse-trainer input" placeholder="Trainer" value="${e.trainer || ''}" />
      <button class="btn-remove">Remove</button>
    `;
    row.querySelector('.btn-remove')?.addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  const badge = document.getElementById('ocrStateBadge');
  if (badge) badge.textContent = 'Ready to analyze';
};

// ===========================
// OCR Upload & Auto-Extract
// ===========================
(function initFinishLineOCR() {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // File input (prefer explicit selectors; fallback to any file input)
  const fileInput =
    $('#photoInput') ||
    $('[data-photo-input]') ||
    ($('[data-photos-area]') && $('[data-photos-area] input[type="file"]')) ||
    $('#fl-file-input') ||
    $('input[type="file"]');

  // Status badge (use existing or create a minimal one)
  let badge = $('#ocrStatus') || $('[data-ocr-badge]') || $('#status-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'ocrStatus';
    badge.textContent = 'Idle';
    badge.style.cssText = 'margin-left:8px;padding:2px 8px;border-radius:10px;background:#3b3b5c;color:#cfc7ff;font-size:12px;';
    const host = $('h1, header, .brand, .app-title') || document.body;
    host.appendChild(badge);
  }

  // Add Horse button
  const addHorseBtn =
    $('[data-add-horse]') ||
    $('#addHorseBtn') ||
    $$('button, a').find((el) => /add\s*horse/i.test(el.textContent || ''));

  function setBadge(text, tone = 'info') {
    const theme = {
      info: ['#3b3b5c', '#cfc7ff'],
      ok: ['#1f5131', '#b7f7c5'],
      warn: ['#5a4a1a', '#ffe59c'],
      err: ['#5b1f24', '#ffb7c0'],
      busy: ['#2a3758', '#bcd2ff'],
    };
    const [bg, fg] = theme[tone] || theme.info;
    badge.textContent = text;
    badge.style.background = bg;
    badge.style.color = fg;
  }

  async function apiExtract(file) {
    const form = new FormData();
    form.append('file', file, file.name || 'upload');

    const res = await fetch('/api/photo_extract_openai_b64', {
      method: 'POST',
      body: form,
    });

    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        msg = ct.includes('application/json') ? (await res.json()).error || (await res.json()).message || msg : await res.text();
      } catch {}
      throw new Error(msg);
    }

    return ct.includes('application/json') ? await res.json() : { ok: true, raw: await res.text() };
  }

  function getHorseRows() {
    // Preferred: explicit row wrappers
    const rows = $$('.horse-row, .horse-line, .horse-item, .row, .horse');
    if (rows.length) return rows;

    // Fallback: find Horse Data block and group inputs by 4
    const container =
      $$('section, .card, .panel, .box').find((el) => /Horse\s*Data/i.test(el.textContent || '')) || document;
    const visibleInputs = $$('input', container).filter((el) => el.offsetParent !== null);
    const groups = [];
    for (let i = 0; i + 3 < visibleInputs.length; i += 4) {
      const group = visibleInputs.slice(i, i + 4);
      const wrap = group[0].closest('.horse-row, .row, .horse-item, .grid, div') || group[0].parentElement;
      groups.push(wrap);
    }
    return groups;
  }

  function ensureRows(count) {
    if (!addHorseBtn) return;
    let rows = getHorseRows();
    while (rows.length < count) {
      addHorseBtn.click();
      rows = getHorseRows();
    }
  }

  function fillRow(rowEl, horse) {
    // Inputs in expected order: Horse, ML Odds, Jockey, Trainer
    const inputs = $$('input', rowEl).filter((el) => el.offsetParent !== null);
    if (inputs[0]) inputs[0].value = horse.name ?? horse.horse ?? '';
    if (inputs[1]) inputs[1].value = horse.odds ?? horse.ml_odds ?? horse.mlOdds ?? '';
    if (inputs[2]) inputs[2].value = horse.jockey ?? '';
    if (inputs[3]) inputs[3].value = horse.trainer ?? '';
    inputs.forEach((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
  }

  function populateForm(parsed) {
    const horses =
      parsed?.horses ||
      parsed?.data?.horses ||
      parsed?.entries ||
      parsed?.rows ||
      (Array.isArray(parsed) ? parsed : []);

    if (!horses.length) return 0;
    ensureRows(horses.length);
    const rows = getHorseRows();
    horses.forEach((h, i) => rows[i] && fillRow(rows[i], h));
    return horses.length;
  }

  async function handleFile(file) {
    try {
      setBadge('Extracting…', 'busy');
      const data = await apiExtract(file);

      if (data?.ok === false) throw new Error(data.error || data.message || 'OCR failed');

      // Use the new API response format
      fillFormFromExtraction(data);
      const horseCount = data?.horses?.length || 0;
      setBadge(horseCount > 0 ? `Parsed ${horseCount} horses` : 'No horses detected', horseCount > 0 ? 'ok' : 'warn');
    } catch (err) {
      console.error('Extract error:', err);
      setBadge('OCR error', 'err');
      alert(`Analyze error: ${err.message || err}`);
    }
  }

  // Map API response into inputs
  function fillFormFromExtraction(payload) {
    const r = payload.race || {};
    setVal('#raceDate', r.date);
    setVal('#raceTrack', r.track);
    setVal('#raceSurface', r.surface);
    setVal('#raceDistance', r.distance);

    const horses = Array.isArray(payload.horses) ? payload.horses : [];
    // Clear existing rows if you maintain a list
    clearHorseRows();

    for (const h of horses) {
      addHorseRow({
        name: (h.name || '').trim(),
        odds: (h.odds || '').trim(),
        jockey: (h.jockey || '').trim(),
        trainer: (h.trainer || '').trim(),
      });
    }
  }

  // tiny helpers (adapt if your app uses different ids/utilities)
  function setVal(sel, v) {
    const el = document.querySelector(sel);
    if (el) el.value = v || '';
  }
  function clearHorseRows() {
    // implement according to your UI – e.g., empty the list/table
    const wrap = document.querySelector('#horse-list');
    if (wrap) wrap.innerHTML = '';
  }
  function addHorseRow({ name, odds, jockey, trainer }) {
    // Use existing addHorseRow function
    window.addHorseRow({ name, odds, jockey, trainer });
  }

  // Wire file input
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFile(file);
    });
  }

  // Also wire the "Analyze Photos with AI" button, so it uses the same flow or opens the picker
  const analyzeBtn = $$('button, a').find((el) => /Analyze\s+Photos/i.test(el.textContent || ''));
  if (analyzeBtn && fileInput) {
    analyzeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const f = fileInput.files && fileInput.files[0];
      if (f) handleFile(f);
      else fileInput.click();
    });
  }

  // Main analyze function for external use
  async function analyzeWithAI() {
    try {
      setBadge('Analyzing…'); // your existing badge helper

      const input = document.querySelector('#fl-file-input'); // hidden file input tied to "Choose Photos / PDF"
      if (!input || !input.files || !input.files[0]) {
        alert('Pick a photo or PDF first.');
        setBadge('Idle');
        return;
      }

      const form = new FormData();
      form.append('file', input.files[0]);

      const res = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        body: form
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        console.error('Analyze failed:', data);
        alert(`Analyze error: ${data?.error || res.statusText}`);
        setBadge('Idle');
        return;
      }

      fillFormFromExtraction(data);
      setBadge('Ready to predict'); // shows success
    } catch (err) {
      console.error(err);
      alert(`Analyze error: ${err.message || err}`);
      setBadge('Idle');
    }
  }

  // Make analyzeWithAI available globally
  window.analyzeWithAI = analyzeWithAI;

  setBadge('Idle', 'info');
})();

/* ============================================================
   🎨 FINISHLINE DARK NEON STYLE (Tailwind / inline-safe)
   ============================================================ */
const style = document.createElement('style');
style.textContent = `
body {
  background: radial-gradient(circle at top, #0a0018 0%, #000000 100%);
  color: #d5cfff;
  font-family: 'Poppins', sans-serif;
}
.btn-primary, .btn, button {
  background: linear-gradient(90deg, #a855f7 0%, #3b82f6 100%);
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  color: white;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.btn-primary:hover, .btn:hover { transform: scale(1.03); }
.input {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px;
  color: #e0dfff;
  padding: 4px 8px;
  width: 160px;
}
.horse-row { animation: fadeIn 0.3s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
document.head.appendChild(style);