/* =============================
   GLOBAL ERROR TRAPS
   ============================= */
window.addEventListener('error', (e) => {
  console.error('[GLOBAL ERROR]', e.message, e.error);
  if (typeof toastError === 'function') toastError(`Error: ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED REJECTION]', e.reason);
  if (typeof toastError === 'function') toastError(`Error: ${e.reason?.message || e.reason}`);
});

/* =============================
   STATUS BADGE + WATCHDOG
   ============================= */
const statusBadge = () =>
  document.querySelector('[data-status="badge"], #status-badge, .status-badge');

let _busyWatchdog = null;
function setBusy(label = 'Working...') {
  const el = statusBadge();
  if (el) el.textContent = label;
  clearTimeout(_busyWatchdog);
  // Failsafe: reset to Idle if stuck over 12 seconds
  _busyWatchdog = setTimeout(() => {
    const b = statusBadge();
    if (b && b.textContent?.toLowerCase().includes('extract')) {
      console.warn('[WATCHDOG] Busy badge stuck — forcing Idle');
      b.textContent = 'Idle';
    }
  }, 12_000);
}
function clearBusy() {
  const el = statusBadge();
  if (el) el.textContent = 'Idle';
  clearTimeout(_busyWatchdog);
  _busyWatchdog = null;
}

/* =============================
   OCR REQUEST + LOGGING + TIMEOUT
   ============================= */
async function extractPhotosWithAI(filesOrB64) {
  setBusy('Extracting...');

  const hasFiles = Array.isArray(filesOrB64) && filesOrB64[0] instanceof File;
  const url = '/api/photo_extract_openai_b64';
  let fetchOpts;

  if (hasFiles) {
    const form = new FormData();
    filesOrB64.forEach((f) => form.append('file', f));
    fetchOpts = { method: 'POST', body: form };
    } else {
    fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: filesOrB64 }),
    };
  }

  // 30s timeout
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), 30_000);
  fetchOpts.signal = ac.signal;

  try {
    console.log('[OCR] Fetch ->', url, fetchOpts);
    const res = await fetch(url, fetchOpts);

    // Log raw response regardless of success
    const raw = await res.clone().text();
    console.log('[OCR] HTTP', res.status, 'RAW:', raw);

    let data = null;
        try {
          data = JSON.parse(raw);
    } catch {
      console.warn('[OCR] Response was not JSON parseable');
    }
    console.log('[OCR] Parsed JSON:', data);

    if (!res.ok) {
      const msg = data?.error || `Analyze failed (${res.status})`;
      if (typeof toastError === 'function') toastError(msg);
        return;
        }

    if (!data || data.ok === false) {
      const msg = data?.error || 'Analyze error';
      if (typeof toastError === 'function') toastError(msg);
        return;
        }
        
    // Normalize horses
    let horses = Array.isArray(data.horses) ? data.horses.filter(Boolean) : [];
    if (!horses.length && typeof parseHorsesFromText === 'function') {
      const maybeText = data?.meta?.raw_text || data?.text || '';
      horses = parseHorsesFromText(maybeText) || [];
    }

    console.log('[OCR] Horses count:', horses.length, horses);

          if (!horses.length) {
      if (typeof toastWarn === 'function') toastWarn('No horses found in OCR result');
              return;
            }

    // Fill ONLY horse rows (not race fields)
    if (typeof populateHorseForm === 'function') {
      await populateHorseForm(horses);
        } else {
      console.warn('[OCR] populateHorseForm missing');
    }

    if (typeof toastOk === 'function') toastOk(`Filled ${horses.length} horses`);
  } catch (err) {
    console.error('[OCR] Exception:', err);
    const msg =
      err?.name === 'AbortError'
        ? 'Analyze timed out'
        : err?.message || 'Analyze failed';
    if (typeof toastError === 'function') toastError(msg);
      } finally {
    clearTimeout(timer);
    clearBusy(); // Always return to Idle
  }
}

/* =============================
   HOOK ANALYZE BUTTON
   ============================= */
document
  .querySelector(
    '[data-analyze-btn], #analyzeBtn, button#analyze, button:has(span:contains("Analyze Photos with AI"))'
  )
  ?.addEventListener('click', async (e) => {
    e.preventDefault();
    const input = document.querySelector('input[type="file"]');
    const files = Array.from(input?.files || []);
    if (!files.length) {
      if (typeof toastWarn === 'function') toastWarn('Choose at least one photo or PDF');
        return;
      }
    await extractPhotosWithAI(files);
  });

/* =============================
   populateHorseForm()
   — ensure we fill horse fields only
   ============================= */
async function populateHorseForm(horses) {
  console.log('[populateHorseForm] Filling', horses.length, 'horses');

  // Select or create horse rows
  const container =
    document.querySelector('#horse-rows, [data-horse-rows], .horse-rows') || document;
  const addBtn =
    container.querySelector('#add-horse-btn, button#add-horse, button.add-horse') ||
    document.querySelector('#add-horse-btn, button#add-horse, button.add-horse');

  // Get all current rows
  let rows = Array.from(container.querySelectorAll('[data-horse-row], .horseRow, .horse-row'));
  while (rows.length < horses.length && addBtn) {
    addBtn.click();
    await new Promise((r) => setTimeout(r, 100)); // short wait for DOM render
    rows = Array.from(container.querySelectorAll('[data-horse-row], .horseRow, .horse-row'));
  }

  // Fill each horse entry
  horses.forEach((h, i) => {
    const row = rows[i];
    if (!row) return;
    const name = row.querySelector('input[name="horseName"], input.horse-name, input:nth-of-type(1)');
    const odds = row.querySelector('input[name="horseOdds"], input.horse-odds, input:nth-of-type(2)');
    const jockey = row.querySelector('input[name="horseJockey"], input.horse-jockey, input:nth-of-type(3)');
    const trainer = row.querySelector('input[name="horseTrainer"], input.horse-trainer, input:nth-of-type(4)');
    if (name) name.value = h.name || '';
    if (odds) odds.value = h.odds || '';
    if (jockey) jockey.value = h.jockey || '';
    if (trainer) trainer.value = h.trainer || '';
  });
}

/* =============================
   parseHorsesFromText() fallback
   (basic version if server gives raw text)
   ============================= */
function parseHorsesFromText(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const horses = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\d+\.\s*(.+)$/);
    if (m) {
      const name = m[1];
      const odds = (lines[i + 1] || '').match(/\d+\/\d+/)?.[0] || '';
      const jockey = lines[i + 2] || '';
      const trainer = lines[i + 3] || '';
      if (name && odds) horses.push({ name, odds, jockey, trainer });
    }
  }
        return horses;
      }
      
/* =============================
   TOAST FUNCTIONS
   ============================= */
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

/* =============================
   UTILITIES
   ============================= */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function hideLegacyDump() {
  const junk = $('#legacyDump') || document.querySelector('#analysisOutput, #output, #result, textarea, pre');
  if (junk) junk.style.display = 'none';
}

/* =============================
   COLLECT HORSES FOR PREDICT
   ============================= */
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

/* =============================
   API CALLS
   ============================= */
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

/* =============================
   UI INITIALIZATION
   ============================= */
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