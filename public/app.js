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

/** Find the Add Horse button reliably by text or data-id */
function getAddHorseButton() {
  // 1) explicit data-hook/id
  let btn = document.querySelector('[data-add-horse], #add-horse');
  if (btn) return btn;

  // 2) by text content
  const candidates = document.querySelectorAll('button, [role="button"], a, .btn, .button');
  btn = [...candidates].find(el => /(^|\s)add horse(\s|$)/i.test((el.textContent || '').trim()));
  return btn || null;
}

/** Click "Add Horse" and return the newly created row container or its inputs (fallback last row) */
function clickAddHorseAndGetRow() {
  const before = [...document.querySelectorAll('.horse-row, [data-horse-row]')];
  const addBtn = getAddHorseButton();
  if (addBtn) addBtn.click();

  // Prefer a concrete new row node if your app renders rows with a class
  const after = [...document.querySelectorAll('.horse-row, [data-horse-row]')];
  if (after.length > before.length) return after[after.length - 1];

  // Fallback: use the "last/only" inline inputs as a pseudo-row
    return {
    name:   document.querySelector('input[placeholder="Horse Name"], input[name="horseName"]'),
    odds:   document.querySelector('input[placeholder*="ML Odds"], input[name="mlOdds"]'),
    jockey: document.querySelector('input[placeholder="Jockey"], input[name="jockey"]'),
    trainer:document.querySelector('input[placeholder="Trainer"], input[name="trainer"]'),
  };
}

/* =========================================================
   FinishLine WPS AI — Multi-row incremental population (v2)
   - ONLY fills horse rows (never touches race fields)
   - Clicks "Add Horse" for each additional entry
   - Waits for DOM to grow, with strict timeouts
   - Verbose logs so we can pinpoint failures
   ========================================================= */

const LOG = (...a) => console.log("%c[WPS-AI]", "color:#7dd3fc;font-weight:700", ...a);
const WARN = (...a) => console.warn("%c[WPS-AI]", "color:#fbbf24;font-weight:700", ...a);
const ERR = (...a) => console.error("%c[WPS-AI]", "color:#f87171;font-weight:700", ...a);

const SEL = {
  name:   'input[placeholder="Horse Name"], input[name="horseName"]',
  odds:   'input[placeholder*="ML Odds"], input[name="mlOdds"]',
  jockey: 'input[placeholder="Jockey"], input[name="jockey"]',
  trainer:'input[placeholder="Trainer"], input[name="trainer"]',
};

function getHorseSectionRoot() {
  // Prefer the container that already holds one full row
  const firstName = document.querySelector(SEL.name);
  let n = firstName;
  while (n && n !== document.body) {
    const hasAll =
      n.querySelector(SEL.name) &&
      n.querySelector(SEL.odds) &&
      n.querySelector(SEL.jockey) &&
      n.querySelector(SEL.trainer);
    if (hasAll) return n;
    n = n.parentElement;
  }
  // Fallback: choose the densest container
  const candidates = [...document.querySelectorAll('section, form, .card, .panel, .container, main, .content, div')];
  let best = document;
  let scoreBest = -1;
  for (const c of candidates) {
    const score = (c.querySelectorAll(SEL.name).length > 0) +
                  (c.querySelectorAll(SEL.odds).length > 0) +
                  (c.querySelectorAll(SEL.jockey).length > 0) +
                  (c.querySelectorAll(SEL.trainer).length > 0);
    if (score > scoreBest) { best = c; scoreBest = score; }
  }
  return best;
}

function cols() {
  const root = getHorseSectionRoot();
  return {
    root,
    names:    root.querySelectorAll(SEL.name),
    odds:     root.querySelectorAll(SEL.odds),
    jockeys:  root.querySelectorAll(SEL.jockey),
    trainers: root.querySelectorAll(SEL.trainer),
  };
}
const rowCount = () => cols().names.length;

function setVal(el, v) {
  if (!el) return;
  el.value = v ?? '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function findAddHorseBtn() {
  // Prefer known data/id
  const candidates = [
    '[data-add-horse]',
    '#add-horse',
    // Generic button scans (text match)
    'button', '[role="button"]', '.btn', '.button'
  ];
  for (const sel of candidates) {
    const matches = [...document.querySelectorAll(sel)]
      .filter(b => (b.textContent || '').trim().toLowerCase() === 'add horse');
    if (matches.length) return matches[0];
  }
  // Fuzzy contains 'add' + 'horse'
  const fuzzy = [...document.querySelectorAll('button, [role="button"], .btn, .button')]
    .find(b => {
      const t = (b.textContent || '').toLowerCase();
      return t.includes('add') && t.includes('horse');
    });
  return fuzzy || null;
}

async function waitForRows(target, timeoutMs = 5000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (rowCount() >= target) return true;
    await new Promise(r => setTimeout(r, 35));
  }
  return rowCount() >= target;
}

function fillRow(i, horse) {
  const { names, odds, jockeys, trainers } = cols();
  LOG(`E) Filling row #${i}`, horse);
  setVal(names[i],    (horse.name    || '').trim());
  setVal(odds[i],     (horse.odds    || '').trim());
  setVal(jockeys[i],  (horse.jockey  || '').trim());
  setVal(trainers[i], (horse.trainer || '').trim());
}

async function ensureRowExists(idx) {
  const need = idx + 1;
  if (rowCount() >= need) return true;

  const btn = findAddHorseBtn();
  if (!btn) {
    ERR(`D) "Add Horse" button not found; cannot create row #${idx}`);
    return false;
  }

  // Some UIs require the previous row to be non-empty; we rely on fill-before-click loop
  for (let attempt = 1; attempt <= 3; attempt++) {
    LOG(`D) Clicking "Add Horse" (attempt ${attempt}) to reach ${need} rows`);
    btn.click();
    const ok = await waitForRows(need, 1800);
    if (ok) return true;
  }
  ERR(`D) DOM did not grow to ${need} rows after clicking "Add Horse"`);
  return false;
}

/**
 * MAIN: populate all horses, one-by-one
 * Call this with the OCR result array: [{name, odds, jockey, trainer}, ...]
 */
async function populateHorseForm(horses) {
  LOG('A) populateHorseForm called with', horses);

  if (!Array.isArray(horses) || horses.length === 0) {
    WARN('A) No horses to populate.');
    return;
  }

  // Make sure at least one row exists
  if (rowCount() === 0) {
    LOG('B) No rows yet; creating first row…');
    if (!(await ensureRowExists(0))) return;
  }

  // Fill row 0 immediately (many UIs ship one blank row)
  LOG('C) Filling first row (index 0)…');
  fillRow(0, horses[0]);

  // For subsequent horses, ensure row exists then fill
  for (let i = 1; i < horses.length; i++) {
    if (!(await ensureRowExists(i))) {
      ERR(`Stopping at i=${i} — cannot ensure row exists.`);
      break;
    }
    fillRow(i, horses[i]);
  }

  LOG('Done populating. Final rowCount =', rowCount());
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