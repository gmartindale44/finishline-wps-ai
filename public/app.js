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
// Dev injector button for testing multi-row form filling
(function addDevInjector() {
  if (window.location.hostname === 'localhost' || window.location.search.includes('dev=true')) {
    const devBtn = document.createElement('button');
    devBtn.textContent = '🧪 Test Multi-Row Fill';
    devBtn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:#ff6b6b;color:white;border:none;padding:8px 12px;border-radius:4px;font-size:12px;cursor:pointer;';
    
    devBtn.addEventListener('click', async () => {
      try {
        const sample = [
          { horse: "Clarita", jockey: "Luis Saez", trainer: "Philip A. Bauer", ml: "10/1" },
          { horse: "Absolute Honor", jockey: "Tyler Gaffalione", trainer: "Saffie A. Joseph, Jr.", ml: "5/2" },
          { horse: "Indict", jockey: "Cristian A. Torres", trainer: "Thomas Drury, Jr.", ml: "8/1" },
          { horse: "Jewel Box", jockey: "Luan Machado", trainer: "Ian R. Wilkes", ml: "15/1" },
        ];
        
        const r = await fetch("/api/debug_fill", { 
          method: "POST", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ entries: sample })
        });
        const out = await r.json();
        
        // Convert to horses format
        const horses = out.data.entries.map(entry => ({
          name: entry.horse || entry.name || '',
          ml_odds: entry.ml || entry.odds || '',
          jockey: entry.jockey || '',
          trainer: entry.trainer || ''
        }));
        
        await populateHorses(horses);
        toast('✅ Multi-row test completed!');
      } catch (err) {
        console.error('Dev injector error:', err);
        toast('❌ Dev test failed: ' + err.message);
      }
    });
    
    document.body.appendChild(devBtn);
  }
})();

