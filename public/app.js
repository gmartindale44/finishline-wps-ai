// ===== Configuration =====
const AUTOFILL_RACE_FROM_OCR = false;

// ===== utilities =====
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function setBadge(text) {
  const b = $('#statusBadge');
  if (b) b.textContent = text;
}

function hideLegacyDump() {
  const junk = $('#legacyDump') || document.querySelector('#analysisOutput, #output, #result, textarea, pre');
  if (junk) junk.style.display = 'none';
}

// ===== Toast functions =====
function toastOk(message) {
  console.log('[SUCCESS]', message);
  alert(message); // Replace with proper toast implementation if available
}

function toastWarn(message) {
  console.warn('[WARNING]', message);
  alert(message); // Replace with proper toast implementation if available
}

function toastError(message) {
  console.error('[ERROR]', message);
  alert(message); // Replace with proper toast implementation if available
}

// ===== Robust horse parser =====
function parseHorsesFromText(text) {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const horses = [];
  const oddsRe = /(\d+\s*\/\s*\d+|\d+\s*-\s*\d+|\d+\s*to\s*\d+|\d+)/i;

  // Try block-of-4 first
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\d+\.\s*(.+)$/); // "1. Clarita"
    if (!m) continue;
    const name = m[1].trim();

    const oddsLine = lines[i + 1] || "";
    const oddsMatch = oddsLine.match(oddsRe);
    const odds = oddsMatch ? oddsMatch[1].replace(/\s+/g, "") : "";

    const jockey = (lines[i + 2] || "").trim();
    const trainer = (lines[i + 3] || "").trim();

    // Sanity check: name + odds at minimum
    if (name && odds) {
      horses.push({ name, odds, jockey, trainer });
      i += 3;
      continue;
    }
  }

  // If nothing from 4-line blocks, try single-line fallback
  if (horses.length === 0) {
    for (const l of lines) {
      const m = l.match(/^\s*\d+\.\s*(.+?)\s+(\d+\s*\/\s*\d+|\d+\s*-\s*\d+|\d+\s*to\s*\d+|\d+)(?:\s+(.+?))?(?:\s+(.+))?$/i);
      if (m) {
        horses.push({
          name: m[1].trim(),
          odds: m[2].replace(/\s+/g, ""),
          jockey: (m[3] || "").trim(),
          trainer: (m[4] || "").trim(),
        });
      }
    }
  }

  // De-dup and cap at 24 to avoid runaway
  const seen = new Set();
  const cleaned = [];
  for (const h of horses) {
    const key = `${h.name}|${h.odds}|${h.jockey}|${h.trainer}`;
    if (!seen.has(key)) { seen.add(key); cleaned.push(h); }
  }
  return cleaned.slice(0, 24);
}

// ===== Horse form population =====
    function getHorseRows() {
  // Find the repeating rows for Horse Data - look for the single row structure
  const horseForm = document.querySelector('.horse-form-inline[data-horse-row]');
  if (!horseForm) return [];
  
  return [{
    row: horseForm,
    name: horseForm.querySelector('input[name="horseName"]'),
    odds: horseForm.querySelector('input[name="horseOdds"]'),
    jockey: horseForm.querySelector('input[name="horseJockey"]'),
    trainer: horseForm.querySelector('input[name="horseTrainer"]'),
  }];
}

function clickAddHorse() {
  const addBtn = document.querySelector('#addHorseBtn');
  if (addBtn) {
        addBtn.click();
    return true;
  }
  return false;
}

function ensureRows(n) {
  // For now, we'll work with the single row and populate it
  // In a real implementation, clicking "Add Horse" would create new rows
  const rows = getHorseRows();
  return rows.slice(0, n); // Return up to n rows
}

function fillRow(rowObj, { name, odds, jockey, trainer }) {
  if (rowObj.name) rowObj.name.value = name || "";
  if (rowObj.odds) rowObj.odds.value = odds || "";
  if (rowObj.jockey) rowObj.jockey.value = jockey || "";
  if (rowObj.trainer) rowObj.trainer.value = trainer || "";
}

