// ===== Configuration =====
const AUTOFILL_RACE_FROM_OCR = false;

// ===== utilities =====
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ===== Busy state management =====
let _busy = null;
function setBusy(label) {
  _busy = label;
  // set badge text safely
  const badge = document.querySelector('[data-badge], .badge, .status-badge');
  if (badge) { badge.textContent = label || 'Idle'; }
}
function clearBusy() {
  _busy = null;
  const badge = document.querySelector('[data-badge], .badge, .status-badge');
  if (badge) { badge.textContent = 'Idle'; }
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
  const all = text
    .replace(/\u00A0/g, ' ')          // non-breaking spaces
    .replace(/[ \t]+/g, ' ')          // collapse spaces
    .trim();

  const lines = all.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const oddsRe = /(\d+\s*\/\s*\d+|\d+\s*-\s*\d+|\d+\s*to\s*\d+|\d+)/i;
  const horses = [];

  // Pass 1: 4-line blocks
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\d+\.\s*(.+)$/); // "1. Clarita"
    if (!m) continue;
    const name = m[1].trim();
    const oddsLine = lines[i + 1] || '';
    const oddsMatch = oddsLine.match(oddsRe);
    const odds = oddsMatch ? oddsMatch[1].replace(/\s+/g, '') : '';

    const jockey = (lines[i + 2] || '').trim();
    const trainer = (lines[i + 3] || '').trim();

    if (name && odds) {
      horses.push({ name, odds, jockey, trainer });
      i += 3;
    }
  }

  // Pass 2: single-line fallback
  if (!horses.length) {
    for (const l of lines) {
      const m = l.match(/^\s*\d+\.\s*(.+?)\s+(\d+\s*\/\s*\d+|\d+\s*-\s*\d+|\d+\s*to\s*\d+|\d+)(?:\s+(.+?))?(?:\s+(.+))?$/i);
      if (m) {
        horses.push({
          name: m[1].trim(),
          odds: m[2].replace(/\s+/g, ''),
          jockey: (m[3] || '').trim(),
          trainer: (m[4] || '').trim(),
        });
      }
    }
  }

  // Pass 3: defensive split by numbered sections to avoid truncation
  if (!horses.length) {
    const chunks = all.split(/(?=^\s*\d+\.\s+)/m); // keep numbers by zero-width ahead
    for (const chunk of chunks) {
      const lns = chunk.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!lns.length) continue;
      const first = lns[0];
      const m = first.match(/^\s*\d+\.\s*(.+)$/);
      if (!m) continue;
      const name = m[1].trim();

      // Try to find odds somewhere in the next two lines
      const cand = (lns[1] || '') + ' ' + (lns[2] || '');
      const om = cand.match(oddsRe);
      const odds = om ? om[1].replace(/\s+/g, '') : '';

      // Try infer jockey/trainer as the next two lines if present
      const jockey = (lns[2] || '').trim();
      const trainer = (lns[3] || '').trim();

      if (name && odds) {
        horses.push({ name, odds, jockey, trainer });
      }
    }
  }

  // Dedup + cap
  const seen = new Set();
  const out = [];
  for (const h of horses) {
    const key = `${h.name}|${h.odds}|${h.jockey}|${h.trainer}`;
    if (!seen.has(key)) { seen.add(key); out.push(h); }
  }
  return out.slice(0, 24);
}

// ===== Horse form population =====
// Prefer a stable wrapper with a known ID or data-attr if available:
const HORSE_ROWS_CONTAINER_SEL = '#horse-rows, [data-horse-rows], .horse-rows';
const HORSE_ROW_SEL = '[data-horse-row], .horse-row, .horseRow';
const ADD_HORSE_SEL = '#add-horse-btn, button#add-horse, button[data-add-horse], button.add-horse, button:has(> span), button';

function getHorseRows() {
  const container = document.querySelector(HORSE_ROWS_CONTAINER_SEL) || document;
  const rows = Array.from(container.querySelectorAll(HORSE_ROW_SEL));

  // Map each row to its four inputs. Try specific names first, then fallbacks.
  return rows.map(row => ({
    row,
    name: row.querySelector('input[name="horseName"], input[data-name="horseName"], input.horse-name, input[placeholder*="Horse"], input:nth-of-type(1)'),
    odds: row.querySelector('input[name="horseOdds"], input[data-name="horseOdds"], input.horse-odds, input[placeholder*="Odds"], input:nth-of-type(2)'),
    jockey: row.querySelector('input[name="horseJockey"], input[data-name="horseJockey"], input.horse-jockey, input[placeholder*="Jockey"], input:nth-of-type(3)'),
    trainer: row.querySelector('input[name="horseTrainer"], input[data-name="horseTrainer"], input.horse-trainer, input[placeholder*="Trainer"], input:nth-of-type(4)'),
  }));
}

    function findAddHorseButton() {
  // Choose the "Add Horse" button that's nearest to the rows container
  const container = document.querySelector(HORSE_ROWS_CONTAINER_SEL);
  if (container) {
    const btn = container.querySelector(ADD_HORSE_SEL);
    if (btn && /add\s*horse/i.test(btn.textContent)) return btn;
  }
  // Otherwise search globally for a button whose label matches
  const candidates = Array.from(document.querySelectorAll(ADD_HORSE_SEL))
    .filter(b => /add\s*horse/i.test(b.textContent || ''));
  return candidates[0] || null;
}