(function () {
  if (window.WPSHotfix?.installed) return;
  const WPS = (window.WPSHotfix = { installed: true });
  const LOG = (...a) => console.log("%c[WPS]", "color:#60a5fa;font-weight:700", ...a);
  const ERR = (...a) => console.error("%c[WPS]", "color:#f87171;font-weight:700", ...a);

  // ---------- DOM utils ----------
  function qsAll(sel, root = document) { try { return Array.from(root.querySelectorAll(sel)); } catch { return []; } }
  function textIncludes(el, ...needles) {
    const t = (el?.textContent || "").toLowerCase();
    return needles.every(n => t.includes(n));
  }
  function findChooseButton() {
    const cands = qsAll('button, [role="button"], .btn, .button');
    return cands.find(b => textIncludes(b, "choose") && (textIncludes(b, "photo") || textIncludes(b, "pdf")));
  }
  function findAddHorseButton() {
    const cands = qsAll('button, [role="button"], .btn, .button');
    return cands.find(b => textIncludes(b, "add") && textIncludes(b, "horse"));
  }
  function valueSet(el, v) {
    if (!el) return;
    el.value = v ?? "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function selectFieldAt(index, selectors) {
    for (const sel of selectors) {
      const nodes = qsAll(sel);
      if (nodes.length > index) return nodes[index];
    }
    return null;
  }

  // ---------- badge helpers (non-fatal if not present) ----------
  function setBadge(state) {
    // Looks for the small state pill near "Race Information"
    const pills = qsAll(".badge, .chip, .pill, .state, [data-badge]");
    const pill = pills.find(p => /idle|ready|extract|analyz|predict/i.test(p.textContent||""));
        if (!pill) return;
    pill.textContent = state;
  }

  // ---------- network ----------
  async function postImageToOCR(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/photo_extract_openai_b64", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OCR HTTP ${res.status}: ${JSON.stringify(json)}`);
    // Accept a few shapes
    return json.text || json.raw || (json.result && json.result.text) || "";
  }

  // ---------- simple OCR parser (robust fallback) ----------
  function parseHorses(raw) {
    // Very defensive: collect lines, strip number prefixes, find odds lines, basic name/jockey/trainer grouping.
    if (!raw) return [];
    const lines = raw.replace(/\r/g, "\n").split("\n").map(x => x.trim()).filter(Boolean);

    const isOdds  = s => /\b\d{1,2}\s*[/\-]\s*\d{1,2}\b/.test(s);
    const stripNo = s => s.replace(/^\s*\d+\.\s*/, "");
    const isNamey = s => /[A-Za-z]/.test(s) && !isOdds(s);

    const out = [];
    for (let i = 0; i < lines.length; i++) {
      let name = stripNo(lines[i]);
      if (!isNamey(name)) continue;

      let odds = "", jockey = "", trainer = "";
      // Scan a small window forward
      for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        const L = lines[j];
        if (!odds && isOdds(L)) { odds = L.match(/\d{1,2}\s*[/\-]\s*\d{1,2}/)[0].replace(/\s*/g,""); continue; }
        if (!jockey && isNamey(L)) { jockey = L; continue; }
        if (!trainer && isNamey(L)) { trainer = L; break; }
      }
      // Sanity: name required
      if (name) out.push({ name, odds, jockey, trainer });
    }
    // De-dupe by name+odds (case-insens)
    const seen = new Set();
    const dedup = [];
    for (const h of out) {
      const k = (h.name||"").toLowerCase() + "|" + (h.odds||"");
      if (!seen.has(k)) { seen.add(k); dedup.push(h); }
    }
    return dedup;
  }

  // ---------- form filling ----------
  async function ensureRow(index) {
    // detect current count using the horse-name input group
    let count = qsAll('input[placeholder="Horse Name"], input[name="horseName"]').length;
    if (count > index) return true;
    const btn = findAddHorseButton();
    if (!btn) return false;
    btn.click();
    // wait for DOM growth up to ~1s
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 50));
      count = qsAll('input[placeholder="Horse Name"], input[name="horseName"]').length;
      if (count > index) return true;
    }
    return false;
  }

  function fillRow(index, horse) {
    // NEVER touch race fields. Only the per-horse inputs:
    const nameEl   = selectFieldAt(index, ['input[placeholder="Horse Name"]', 'input[name="horseName"]']);
    const oddsEl   = selectFieldAt(index, ['input[placeholder*="ML Odds"]', 'input[name="mlOdds"]']);
    const jockeyEl = selectFieldAt(index, ['input[placeholder="Jockey"]', 'input[name="jockey"]']);
    const trainEl  = selectFieldAt(index, ['input[placeholder="Trainer"]', 'input[name="trainer"]']);

    valueSet(nameEl,   horse.name || "");
    valueSet(oddsEl,   horse.odds || "");
    valueSet(jockeyEl, horse.jockey || "");
    valueSet(trainEl,  horse.trainer || "");
  }

  async function populateAll(horses) {
    LOG("Populate horses (count)", horses.length, horses);
    for (let i = 0; i < horses.length; i++) {
      const ok = await ensureRow(i);
      if (!ok) { ERR("Could not ensure row", i); break; }
      fillRow(i, horses[i]);
    }
    LOG("Population complete.");
  }

  // ---------- robust file picker wiring ----------
  let isExtracting = false;
  
  function createHiddenFileInput() {
    // Remove existing hidden input if any
    const existing = document.getElementById("robust-file-input");
    if (existing) existing.remove();
    
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.id = "robust-file-input";
    input.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(input);
    
    input.addEventListener("change", async (e) => {
      console.log("[Picker] File input change event fired");
      const files = e.target.files;
      if (!files || files.length === 0) {
        console.log("[Picker] No files selected");
        return;
      }
      
      const file = files[0];
      console.log("[Picker] Selected file:", { name: file.name, type: file.type, size: file.size });
      
      try {
        isExtracting = true;
        setBadge("Extracting…");
        
        // Convert file to base64
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            const b64 = result.includes(',') ? result.split(',')[1] : result;
            console.log("[Picker] Base64 length:", b64.length);
            resolve(b64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        // Call OCR endpoint
        const resp = await fetch("/api/photo_extract_openai_b64", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ b64: base64 })
        });
        
        const out = await resp.json();
        console.log("[Picker] OCR response:", out);
        
        if (!out.ok) {
          console.error("[Picker] OCR server-error:", out);
          const errorMsg = out.error?.message ?? "unknown";
          alert(`Image extraction failed: ${errorMsg} (see console)`);
          setBadge("Idle");
          return;
        }
        
        const entries = out.data?.entries ?? [];
        console.log("[Picker] Entries to populate:", entries);
        
        if (entries.length === 0) {
          alert("No horses detected in the image. Please try a clearer image or PDF.");
          setBadge("Idle");
          return;
        }
        
        // Convert entries to horses format
        const horses = entries.map(entry => ({
          name: entry.horse || entry.name || '',
          ml_odds: entry.ml || entry.odds || '',
          jockey: entry.jockey || '',
          trainer: entry.trainer || ''
        }));
        
        await populateAll(horses);
        setBadge("Ready to predict");
        
      } catch (err) {
        console.error("[Picker] Uncaught picker error:", err);
        alert("Unexpected error while extracting. See console for details.");
        setBadge("Idle");
      } finally {
        isExtracting = false;
        // Clear input to allow same file selection
        input.value = "";
      }
    });
    
    return input;
  }
  
  function findChooseButton() {
    return document.getElementById("chooseBtn") ||
           document.querySelector('[data-photo-input]') ||
           Array.from(document.querySelectorAll('button')).find(b => 
             /choose.*photos/i.test(b.textContent || ''));
  }
  
  function wireChooseButton() {
    const btn = findChooseButton();
    if (!btn) {
      console.log("[Picker] Choose button not found, retrying...");
      setTimeout(wireChooseButton, 400);
      return;
    }
    
    if (btn.__robust_wired) return;
    btn.__robust_wired = true;
    
    // Create hidden input
    const hiddenInput = createHiddenFileInput();
    
    btn.addEventListener("click", (e) => {
      console.log("[Picker] Choose button clicked");
      e.preventDefault();
      e.stopPropagation();
      
      if (isExtracting) {
        console.log("[Picker] Already extracting, ignoring click");
        return;
      }
      
      // Clear value to allow same file selection
      hiddenInput.value = "";
      hiddenInput.click();
    });
    
    console.log("[Picker] Choose Photos / PDF button wired successfully");
  }
  
  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", wireChooseButton);
  } else {
    wireChooseButton();
  }
  
  // Watch for dynamic content changes
  const observer = new MutationObserver(() => {
    const btn = findChooseButton();
    if (btn && !btn.__robust_wired) {
      wireChooseButton();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  LOG("Hotfix module installed");
  
  // Dev injector function
  window.injectSampleHorses = async function() {
    try {
      console.log("[Dev] Injecting sample horses");
      const sample = [
        { horse: "Clarita", jockey: "Luis Saez", trainer: "Philip A. Bauer", ml: "10/1" },
        { horse: "Absolute Honor", jockey: "Tyler Gaffalione", trainer: "Saffie A. Joseph, Jr.", ml: "5/2" },
        { horse: "Indict", jockey: "Cristian A. Torres", trainer: "Thomas Drury, Jr.", ml: "8/1" },
        { horse: "Jewel Box", jockey: "Luan Machado", trainer: "Ian R. Wilkes", ml: "15/1" },
      ];
      
      const horses = sample.map(entry => ({
        name: entry.horse || entry.name || '',
        ml_odds: entry.ml || entry.odds || '',
        jockey: entry.jockey || '',
        trainer: entry.trainer || ''
      }));
      
      await populateAll(horses);
      alert('✅ Sample horses injected successfully!');
    } catch (err) {
      console.error('Dev injector error:', err);
      alert('❌ Dev injection failed: ' + err.message);
    }
  };
  
  // Show dev button in dev mode
  if (window.location.hostname === 'localhost' || window.location.search.includes('dev=true')) {
    const devBtn = document.getElementById('devInjectBtn');
    if (devBtn) {
      devBtn.style.display = 'inline-block';
    }
  }
// Dev injector button for testing multi-row form filling
(function addDevInjector() {
  if (window.location.hostname === 'localhost' || window.location.search.includes('dev=true')) {
    const devBtn = document.createElement('button');
    devBtn.textContent = '🧪 Test Multi-Row Fill';
    devBtn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:#ff6b6b;color:white;border:none;padding:8px 12px;border-radius:4px;font-size:12px;cursor:pointer;';
    
    devBtn.addEventListener('click', async () => {
      try {
        const sample = [
          { horse: "Clarita", jockey: "Luis Saez", trainer: "Philip A. Bauer", ml: "10/1" },
          { horse: "Absolute Honor", jockey: "Tyler Gaffalione", trainer: "Saffie A. Joseph, Jr.", ml: "5/2" },
          { horse: "Indict", jockey: "Cristian A. Torres", trainer: "Thomas Drury, Jr.", ml: "8/1" },
          { horse: "Jewel Box", jockey: "Luan Machado", trainer: "Ian R. Wilkes", ml: "15/1" },
        ];
        
        const r = await fetch("/api/debug_fill", { 
          method: "POST", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ entries: sample })
        });
        const out = await r.json();
        
        // Convert to horses format
        const horses = out.data.entries.map(entry => ({
          name: entry.horse || entry.name || '',
          ml_odds: entry.ml || entry.odds || '',
          jockey: entry.jockey || '',
          trainer: entry.trainer || ''
        }));
        
        await populateHorses(horses);
        toast('✅ Multi-row test completed!');
      } catch (err) {
        console.error('Dev injector error:', err);
        toast('❌ Dev test failed: ' + err.message);
      }
    });
    
    document.body.appendChild(devBtn);
  }
})();

// ==============================================================================
// ROBUST OCR + MULTI-ROW POPULATION SYSTEM
// ==============================================================================

window.FL_DEBUG = !!(new URLSearchParams(location.search).get('dbg'));

function qs(sel, root=document){ return root.querySelector(sel); }
function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

function getHorseRowsRoot() {
  // Main form container that holds the horse rows; adjust if your markup differs
  const candidates = [
    '[data-horse-rows]',
    '#horse-rows',
    '.horse-rows',
    'form'
  ];
  for (const c of candidates) {
    const el = qs(c);
    if (el) return el;
  }
  return document; // last resort
}

function getRowInputsAt(index){
  // Row inputs by predictable order: name, ml_odds, jockey, trainer
  const rows = qsa('[data-horse-row], .horse-row, .grid-row');
  if (rows.length === 0) return null;
  const r = rows[index] || null;
  if (!r) return null;

  const name   = qs('input[placeholder*="Horse"], input[name*="horse"], input[data-field="name"]', r);
  const odds   = qs('input[placeholder*="Odds"], input[name*="odds"], input[data-field="ml_odds"]', r);
  const jockey = qs('input[placeholder*="Jockey"], input[name*="jockey"], input[data-field="jockey"]', r);
  const trainer= qs('input[placeholder*="Trainer"], input[name*="trainer"], input[data-field="trainer"]', r);

  return {row: r, name, odds, jockey, trainer};
}

function getRaceFieldGuards(){
  return {
    date:    qs('input[type="date"], input[placeholder*="mm/dd"], input[name*="date"]'),
    track:   qs('input[placeholder*="track"], input[name*="track"]'),
    surface: qs('select[name*="surface"], select[placeholder*="surface"], input[placeholder*="surface"]'),
    dist:    qs('input[placeholder*="1 1/4 miles"], input[name*="distance"], select[name*="distance"]')
  };
}

function setBadge(state){
  const badge = qs('[data-badge], .status-badge');
  if (!badge) return;
  const map = {
    idle: 'Idle',
    extracting: 'Extracting…',
    ready: 'Ready to predict',
    error: 'Error'
  };
  badge.textContent = map[state] || state;
}

function toast(msg){
  if (window.FL_DEBUG) console.log('[Toast]', msg);
  alert(msg);
}

async function ensureRowCount(target){
  const addBtn = qs('[data-add-horse], button:has(> span:contains("Add Horse")), button');
  const rowsSel = '[data-horse-row], .horse-row, .grid-row';
  let tries = 0;

  for (;;) {
    const count = qsa(rowsSel).length;
    if (count >= target) return count;
    addBtn?.click();
    await new Promise(r => setTimeout(r, 120));
    tries++;
    if (tries > 60) throw new Error('Timed out creating rows');
  }
}

async function fillRow(index, horse){
  const inputs = getRowInputsAt(index);
  if (!inputs) throw new Error(`Row ${index} not found`);
  const {name, odds, jockey, trainer} = inputs;

  const write = (el, val) => { if (el && val) { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); } };

  write(name,   horse.name    || '');
  write(odds,   horse.ml_odds || '');
  write(jockey, horse.jockey  || '');
  write(trainer,horse.trainer || '');
  await new Promise(r => setTimeout(r, 80));
}

