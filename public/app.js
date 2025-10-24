window.addEventListener('error', (e) => {
  console.error('[GLOBAL ERROR]', e.message, e.error);
  if (typeof toastError === 'function') toastError(`Error: ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED REJECTION]', e.reason);
  if (typeof toastError === 'function') toastError(`Error: ${e.reason?.message || e.reason}`);
});

const statusBadge = () =>
  document.querySelector('[data-status="badge"], #status-badge, .status-badge');

let _busyWatchdog = null;
function setBusy(label = 'Working...') {
  const el = statusBadge();
  if (el) el.textContent = label;
  clearTimeout(_busyWatchdog);
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

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), 30_000);
  fetchOpts.signal = ac.signal;

  try {
    console.log('[OCR] Fetch ->', url, fetchOpts);
    const res = await fetch(url, fetchOpts);
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
    clearBusy();
  }
}

/* ✅ FIXED ANALYZE BUTTON SELECTOR (cross-browser safe) */
const analyzeBtn =
  document.querySelector('[data-analyze-btn]') ||
  document.getElementById('analyze-btn') ||
  Array.from(document.querySelectorAll('button')).find((btn) =>
    btn.textContent.trim().toLowerCase().includes('analyze photos')
  );

if (analyzeBtn) {
  analyzeBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const input = document.querySelector('input[type="file"]');
    const files = Array.from(input?.files || []);
    if (!files.length) {
      if (typeof toastWarn === 'function') toastWarn('Choose at least one photo or PDF');
      return;
    }
    await extractPhotosWithAI(files);
  });
} else {
  console.warn('[INIT] Analyze button not found on page');
}

async function populateHorseForm(horses) {
  console.log('[populateHorseForm] Filling', horses.length, 'horses');

  const container =
    document.querySelector('#horse-rows, [data-horse-rows], .horse-rows') || document;
  const addBtn =
    container.querySelector('#add-horse-btn, button#add-horse, button.add-horse') ||
    document.querySelector('#add-horse-btn, button#add-horse, button.add-horse');

  let rows = Array.from(container.querySelectorAll('[data-horse-row], .horseRow, .horse-row'));
  while (rows.length < horses.length && addBtn) {
    addBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    rows = Array.from(container.querySelectorAll('[data-horse-row], .horseRow, .horse-row'));
  }

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