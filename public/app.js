/** --------------------------------------------------------------
 *  STATUS HELPERS (optional visual feedback)
 * -------------------------------------------------------------- */
const getStatusBadge = () =>
  document.querySelector('[data-status="badge"], #status-badge, .status-badge');
const setStatus = (txt) => { const b = getStatusBadge(); if (b) b.textContent = txt; };
const setIdle = () => setStatus('Idle');

/** --------------------------------------------------------------
 *  DOM HELPERS for horse rows (do NOT touch race meta inputs)
 * -------------------------------------------------------------- */
const q = (sel) => document.querySelector(sel);

function getHorseListContainer() {
  // Container that holds the list text (beneath the form) — may be null
  return q('[data-horse-list], #horse-list, .horse-list');
}
function getHorseRowsContainer() {
  // The inline form row area with inputs for horse name / odds / jockey / trainer
  // Use your actual wrapper if different
  return q('[data-horse-rows], #horse-rows, .horse-rows') || document;
}

function makeHorseRow() {
  // Find the single inline row template (the visible row with inputs).
  // If you already have an "Add Horse" flow, we'll click it to generate rows.
  const addBtn =
    q('[data-add-horse], #add-horse, button, [role="button"]');
  // Try to find specific by text
  const add = [...document.querySelectorAll('button, [role="button"], a')]
    .find(b => /add horse/i.test(b.textContent || ''));
  const clickTarget = q('[data-add-horse]') || q('#add-horse') || add || addBtn;

  if (clickTarget) {
    clickTarget.click();
  }

  // Return the last row's inputs after adding
  const rows = [...document.querySelectorAll('.horse-row, [data-horse-row]')];
  if (rows.length) return rows[rows.length - 1];

  // Fallback: use the visible inline inputs (single-row layout)
  // (Adjust these selectors to your actual inline inputs)
  return {
    name:  q('input[placeholder="Horse Name"], input[name="horseName"]'),
    odds:  q('input[placeholder="ML Odds (e.g., 5-2)"], input[name="mlOdds"]'),
    jockey:q('input[placeholder="Jockey"], input[name="jockey"]'),
    trainer:q('input[placeholder="Trainer"], input[name="trainer"]')
  };
}

function setInputValue(el, value) { if (el) { el.value = value || ''; el.dispatchEvent(new Event('input', { bubbles: true })); } }

function fillLastVisibleInlineRow(h) {
  // If your UI is a single inline row (not multiple), fill those fields
  setInputValue(q('input[placeholder="Horse Name"], input[name="horseName"]'), h.name);
  setInputValue(q('input[placeholder="ML Odds (e.g., 5-2)"], input[name="mlOdds"]'), h.odds);
  setInputValue(q('input[placeholder="Jockey"], input[name="jockey"]'), h.jockey);
  setInputValue(q('input[placeholder="Trainer"], input[name="trainer"]'), h.trainer);
}

function fillNewHorseRow(h) {
  const row = makeHorseRow();

  // If row is a DOM node with inputs inside:
  const name   = row.querySelector ? row.querySelector('input[name], input[placeholder="Horse Name"]') : row.name;
  const odds   = row.querySelector ? row.querySelector('input[placeholder*="ML Odds"], input[name="mlOdds"]') : row.odds;
  const jockey = row.querySelector ? row.querySelector('input[placeholder="Jockey"], input[name="jockey"]') : row.jockey;
  const trainer= row.querySelector ? row.querySelector('input[placeholder="Trainer"], input[name="trainer"]') : row.trainer;

  if (!name && !odds && !jockey && !trainer) {
    // Fallback: single-inline-row layout
    return fillLastVisibleInlineRow(h);
  }
  setInputValue(name, h.name);
  setInputValue(odds, h.odds);
  setInputValue(jockey, h.jockey);
  setInputValue(trainer, h.trainer);
}

/** --------------------------------------------------------------
 *  POPULATE ONLY HORSE FIELDS (no date/track/surface/distance)
 * -------------------------------------------------------------- */
function populateHorseForm(horses) {
  try {
    // Clear the "list" block under the form if present (we want the inputs, not the list)
    const list = getHorseListContainer();
    if (list) list.textContent = '';

    // Fill rows
    horses.forEach((h, idx) => {
      const clean = {
        name:   (h.name   || '').trim(),
        odds:   (h.odds   || '').trim(),
        jockey: (h.jockey || '').trim(),
        trainer:(h.trainer|| '').trim(),
      };
      fillNewHorseRow(clean);
    });
  } catch (err) {
    console.error('[populateHorseForm] error:', err);
  }
}

/** --------------------------------------------------------------
 *  RESPONSE PARSING (accept JSON list or plain text list)
 * -------------------------------------------------------------- */