function nextFrame() {
  return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
}

async function ensureRows(n) {
  let rows = getHorseRows();
      const addBtn = findAddHorseButton();
      if (!addBtn) {
    console.warn('Add Horse button not found – cannot add rows');
    return rows;
      }
  while (rows.length < n) {
        addBtn.click();
    // Wait a tick for DOM/framework to mount the new row
    await nextFrame();
    rows = getHorseRows();
  }
  return rows;
}

function fillRow(rowObj, { name, odds, jockey, trainer }) {
  if (rowObj.name) rowObj.name.value = name || '';
  if (rowObj.odds) rowObj.odds.value = odds || '';
  if (rowObj.jockey) rowObj.jockey.value = jockey || '';
  if (rowObj.trainer) rowObj.trainer.value = trainer || '';
}

async function populateHorseForm(horses) {
  console.log('[OCR] horses returned:', horses.length);
  const rows = await ensureRows(horses.length);
  console.log('[OCR] rows ensured:', rows.length);

  horses.forEach((h, i) => {
    if (!rows[i]) return;
    fillRow(rows[i], h);
  });
  console.log('[OCR] filled rows');
}

// ===== OCR extraction with timeout and reliability =====
async function extractPhotosWithAI(filesOrB64) {
  setBusy('Extracting...');

  // Build request body: either multipart with 'file', or JSON { image_b64 }
  const hasFiles = Array.isArray(filesOrB64) && filesOrB64[0] instanceof File;
  let url = '/api/photo_extract_openai_b64';
  let fetchOpts;

  if (hasFiles) {
    const form = new FormData();
    filesOrB64.forEach(f => form.append('file', f));
    fetchOpts = { method: 'POST', body: form };
        } else {
    fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: filesOrB64 }),
    };
  }

  // 30s timeout guard
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort('timeout'), 30_000);
  fetchOpts.signal = ac.signal;

  try {
    const res = await fetch(url, fetchOpts);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }

    console.log('[OCR] HTTP', res.status, 'data:', data);

    if (!res.ok) {
      toastError(`Analyze failed (${res.status})`);
        return;
      }
    if (!data || data.ok === false) {
      toastError(data?.error || 'Analyze error');
        return;
      }

    // prefer server horses; fallback to client parsing
    const horses =
      (Array.isArray(data.horses) ? data.horses : [])?.filter(Boolean) ??
      [];

    // Defensive: parse client side if server gave none
    const parsed = (!horses.length)
      ? parseHorsesFromText(data?.meta?.raw_text || data?.text || '')
      : horses;

    console.log('[OCR] horses returned:', parsed?.length, parsed);

    if (!parsed || !parsed.length) {
      toastWarn('No horses found in OCR result');
            return;
    }

    // only fill horse rows — do not touch race fields here
    await populateHorseForm(parsed);
    toastOk(`Filled ${parsed.length} horses from OCR`);
  } catch (err) {
    const msg = (err?.name === 'AbortError') ? 'Analyze timed out' : (err?.message || 'Analyze failed');
    console.warn('[OCR] error:', err);
    toastError(msg);
      } finally {
    clearTimeout(t);
    clearBusy();   // <<< ALWAYS clear status
  }
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
      try {
        await extractPhotosWithAI([...e.target.files]);
      } catch (err) {
        console.error(err);
        toastError('Extract failed');
      } finally {
        fileInput.value = '';
      }
    });
  }

  // Analyze button handler
  document.querySelector('[data-analyze-btn], #analyzeBtn, button#analyze')
    ?.addEventListener('click', async () => {
      // get selected files from the file input
      const input = document.querySelector('input[type="file"][multiple], input[type="file"]');
      const files = Array.from(input?.files || []);
      if (!files.length) {
        toastWarn('Choose at least one photo or PDF');
        return;
      }
      await extractPhotosWithAI(files);
    });

  // Predict
  if (predictBtn) {
    predictBtn.addEventListener('click', async () => {
      setBusy('Predicting…');
      const race = {
        date:     $('#raceDate')?.value || '',
        track:    $('#raceTrack')?.value || '',
        surface:  $('#raceSurface')?.value || '',
        distance: $('#raceDistance')?.value || '',
      };
      const horses = collectHorsesFromUI();
      if (!horses.length) {
        toastWarn('No horses found in the form.');
        clearBusy();
        return;
      }
      try {
        const data = await predict(horses, race);
        toastOk(data?.msg || data?.message || 'predict done');
      } catch (err) {
        console.error(err);
        toastError('predict failed');
      } finally {
        clearBusy();
      }
    });
  }

  console.log('[init] UI wired');
  hideLegacyDump();
  clearBusy();
})();