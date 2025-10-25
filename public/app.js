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

/* =====================================================================
   FinishLine WPS AI — Parser + Multi-row Filler + Debug Harness
   ===================================================================== */

const LOG  = (...a) => console.log("%c[WPS-AI]", "color:#7dd3fc;font-weight:700", ...a);
const WARN = (...a) => console.warn("%c[WPS-AI]", "color:#fbbf24;font-weight:700", ...a);
const ERR  = (...a) => console.error("%c[WPS-AI]", "color:#f87171;font-weight:700", ...a);

/* -----------------------------
   Debug harness
------------------------------ */
window.WPS = {
  lastOCRText: "",
  lastParsed: [],
  dump() {
    console.log("---- WPS.dump() ----");
    console.log("Parsed horses:", this.lastParsed);
    console.log("OCR text (first 1500 chars):\n", (this.lastOCRText || "").slice(0, 1500));
    console.log("Full OCR text length:", (this.lastOCRText || "").length);
    console.log("---------------------");
  }
};

/* -----------------------------
   DOM helpers — horse section
------------------------------ */
const SEL = {
  name:    'input[placeholder="Horse Name"], input[name="horseName"]',
  odds:    'input[placeholder*="ML Odds"], input[name="mlOdds"]',
  jockey:  'input[placeholder="Jockey"], input[name="jockey"]',
  trainer: 'input[placeholder="Trainer"], input[name="trainer"]',
};

function getHorseSectionRoot() {
  const first = document.querySelector(SEL.name);
  let n = first;
  while (n && n !== document.body) {
    if (n.querySelector(SEL.name) && n.querySelector(SEL.odds) &&
        n.querySelector(SEL.jockey) && n.querySelector(SEL.trainer)) {
      return n;
    }
    n = n.parentElement;
  }
  // fallback: densest container
  const candidates = [...document.querySelectorAll('section, form, .card, .panel, .container, main, .content, div')];
  let best = document;
  let bestScore = -1;
  for (const c of candidates) {
    const score =
      (c.querySelectorAll(SEL.name).length > 0) +
      (c.querySelectorAll(SEL.odds).length > 0) +
      (c.querySelectorAll(SEL.jockey).length > 0) +
      (c.querySelectorAll(SEL.trainer).length > 0);
    if (score > bestScore) { best = c; bestScore = score; }
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
  const direct = document.querySelector('[data-add-horse], #add-horse');
  if (direct) return direct;
  const exact = [...document.querySelectorAll('button, [role="button"], .btn, .button')]
    .find(b => (b.textContent || '').trim().toLowerCase() === 'add horse');
  if (exact) return exact;
  return [...document.querySelectorAll('button, [role="button"], .btn, .button')]
    .find(b => {
      const t = (b.textContent || '').toLowerCase();
      return t.includes('add') && t.includes('horse');
    }) || null;
}

async function waitForRows(target, timeoutMs = 5000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (rowCount() >= target) return true;
    await new Promise(r => setTimeout(r, 30));
  }
  return rowCount() >= target;
}

function fillRow(i, horse) {
  const { names, odds, jockeys, trainers } = cols();
  LOG(`fill row #${i}`, horse);
  setVal(names[i],    (horse.name    || '').trim());
  setVal(odds[i],     (horse.odds    || '').trim());
  setVal(jockeys[i],  (horse.jockey  || '').trim());
  setVal(trainers[i], (horse.trainer || '').trim());
}

async function ensureRowExists(idx) {
  const need = idx + 1;
  if (rowCount() >= need) return true;
  const btn = findAddHorseBtn();
  if (!btn) { ERR('Add Horse button not found'); return false; }
  for (let t = 1; t <= 3; t++) {
    btn.click();
    const ok = await waitForRows(need, 1800);
    if (ok) return true;
  }
  ERR(`Failed to grow to ${need} rows`);
  return false;
}

async function populateHorseForm(horses) {
  LOG('populateHorseForm horses=', horses);
  if (!Array.isArray(horses) || horses.length === 0) {
    WARN('No horses to populate.');
    return;
  }
  if (rowCount() === 0) {
    if (!(await ensureRowExists(0))) return;
  }
  // row 0
  fillRow(0, horses[0]);
  // remaining
  for (let i = 1; i < horses.length; i++) {
    if (!(await ensureRowExists(i))) break;
    fillRow(i, horses[i]);
  }
  LOG('done. final rowCount=', rowCount());
}

