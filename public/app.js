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
   🧠 AUTO EXTRACT AFTER CHOOSE
   ============================================================ */
async function handleFilesSelected(files) {
  if (!files || files.length === 0) return;

  setBadge('Extracting...');
  try {
    const form = new FormData();
    [...files].forEach((f) => form.append('files', f));

    const res = await fetch('/api/photo_extract_openai_b64', {
      method: 'POST',
      body: form,
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || payload?.message || 'OCR failed');
    }

    const entries = payload?.data?.entries || [];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('No race entries found in the image(s)');
    }

    clearHorseRows();
    entries.forEach((h) => addHorseRow(h));

    setBadge('Ready to analyze');
  } catch (err) {
    console.error('OCR error:', err);
    setBadge('OCR error');
    alert(`OCR failed: ${err.message ?? err}`);
  }
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

// Analyze and Predict functionality is now handled by finishline-client.js

/* ============================================================
   🚀 INITIALIZE EVERYTHING
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  ensureFilePicker((files) => handleFilesSelected(files));
  setBadge('Idle');
  
  // Set busy labels for buttons
  const analyzeBtn = document.getElementById('analyzeBtn');
  const predictBtn = document.getElementById('predictBtn');
  
  if (analyzeBtn) analyzeBtn.dataset.busyLabel = 'Analyzing… ⏳';
  if (predictBtn) predictBtn.dataset.busyLabel = 'Predicting… ⏳';
});

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