async function populateHorses(horses){
  // Guard: never touch race fields
  const guards = getRaceFieldGuards();
  if (window.FL_DEBUG) console.log('[guards]', guards);

  await ensureRowCount(horses.length);
  for (let i=0; i<horses.length; i++){
    await fillRow(i, horses[i]);
  }
}

async function handleUploadAndExtract(file){
  setBadge('extracting');

  try {
    // Convert file to base64 for the new API format
    const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // Remove data URL prefix if present
        const base64Data = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64Data);
      };
      reader.onerror = reject;
            reader.readAsDataURL(file);
    });

    const resp = await fetch('/api/photo_extract_openai_b64', { 
      method:'POST', 
            headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b64: base64 })
    });
    const out = await resp.json();

    if (window.FL_DEBUG) console.log('[OCR resp]', out);

    if (!out.ok) {
      console.error("[FinishLine OCR] server-error:", out);
      const errorMsg = out.error?.message ?? "unknown";
      toast(`Image extraction failed: ${errorMsg} (see console)`);
      setBadge('error');
      return;
    }

    const entries = out.data?.entries ?? [];
    if (entries.length === 0) {
      setBadge('error');
      toast('No horses detected. Try a clearer image or PDF.');
            return;
        }
        
    // Convert entries to horses format for existing populateHorses function
    const horses = entries.map(entry => ({
      name: entry.horse || entry.name || '',
      ml_odds: entry.ml || entry.odds || '',
      jockey: entry.jockey || '',
      trainer: entry.trainer || ''
    }));

    await populateHorses(horses);
    setBadge('ready');
  } catch (err) {
    console.error("[FinishLine OCR] unexpected error:", err);
    toast(`Unexpected error during extraction: ${err.message}`);
    setBadge('error');
  }
}