function populateHorseForm(horses) {
  // For now, populate the first horse in the single row
  // In a real implementation, this would create multiple rows
  if (horses.length > 0) {
    const rows = ensureRows(1);
    if (rows.length > 0) {
      fillRow(rows[0], horses[0]);
    }
  }
}

// ===== OCR handler =====
async function handleOcrResponse(res) {
        let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!data || data.ok === false) {
    toastError(data?.error || "Analyze error");
          return;
        }

  const horses =
    Array.isArray(data.horses) && data.horses.length
      ? data.horses
      : parseHorsesFromText(data?.meta?.raw_text || data?.text || "");

  if (horses.length === 0) {
    toastWarn("No horses found in OCR");
          return;
        }
        
  // DO NOT autofill race fields
  if (AUTOFILL_RACE_FROM_OCR && data?.meta?.race) {
    // Optional future: fill race fields here if toggle is true
  }

  populateHorseForm(horses);
  toastOk("Horse list filled from OCR");
}

// ===== collect horses for predict =====
function collectHorsesFromUI() {
  const rows = $$('#horseRows .horse-row');
  if (!rows.length) return [];
  return rows.map((row) => {
    const cols = row.querySelectorAll('div');
    const name    = cols[0]?.textContent.replace(/^\d+\.\s*/, '').trim() || '';
    const odds    = cols[1]?.textContent.trim() || '';
    const jockey  = cols[2]?.textContent.trim() || '';
    const trainer = cols[3]?.textContent.trim() || '';
    return { name, odds, jockey, trainer };
  });
}

// ===== API calls =====
async function postPhotos(files) {
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  console.log('[analyze] sending files:', files.length);
  const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
  const ct = res.headers.get('content-type') || '';
            let data;
  if (ct.includes('application/json')) data = await res.json();
  else data = { text: await res.text() };
  console.log('[analyze] response:', data);
  if (!res.ok) throw new Error('analyze failed');
  return data;
}

async function predict(horses, race) {
  const payload = { horses, race };
  console.log('[predict] payload:', payload);
  const res = await fetch('/api/predict_wps', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(async () => ({ message: await res.text() }));
  console.log('[predict] response:', data);
  return data;
}

// ===== wire UI =====
(function initUI() {
  const chooseBtn  = $('#chooseBtn');
  const analyzeBtn = $('#analyzeBtn');
  const predictBtn = $('#predictBtn');
  const fileInput  = $('#fileInput');

  // Choose -> open file dialog
  if (chooseBtn && fileInput) {
    chooseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      if (!e.target.files?.length) return;
      setBadge('Extracting…');
      try {
        const data = await postPhotos([...e.target.files]);
        await handleOcrResponse({ json: () => Promise.resolve(data) });
      } catch (err) {
        console.error(err);
        toastError('Extract failed');
        setBadge('Idle');
      } finally {
        fileInput.value = '';
            }
        });
    }

  // Analyze -> reuse last chosen or ask again
  if (analyzeBtn && fileInput) {
    analyzeBtn.addEventListener('click', () => chooseBtn?.click());
  }

  // Predict
  if (predictBtn) {
    predictBtn.addEventListener('click', async () => {
      setBadge('Predicting…');
      const race = {
        date:     $('#raceDate')?.value || '',
        track:    $('#raceTrack')?.value || '',
        surface:  $('#raceSurface')?.value || '',
        distance: $('#raceDistance')?.value || '',
      };
      const horses = collectHorsesFromUI();
        if (!horses.length) {
        toastWarn('No horses found in the form.');
        setBadge('Ready to predict');
            return;
        }
      try {
        const data = await predict(horses, race);
        toastOk(data?.msg || data?.message || 'predict done');
      } catch (err) {
        console.error(err);
        toastError('predict failed');
    } finally {
        setBadge('Ready to predict');
      }
    });
  }

  console.log('[init] UI wired');
  hideLegacyDump();
  setBadge('Idle');
})();