function parseHorsesFromResponse(payload) {
  // 1) JSON { ok:true, horses:[{name,odds,jockey,trainer}, ...] }
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.horses)) return payload.horses;
    if (Array.isArray(payload)) return payload; // if endpoint returns array directly
    if (payload.text) {
      // Some handlers return { text: "1. Horse ...\n2. Horse ..." }
      return parseHorsesFromText(payload.text);
    }
  }
  // 2) string fallback
  if (typeof payload === 'string') {
    return parseHorsesFromText(payload);
  }
  return [];
}

function parseHorsesFromText(text) {
  // Very forgiving fallback: lines like
  // "1. Clarita | 10/1 | Luis Saez | Philip A. Bauer"
  const horses = [];
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Try pipe-delimited
    const parts = line.replace(/^\d+\.?\s*/, '').split('|').map(s => s.trim());
    if (parts.length >= 1) {
      horses.push({
        name: parts[0] || '',
        odds: parts[1] || '',
        jockey: parts[2] || '',
        trainer: parts[3] || '',
      });
    }
  }
  return horses;
}

/** --------------------------------------------------------------
 *  CORE: EXTRACT PHOTOS with AI (actually hit the API)
 * -------------------------------------------------------------- */
async function extractPhotosWithAI(files) {
  if (!files || !files.length) {
    console.warn('[extractPhotosWithAI] No files supplied.');
    return;
  }
  setStatus('Extracting...');

  try {
    // Send ONLY first file; you can loop for multi-page later if needed
    const file = files[0];
    const fd = new FormData();
    fd.append('file', file, file.name);

    const res = await fetch('/api/photo_extract_openai_b64', {
      method: 'POST',
      body: fd,
    });

    // Basic network failure guard
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Extract failed (${res.status}): ${t || 'No body'}`);
    }

    // Try JSON first, then text
    let payload;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await res.json();
    } else {
      payload = await res.text();
    }

    console.log('[extractPhotosWithAI] raw payload:', payload);

    // Endpoint may return {ok:false,error:...}
    if (payload && payload.ok === false) {
      throw new Error(payload.error || 'Unknown extract error');
    }

    const horses = parseHorsesFromResponse(payload);
    if (!horses.length) {
      console.warn('[extractPhotosWithAI] No horses parsed from response.');
      setStatus('No horses found');
      return;
    }

    // Populate only horse rows
    populateHorseForm(horses);
    setStatus('Ready to predict');
  } catch (err) {
    console.error('[extractPhotosWithAI] error:', err);
    alert(`Extract error: ${err.message || err}`);
    setIdle();
  }
}

/** --------------------------------------------------------------
 *  FILE PICKER + ANALYZE BUTTON HOOKS (safe + robust)
 *  (This is compatible with previous snippet; if it exists, keep only one copy)
 * -------------------------------------------------------------- */
(function initFilePickingAndAnalyze() {
  const findByText = (txt) => {
    const lc = txt.trim().toLowerCase();
    const els = document.querySelectorAll('button, [role="button"], a, .btn, .button');
    return [...els].find(el => (el.textContent || '').trim().toLowerCase().includes(lc)) || null;
  };

  const chooseBtn =
    document.querySelector('[data-choose-btn]') ||
    document.getElementById('choose-photos-btn') ||
    findByText('choose photos / pdf') ||
    findByText('choose photos');

  const analyzeBtn =
    document.querySelector('[data-analyze-btn]') ||
    document.getElementById('analyze-btn') ||
    findByText('analyze photos with ai') ||
    findByText('analyze with ai');

  // Make (or get) a hidden input
  let fileInput =
    document.querySelector('input[type="file"][data-core-uploader]') ||
    document.getElementById('file-input-core');

  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'file-input-core';
    fileInput.setAttribute('data-core-uploader', '1');
    fileInput.multiple = true;
    fileInput.accept = '.png,.jpg,.jpeg,.webp,.heic,.heif,.pdf,image/*,application/pdf';
    fileInput.style.position = 'fixed';
    fileInput.style.left = '-9999px';
    fileInput.style.opacity = '0';
    document.body.appendChild(fileInput);
  }

  let lastChosenFiles = [];

  if (chooseBtn) {
    chooseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      fileInput.value = '';
      fileInput.click();
    });
  }

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    lastChosenFiles = files;
    if (!files.length) return;
    await extractPhotosWithAI(files);
  });

  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const files = lastChosenFiles.length ? lastChosenFiles : Array.from(fileInput.files || []);
      if (!files.length) {
        fileInput.value = '';
        fileInput.click();
        return;
      }
      await extractPhotosWithAI(files);
    });
  }
  setIdle(); // initialize badge if present
})();