// Hook up file input (keep your existing listener, but ensure it calls handleUploadAndExtract)
(function wireUpload(){
  const btn = qs('button, [data-upload], [data-choose-photos]'); // your real selector for "Choose Photos / PDF"
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await handleUploadAndExtract(f);
        } catch (err) {
      console.error(err);
      setBadge('error');
      toast('Unexpected error during extraction.');
    } finally {
      input.value = '';
    }
  });

  if (btn) {
    btn.addEventListener('click', () => input.click());
  }
// Dev injector button for testing multi-row form filling
(function addDevInjector() {
  if (window.location.hostname === 'localhost' || window.location.search.includes('dev=true')) {
    const devBtn = document.createElement('button');
    devBtn.textContent = '🧪 Test Multi-Row Fill';
    devBtn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:#ff6b6b;color:white;border:none;padding:8px 12px;border-radius:4px;font-size:12px;cursor:pointer;';
    
    devBtn.addEventListener('click', async () => {
      try {
        const sample = [
          { horse: "Clarita", jockey: "Luis Saez", trainer: "Philip A. Bauer", ml: "10/1" },
          { horse: "Absolute Honor", jockey: "Tyler Gaffalione", trainer: "Saffie A. Joseph, Jr.", ml: "5/2" },
          { horse: "Indict", jockey: "Cristian A. Torres", trainer: "Thomas Drury, Jr.", ml: "8/1" },
          { horse: "Jewel Box", jockey: "Luan Machado", trainer: "Ian R. Wilkes", ml: "15/1" },
        ];
        
        const r = await fetch("/api/debug_fill", { 
          method: "POST", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ entries: sample })
        });
        const out = await r.json();
        
        // Convert to horses format
        const horses = out.data.entries.map(entry => ({
          name: entry.horse || entry.name || '',
          ml_odds: entry.ml || entry.odds || '',
          jockey: entry.jockey || '',
          trainer: entry.trainer || ''
        }));
        
        await populateHorses(horses);
        toast('✅ Multi-row test completed!');
      } catch (err) {
        console.error('Dev injector error:', err);
        toast('❌ Dev test failed: ' + err.message);
      }
    });
    
    document.body.appendChild(devBtn);
  }
})();