/* -----------------------------
   OCR text → horses (robust)
------------------------------ */
function parseHorsesFromText(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const text = raw
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/[·•∙●]/g, '-')        // bullets → hyphen
    .replace(/[ ]{2,}/g, ' ')
    .trim();

  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

  const isNumbered = s => /^\d+\.\s*/.test(s);
  const stripNumber = s => s.replace(/^\d+\.\s*/, '').trim();
  const isOdds = s => /\b\d{1,2}\s*[\/-]\s*\d{1,2}\b/.test(s);   // 5/2, 12-1, 8/5
  const isLikelyName = s => /[a-z]/i.test(s) && !isOdds(s);

  const horses = [];

  // Pass A — numbered blocks
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (isNumbered(line)) {
      const name = stripNumber(line);
      let odds = '', jockey = '', trainer = '';
      let j = i + 1;
      for (; j < Math.min(i + 6, lines.length); j++) {
        if (isOdds(lines[j])) { odds = lines[j].match(/\d{1,2}\s*[\/-]\s*\d{1,2}/)[0].replace(/\s*/g, ''); j++; break; }
      }
      if (j < lines.length && isLikelyName(lines[j])) { jockey = lines[j]; j++; }
      if (j < lines.length && isLikelyName(lines[j])) { trainer = lines[j]; j++; }
      horses.push({ name, odds, jockey, trainer });
      while (j < lines.length && !isNumbered(lines[j])) j++;
      i = j;
      continue;
    }
    i++;
  }

  // Pass B — odds-anchored blocks (if A yielded <= 1)
  if (horses.length <= 1) {
    const seen = new Set(horses.map(h => h.name + '|' + h.odds));
    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      if (!isOdds(line)) continue;
      const odds = line.match(/\d{1,2}\s*[\/-]\s*\d{1,2}/)[0].replace(/\s*/g, '');
      // name on a recent prior line
      let name = '';
      for (let p = k - 1; p >= Math.max(0, k - 3); p--) {
        if (isNumbered(lines[p])) { name = stripNumber(lines[p]); break; }
        if (isLikelyName(lines[p])) { name = lines[p]; break; }
      }
      let jockey = '', trainer = '';
      let collected = 0;
      for (let n = k + 1; n < Math.min(k + 6, lines.length); n++) {
        if (isLikelyName(lines[n])) {
          if (!jockey) { jockey = lines[n]; collected++; continue; }
          if (!trainer) { trainer = lines[n]; collected++; break; }
        }
      }
      if (name && !seen.has(name + '|' + odds)) {
        horses.push({ name, odds, jockey, trainer });
        seen.add(name + '|' + odds);
      }
    }
  }

  // De-dupe & clean
  const out = [];
  const sig = new Set();
  for (const h of horses) {
    const s = (h.name||'').toLowerCase() + '|' + (h.odds||'');
    if (h.name && !sig.has(s)) { sig.add(s); out.push(h); }
  }

  LOG('PARSE result (count):', out.length, out);
  window.WPS.lastParsed = out;
  return out;
}

/* -----------------------------------------
   Upload → call OCR → parse → populate
------------------------------------------ */
async function extractViaAPI(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json) throw new Error('OCR request failed');

  const text = json.text || (json.result && json.result.text) || json.raw || '';
  window.WPS.lastOCRText = text || '';
  return text || '';
}

async function handleOcrTextAndPopulate(ocrText) {
  try {
    const horses = parseHorsesFromText(ocrText);
    LOG('A) parsed horses =', horses.length);
    await populateHorseForm(horses);
            } catch (e) {
    ERR('handleOcrTextAndPopulate failed:', e);
  }
}

/* -----------------------------------------
   Wire the "Choose Photos / PDF" button
------------------------------------------ */
(function wireChoose() {
  const choose = [...document.querySelectorAll('button, [role="button"]')]
    .find(b => (b.textContent || '').toLowerCase().includes('choose') &&
               (b.textContent || '').toLowerCase().includes('photos'));
  if (!choose) { WARN('Choose Photos button not found; wiring skipped'); return; }

  let fileInput = document.getElementById('wps-file');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'wps-file';
    fileInput.accept = 'image/*,.pdf';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }

  choose.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      LOG('Uploading to OCR…');
      const text = await extractViaAPI(file);
      LOG('OCR text length:', text.length);
      await handleOcrTextAndPopulate(text);
    } catch (e) {
      ERR(e);
      alert('Error while extracting text (see console)');
    } finally {
      fileInput.value = '';
    }
  });
})();