/**
 * FinishLine AI - Frontend Application
 * Handles form submission, API calls, and result display
 */

// API Configuration
const LOCAL_API = "http://localhost:8000";
const SAME_ORIGIN = "";
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const API_BASE = isLocal ? LOCAL_API : SAME_ORIGIN;

// --- Photo picker state ---
window.PICKED_FILES = window.PICKED_FILES || [];
const MAX_FILES = 6;

function updatePhotoCount() {
  const el = document.getElementById("photo-count");
  if (el) el.textContent = `${(window.PICKED_FILES || []).length} / ${MAX_FILES} selected`;
}

function renderThumbs() {
  const wrap = document.getElementById("thumbs");
  if (!wrap) { console.warn("[FinishLine] #thumbs not found"); return; }
  wrap.innerHTML = "";
  (window.PICKED_FILES || []).forEach((file, idx) => {
    const item = document.createElement("div");
    item.className = "thumb";
    if (file.type === "application/pdf") {
      item.innerHTML = `
        <div class="pdf-badge">PDF</div>
        <div class="thumb-meta">
          <span class="name" title="${file.name}">${file.name}</span>
          <button class="remove" aria-label="Remove">✕</button>
        </div>`;
    } else {
      const url = URL.createObjectURL(file);
      item.innerHTML = `
        <img src="${url}" alt="${file.name}" />
        <div class="thumb-meta">
          <span class="name" title="${file.name}">${file.name}</span>
          <button class="remove" aria-label="Remove">✕</button>
        </div>`;
      item.querySelector("img").onload = () => URL.revokeObjectURL(url);
    }
    item.querySelector(".remove").onclick = () => {
      window.PICKED_FILES.splice(idx, 1);
      updatePhotoCount();
      renderThumbs();
    };
    wrap.appendChild(item);
  });
  updatePhotoCount();
}

function addPickedFiles(list) {
  if (!list) return;
  const incoming = Array.from(list);
  console.log("[FinishLine] addPickedFiles got", incoming.map(f => ({name:f.name, type:f.type, size:f.size})));
  for (const f of incoming) {
    if (window.PICKED_FILES.length >= MAX_FILES) break;
    if (!/^image\//.test(f.type) && f.type !== "application/pdf") continue;
    window.PICKED_FILES.push(f);
  }
  renderThumbs();
}

function normalizeOddsString(s) {
  if (!s) return "";
  const raw = String(s).trim().toLowerCase().replace(/\s+/g, " ");
  const m = raw.match(/^(\d+)\s*(\/|-|:|\s*to\s*)\s*(\d+)$/i);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[3]);
    if (b > 0) return `${a}/${b}`;
  }
  const num = Number(raw);
  if (!Number.isNaN(num) && num > 0) return `${num}`;
  return s.trim();
}

function cleanHorseName(name) {
  if (!name) return "";
  let n = String(name).trim();
  // split lines like "Flyin Ryan\nImprobable"
  n = n.split(/\r?\n/)[0];
  // remove obvious sire fragments after a comma or slash
  n = n.replace(/\s*\/.*$/, "").replace(/,\s*.+$/, "");
  return n.trim();
}

function createHorseRow() {
  const row = document.createElement('div');
  row.className = 'horse-row';
  row.setAttribute('data-row', 'horse');
  row.setAttribute('data-horse-row', '0');
  row.innerHTML = `
    <input type="text" class="horse-name name" data-field="name" placeholder="Horse Name" />
    <input type="text" class="horse-odds odds" data-field="odds" placeholder="ML Odds (e.g., 5-2)" />
    <input type="text" class="horse-jockey jj" data-field="jockey" placeholder="Jockey" />
    <input type="text" class="horse-trainer tt" data-field="trainer" placeholder="Trainer" />
    <input type="number" class="horse-bankroll" data-field="bankroll" placeholder="Bankroll" value="1000" />
    <input type="number" class="horse-kelly" data-field="kelly_fraction" placeholder="Kelly (0.25)" value="0.25" step="0.01" />
  `;
  return row;
}

function getHorseList() {
  return document.getElementById('horse-list');
}

function getHorseRows() {
  return Array.from(document.querySelectorAll('[data-row="horse"]'));
}

function ensureRowCount(n) {
  const addBtn = document.getElementById('add-horse-btn') || document.getElementById('btnAddHorse') || document.getElementById('add-horse');
  if (!addBtn) { console.warn('[FinishLine] add-horse-btn not found'); return; }
  let rows = getHorseRows().length;
  while (rows < n) {
    addBtn.click();
    rows = getHorseRows().length;
  }
  if (getHorseRows().length < n) {
    console.warn(`[FinishLine] ensureRowCount wanted ${n} rows but only created ${getHorseRows().length}`);
  }
}

function readRow(i) {
  const row = document.querySelector(`[data-horse-row="${i}"]`);
  if (!row) return null;
  return {
    name: row.querySelector('.horse-name')?.value?.trim() || "",
    trainer: row.querySelector('.horse-trainer')?.value?.trim() || "",
    jockey: row.querySelector('.horse-jockey')?.value?.trim() || "",
    odds: row.querySelector('.horse-odds')?.value?.trim() || "",
    bankroll: Number(row.querySelector('.horse-bankroll')?.value || 0) || 0,
    kelly_fraction: Number(row.querySelector('.horse-kelly')?.value || 0) || 0,
  };
}

function writeRow(idx, h) {
  const rows = getHorseRows();
  const row = rows[idx];
  if (!row) {
    console.warn(`[FinishLine] writeRow: row ${idx} not found (have ${rows.length} rows)`);
    return;
  }
  const set = (sel, v) => {
    const el = row.querySelector(sel);
    if (el) {
      el.value = v ?? '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      console.warn(`[FinishLine] writeRow ${idx}: selector "${sel}" not found`);
    }
  };
  // Normalize odds to fraction format (e.g., 8/1, 5-2 → 5/2)
  const oddsStr = (h.odds ?? h.ml_odds ?? '').toString().replace(/\s+/g, '').replace('-', '/');
  set('input[placeholder="Horse Name"]', h.name ?? '');
  set('input[placeholder^="ML Odds"]', oddsStr);
  set('input[placeholder="Jockey"]', h.jockey ?? '');
  set('input[placeholder="Trainer"]', h.trainer ?? '');
}

function gatherFormHorses() {
  const rows = document.querySelectorAll('[data-horse-row]');
  const out = [];
  rows.forEach(r => {
    const name = r.querySelector('.horse-name')?.value?.trim() || "";
    if (!name) return;
    out.push({
      name,
      trainer: r.querySelector('.horse-trainer')?.value?.trim() || "",
      jockey:  r.querySelector('.horse-jockey')?.value?.trim() || "",
      odds:    r.querySelector('.horse-odds')?.value?.trim() || "",
      bankroll: Number(r.querySelector('.horse-bankroll')?.value || 0) || 0,
      kelly_fraction: Number(r.querySelector('.horse-kelly')?.value || 0) || 0,
    });
  });
  return out;
}

function getRowParts(row) {
  const qf = (field) => row.querySelector(`[data-field="${field}"]`);
  return {
    nameEl:     qf('name'),
    oddsEl:     qf('odds'),
    jockeyEl:   qf('jockey'),
    trainerEl:  qf('trainer'),
    bankrollEl: qf('bankroll'),
    kellyEl:    qf('kelly'),
  };
}

function setRowValues(row, data) {
  const { nameEl, oddsEl, jockeyEl, trainerEl } = getRowParts(row);
  if (nameEl && data.name)   nameEl.value = data.name;
  if (oddsEl && data.odds)   oddsEl.value = data.odds;
  if (jockeyEl)              jockeyEl.value = data.jockey || '';
  if (trainerEl)             trainerEl.value = data.trainer || '';
}

function insertIntoForm(extracted) {
  if (!Array.isArray(extracted) || !extracted.length) return;
  // grow rows as needed
  const list = document.getElementById('horse-list');
  let rows = getHorseRows();
  while (rows.length < extracted.length) {
    list?.appendChild(createHorseRow());
    rows = getHorseRows();
  }
  extracted.forEach((h, i) => {
    const row = rows[i]; if (!row) return;
    const { nameEl, oddsEl, jockeyEl, trainerEl } = getRowParts(row);
    if (nameEl && h.name)   nameEl.value = h.name;
    if (oddsEl && h.odds)   oddsEl.value = h.odds;
    if (jockeyEl)           jockeyEl.value = h.jockey || '';
    if (trainerEl)          trainerEl.value = h.trainer || '';
  });
  const firstRow = getHorseRows()[0];
  if (firstRow?.scrollIntoView) firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  console.log('[FinishLine] OCR inserted', extracted.length, 'horses into form');
}

function parseHorsesFromText(txt) {
  const lines = txt.replace(/\r/g,"\n").split("\n").map(s=>s.trim()).filter(Boolean);

  const horses = [];
  const nameLike = /^[A-Za-z][A-Za-z''\-.\s]+$/;
  const mlLike = /^(\d{1,2}\s*[-/]\s*\d{1,2})$/; // 5-2, 3/1 etc.
  const personInit = /^[A-Z]\.\s?[A-Za-z''\-]+$/; // e.g., D. Parker, E. Paucar

  for (let i=0; i<lines.length; i++) {
    const L = lines[i];

    // skip headers
    if (/^(#|horse|jockey|trainer|weight|win|place|show|race|post|purse|claiming|dirt|turf|fast|firm|good|allowance)/i.test(L)) continue;
    if (/^\d+$/.test(L)) continue; // isolated program no.

    const isName = nameLike.test(L) && L.length>=3 && L.length<=40;
    if (!isName) continue;

    // look-ahead for odds/jockey/trainer nearby
    let odds = "", jockey = "", trainer = "";

    // same line tokens for odds
    for (const t of L.split(/\s+/)) { if (mlLike.test(t)) { odds = t; break; } }
    // next lines for odds/jockey/trainer
    const peek = (k)=> (i+k<lines.length ? lines[i+k] : "");
    const L1 = peek(1), L2 = peek(2), L3 = peek(3);

    if (!odds && mlLike.test(L1)) { odds = L1; i++; }
    // jockey often formatted "D. Parker" above trainer
    if (personInit.test(L1)) { jockey = L1; if (!odds && mlLike.test(L2)) { odds = L2; i++; } }
    // trainer is often an initial+surname too; try next
    if (!trainer && personInit.test(L2)) trainer = L2;
    if (!trainer && personInit.test(L3)) trainer = L3;

    // push
    if (!horses.some(h => h.name.toLowerCase()===L.toLowerCase())) {
      horses.push({ name: L, odds, jockey, trainer });
    }
  }

  // Fallback if nothing
  if (horses.length===0) {
    const m = txt.match(/[A-Z][a-zA-Z''\-]+(?:\s+[A-Z][a-zA-Z''\-]+){0,3}/g) || [];
    Array.from(new Set(m)).slice(0, 6).forEach(n => horses.push({ name:n, odds:"", jockey:"", trainer:"" }));
  }
  return horses.slice(0, 12);
}

async function ocrImagesWithTesseract(files) {
  const T = window.Tesseract;
  if (!T) throw new Error("OCR engine not loaded");
  // Only images (skip PDFs for now)
  const imgs = Array.from(files || []).filter(f => /^image\//.test(f.type));
  const results = [];
  for (const f of imgs) {
    const url = URL.createObjectURL(f);
    try {
      const { data } = await T.recognize(url, "eng", { logger: () => {} });
      if (data && data.text) results.push(data.text);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return results.join("\n");
}

function renderOcrReview(list) {
  const box = document.getElementById("ocr-review");
  const wrap = document.getElementById("ocr-items");
  if (!box || !wrap) return;
  wrap.innerHTML = "";
  list.forEach((h, idx) => {
    const row = document.createElement("div");
    row.className = "ocr-row";
    row.innerHTML = `
      <input type="checkbox" ${h.checked ? "checked" : ""} />
      <input type="text" class="name" value="${h.name}" />
      <input type="text" class="odds" placeholder="e.g., 5-2" value="${h.odds || ""}" />
    `;
    const [chk, nameEl, oddsEl] = row.querySelectorAll("input");
    chk.onchange = () => { h.checked = chk.checked; };
    nameEl.oninput = () => { h.name = nameEl.value; };
    oddsEl.oninput = () => { h.odds = oddsEl.value; };
    wrap.appendChild(row);
  });
  box.classList.remove("hidden");
}

function collectHorsesForPredict() {
  const rows = getHorseRows();
  const horses = rows.map(row => {
    const { nameEl, oddsEl, jockeyEl, trainerEl, bankrollEl, kellyEl } = getRowParts(row);
    return {
      name: (nameEl?.value || '').trim(),
      odds: (oddsEl?.value || '').trim(),
      jockey: (jockeyEl?.value || '').trim(),
      trainer: (trainerEl?.value || '').trim(),
      bankroll: parseFloat(bankrollEl?.value || '0') || 0,
      kelly_fraction: parseFloat(kellyEl?.value || '0.25') || 0.25
    };
  }).filter(h => h.name); // keep only rows with a name
  console.log('[FinishLine] collected horses:', horses);
  return horses;
}

function getHorseRows_OLD() {
  return Array.from(document.querySelectorAll('[data-horse-row]'));
}

function ensureRowCount_OLD(n) {
  let rows = getHorseRows();
  const addBtn = document.getElementById('add-horse') || Array.from(document.querySelectorAll('button')).find(b => /add horse/i.test(b.textContent));
  while (rows.length < n && addBtn) {
    addBtn.click();
    rows = getHorseRows();
  }
  return rows;
}

function getRowParts_OLD(row) {
  // Prefer data-field mapping; fallback to class/placeholder if needed
  const q = (sel) => row.querySelector(sel);
  const byField = (f) => row.querySelector(`[data-field="${f}"]`);
  const nameEl = byField('name')     || q('.name')   || q('input[placeholder*="Horse"]');
  const oddsEl = byField('odds')     || q('.odds')   || q('input[placeholder*="Odds"]');
  const jockeyEl = byField('jockey') || q('.jj')     || q('input[placeholder*="Jockey"]');
  const trainerEl= byField('trainer')|| q('.tt')     || q('input[placeholder*="Trainer"]');
  const bankrollEl = byField('bankroll') || q('input[placeholder*="Bankroll"]');
  const kellyEl    = byField('kelly')    || q('input[placeholder*="Kelly"]');
  return { nameEl, oddsEl, jockeyEl, trainerEl, bankrollEl, kellyEl };
}

function setRowValues(row, data) {
  const { nameEl, oddsEl, jockeyEl, trainerEl } = getRowParts(row);
  if (nameEl && data.name)   nameEl.value = data.name;
  if (oddsEl && data.odds)   oddsEl.value = data.odds;
  if (jockeyEl)              jockeyEl.value = data.jockey || '';
  if (trainerEl)             trainerEl.value = data.trainer || '';
}

function insertIntoForm_OLD(extracted) {
  if (!Array.isArray(extracted) || extracted.length === 0) return;
  // Make sure there are enough rows
  const rows = ensureRowCount(extracted.length);
  // Fill rows in order
  extracted.forEach((h, i) => {
    if (!rows[i]) return;
    setRowValues(rows[i], h);
  });
  // Optional: scroll to form
  const firstRow = getHorseRows()[0];
  if (firstRow && firstRow.scrollIntoView) firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// DOM Elements
const raceForm = document.getElementById('raceForm');
const horsesContainer = document.getElementById('horsesContainer') || document.getElementById('horse-list');
const addHorseBtn = document.getElementById('addHorseBtn');
const predictBtn = document.getElementById('predictBtn');
const photoPredictBtn = document.getElementById('photoPredictBtn');
const photoSection = document.getElementById('photoSection');
const photoInput = document.getElementById('photoInput');
const selectPhotosBtn = document.getElementById('selectPhotosBtn');
const photoPreview = document.getElementById('photoPreview');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    console.log('FinishLine AI initialized');
    
    // Set dynamic year in footer
    const yearEl = document.getElementById("year"); 
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('raceDate').value = today;
    
    // Wire Add Horse button with canonical template
    const addBtn = document.getElementById('add-horse') || document.getElementById('btnAddHorse');
    const list = getHorseList();
    if (addBtn && list) {
        addBtn.onclick = () => list.appendChild(createHorseRow());
    }
    
    // Wire photo extraction with robust debugging
    const fileInput = document.getElementById('photoFiles') || document.getElementById('photo-input');
    const btnChoose = document.getElementById('btnChoosePhotos');
    const btnExtract = document.getElementById('btnExtract') || document.getElementById('ocr-extract-btn');
    const btnPredict = document.getElementById('btnPredict') || document.getElementById('predictBtn');
    const btnAnalyze = document.getElementById('btnAnalyze') || document.getElementById('analyze-photos-btn');
    
    const API_URL = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
    
    function log(...args) { console.debug("[FinishLine]", ...args); }
    
    if (btnChoose && fileInput) {
      btnChoose.addEventListener('click', () => {
        log("btnChoose clicked, opening file picker");
        fileInput.click();
      });
    }
    
    function toast(msg, t="info"){ (window.showToast && showToast(msg, t)) || console.log(`[${t}] ${msg}`); }
    function uniqBy(arr, keyFn){ const s=new Set(); return arr.filter(x=>{const k=keyFn(x); if(s.has(k)) return false; s.add(k); return true;}); }

    function splitTrainerJockey(obj) {
      if (!obj) return obj;
      if (!obj.trainer && !obj.jockey && obj.trainer_jockey) {
        // Expect patterns like "Kathy Jarvis / Jose Ramos Gutierrez"
        const parts = obj.trainer_jockey.split('/').map(s => s.trim());
        if (parts.length === 2) { obj.trainer = parts[0]; obj.jockey = parts[1]; }
      }
      return obj;
    }

    // === ROBUST OCR → FORM POPULATION HELPERS ===
    
    // Find the "Add Horse" button in a resilient way
    function findAddHorseButton() {
      return document.querySelector("#add-horse, #addHorse, #add-horse-btn, #btnAddHorse, button[data-add-horse], [data-role='add-horse']")
          || Array.from(document.querySelectorAll("button")).find(b => /add\s*horse/i.test(b.textContent || ""));
    }

    // Return a NodeList of current horse rows (works with TR or DIV rows)
    function getHorseRows() {
      const candidates = [
        "[data-horse-row]",
        "[data-row='horse']",
        ".horse-row",
        "#horses tbody tr",
        ".row-horse"
      ];
      for (const sel of candidates) {
        const list = document.querySelectorAll(sel);
        if (list && list.length) return list;
      }
      // Fallback: if there is exactly one visible row with the input set, treat container as a row
      const nameInput = document.querySelector("input.horse-name, input[name*='name' i]");
      return nameInput ? [nameInput.closest("tr, .horse-row, [data-horse-row], .row")] : [];
    }

    // Ensure at least n rows exist by clicking Add Horse
    async function ensureUiRowCount(n) {
      const addBtn = findAddHorseButton();
      if (!addBtn) {
        console.warn("Add Horse button not found; cannot create rows");
        return;
      }
      for (let guard = 0; guard < 100 && countHorseRows() < n; guard++) {
        addBtn.click();
        await new Promise(r => setTimeout(r, 30)); // allow DOM to inject the row
      }
    }

    // Ensure a specific row index exists (creates rows one by one as needed)
    async function ensureRowAtIndex(i) {
      const addBtn = findAddHorseButton();
      if (!addBtn) {
        console.warn("Add Horse button not found; cannot create rows");
        return;
      }
      // Click until we have at least i+1 rows
      for (let guard = 0; guard < 200; guard++) {
        const have = countHorseRows();
        if (have >= i + 1) return;
        addBtn.click();
        // small delay for DOM to insert
        await new Promise(r => setTimeout(r, 30));
      }
      console.warn("ensureRowAtIndex: hit guard before creating row", i);
    }

    // Given a row element, return the best-guess inputs
    function pickRowFields(rowEl) {
      const pick = (selArr) => {
        for (const sel of selArr) {
          const el = rowEl.querySelector(sel);
          if (el) return el;
        }
        return null;
      };
      // Heuristics for field names/classes; extend if needed
      const name   = pick([".horse-name", ".name", "input[data-field='name']", "input[name*='name' i]"]);
      const odds   = pick([".horse-odds", ".odds", "input[data-field='odds']", "input[name*='odd' i]"]);
      const bnkr   = pick([".horse-bankroll", "input[data-field='bankroll']", "input[name*='bank' i]"]);
      const kelly  = pick([".horse-kelly", "input[data-field='kelly_fraction']", "input[name*='kelly' i]"]);
      const trainer= pick([".horse-trainer", ".tt", "input[data-field='trainer']", "input[name*='train' i]"]);
      const jockey = pick([".horse-jockey", ".jj", "input[data-field='jockey']", "input[name*='jock' i]"]);
      return { name, odds, bnkr, kelly, trainer, jockey };
    }

    // Normalize ML odds like "7-2", "7 to 2", "7:2" -> "7/2"
    function normalizeFractionalOdds(raw) {
      if (!raw) return "";
      let s = String(raw).trim().toUpperCase()
        .replaceAll("–","-").replaceAll("—","-")
        .replaceAll(" TO ","/").replaceAll("TO","/")
        .replaceAll(":", "/").replace(/\s+/g,"");
      const m = s.match(/^(\d+)[\/\-](\d+)$/);
      return m ? `${parseInt(m[1],10)}/${parseInt(m[2],10)}` : s;
    }

    // Coerce horses[] even if backend serialized it as a string
    function coerceHorsesArray(horses) {
      if (Array.isArray(horses)) return horses;
      if (typeof horses === "string") {
        try { const arr = JSON.parse(horses); if (Array.isArray(arr)) return arr; } catch {}
      }
      return [];
    }

    // ---------- Row discovery / cloning ----------
    // Get the first row's inputs (used as the cloning template)
    function getFirstRowInputs() {
      const name = document.querySelector('input[placeholder="Horse Name"]');
      const odds = document.querySelector('input[placeholder^="ML Odds"]');
      const bankroll = document.querySelector('input[type="number"][value="1000"]') ||
                       document.querySelector('input[type="number"]');
      const kelly = document.querySelector('input[type="number"][value="0.25"]') ||
                    document.querySelector('input[type="number"]');
      return { name, odds, bankroll, kelly };
    }

    // Find the DOM container that holds one "row" by walking up from the name input
    function findRowContainerFrom(el) {
      if (!el) return null;
      let node = el;
      for (let i = 0; i < 8 && node; i++) {
        const hasName = node.querySelector?.('input[placeholder="Horse Name"]');
        const hasOdds = node.querySelector?.('input[placeholder^="ML Odds"]');
        const nums = node.querySelectorAll?.('input[type="number"]');
        if (hasName && hasOdds && nums?.length >= 2) return node;
        node = node.parentElement;
      }
      return null;
    }

    // Where to append new rows? -> directly after the last existing row container
    function findRowsParent(rowContainer) {
      return rowContainer?.parentElement || rowContainer;
    }

    // Count current rows by counting row containers
    function getRowContainers() {
      const first = findRowContainerFrom(getFirstRowInputs().name);
      if (!first) return [];
      const parent = findRowsParent(first);
      return Array.from(parent.children).filter(el =>
        el.querySelector?.('input[placeholder="Horse Name"]') &&
        el.querySelector?.('input[placeholder^="ML Odds"]')
      );
    }

    // Clone the first row container, clear inputs, append after last row
    function cloneRow() {
      const firstInputs = getFirstRowInputs();
      const firstRow = findRowContainerFrom(firstInputs.name);
      const parent = findRowsParent(firstRow);
      if (!firstRow || !parent) {
        console.warn("Could not locate row template/parent for cloning.");
        return null;
      }
      const clone = firstRow.cloneNode(true);
      // Clear inputs in the clone
      clone.querySelectorAll("input").forEach(inp => {
        if (inp.type === "checkbox" || inp.type === "radio") {
          inp.checked = false;
        } else if (inp.type === "number") {
          // keep bankroll/kelly defaults if they look like defaults
          if (inp.value !== "1000" && inp.value !== "0.25") inp.value = "";
        } else {
          inp.value = "";
        }
      });
      parent.appendChild(clone);
      return clone;
    }

    // Ensure at least n rows exist by cloning the first row
    async function ensureRowCountByCloning(n) {
      for (let guard = 0; guard < 100; guard++) {
        const rows = getRowContainers();
        if (rows.length >= n) return;
        cloneRow();
        await new Promise(r => setTimeout(r, 10));
      }
      console.warn("Row cloning guard hit before reaching desired count:", n);
    }

    // Retrieve inputs for row i (after cloning)
    function getRowInputsByIndex(i) {
      const rows = getRowContainers();
      const row = rows[i];
      if (!row) return {};
      const name     = row.querySelector('input[placeholder="Horse Name"]');
      const odds     = row.querySelector('input[placeholder^="ML Odds"]');
      const trainer  = row.querySelector('input[placeholder="Trainer"], input[placeholder*="Trainer" i]') || null;
      const jockey   = row.querySelector('input[placeholder="Jockey"], input[placeholder*="Jockey" i]') || null;
      const numbers  = Array.from(row.querySelectorAll('input[type="number"]'));
      const bankroll = numbers[0] || null;
      const kelly    = numbers[1] || null;
      return { name, odds, bankroll, kelly, trainer, jockey };
    }

    // Canonical writer using cloning strategy with visual feedback
    async function populateFormFromParsed(parsed) {
      const horses = coerceHorsesArray(parsed).filter(h => (h?.name || "").trim());
      if (!horses.length) { console.warn("populateFormFromParsed: empty"); return; }

      await ensureRowCountByCloning(horses.length);

      for (let i = 0; i < horses.length; i++) {
        const h = horses[i] || {};
        const f = getRowInputsByIndex(i);
        if (f.name)     f.name.value     = h.name ?? "";
        if (f.odds)     f.odds.value     = normalizeFractionalOdds(h.odds ?? h.ml_odds ?? "");
        if (f.bankroll) f.bankroll.value = (h.bankroll ?? 1000);
        if (f.kelly)    f.kelly.value    = (h.kelly_fraction ?? 0.25);
        if (f.trainer)  f.trainer.value  = h.trainer ?? "";
        if (f.jockey)   f.jockey.value   = h.jockey ?? "";

        // Briefly highlight the populated row to draw attention
        const rowEl = getRowContainers()[i];
        if (rowEl) {
          rowEl.classList.add("filled-flash");
          setTimeout(() => rowEl.classList.remove("filled-flash"), 1000);
        }
      }

      console.log(`📝 Filled ${horses.length} rows via cloning.`);

      // Smooth scroll to the horses section
      const card = document.getElementById("horse-card");
      if (card?.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });

      // Minimal toast message
      (function showToast(msg){
        const el = document.createElement("div");
        el.textContent = msg;
        el.style.cssText = `position:fixed;bottom:16px;right:16px;padding:10px 12px;border-radius:10px;
          background:#2563eb;color:white;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:14px`;
        document.body.appendChild(el); setTimeout(()=>el.remove(), 2200);
      })(`Filled ${horses.length} horses`);
    }

    async function callPhotoExtract(fd){
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      const endpoints = [`${base}/photo_extract_openai`, `${base}/photo_predict`];
      for (const url of endpoints) {
        try { const r = await fetch(url, { method: "POST", body: fd }); if (r.ok) return await r.json(); }
        catch(e){}
      }
      throw new Error("No OCR endpoint available");
    }

    // Helper: file to data URL
    function fileToDataURL(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }
    
    // Helper: fetch with timeout
    // Client-side timeout helper with AbortController (hard timeout)
    async function fetchWithTimeout(resource, options = {}, timeoutMs = 25000) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(resource, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(id);
      }
    }
    
    // Alert helper to show raw payload for debugging
    function alertRaw(title, raw) {
      alert(`${title}\n\nRAW:\n${raw.substring(0, 4000)}`);
    }
    
    // Guarded Extract function with in-flight protection
    let extractInFlight = false;
    
    async function extractFromPhotos() {
      if (extractInFlight) {
        console.warn("⏳ Extract already in flight — ignored duplicate request");
        return;
      }
      
      const input = document.getElementById("photoFiles") || document.getElementById("photo-input");
      const btn = document.getElementById("btnExtract") || document.getElementById("btn-extract");
      
      if (!input || !input.files || input.files.length === 0) {
        alert("Choose an image first.");
        return;
      }

      const f = input.files[0];
      if (!/^image\//.test(f.type)) {
        alert("Please upload a PNG or JPG image of the race table.");
        return;
      }

      extractInFlight = true;
      const originalLabel = btn?.textContent || "Extract from Photos";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Extracting…";
      }

      console.time("extract_total");
      try {
        // Step 1: Read file to data URL
        console.time("read_file");
        const dataURL = await fileToDataURL(f);
        console.timeEnd("read_file");

        const payload = { filename: f.name, mime: f.type || "image/png", data_b64: dataURL };
        console.log("📤 OCR upload (b64):", payload.filename, payload.mime);

        // Step 2: Fetch with timeout
        console.time("fetch_ocr");
        const resp = await fetchWithTimeout("/api/finishline/photo_extract_openai_b64", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }, 25000);
        console.timeEnd("fetch_ocr");

        // Step 3: Read response body
        console.time("read_body");
        const raw = await resp.text();
        console.timeEnd("read_body");
        console.log("📥 Raw OCR response:", raw);

        // SHOW RAW PAYLOAD FOR DEBUGGING (remove after diagnosis)
        alertRaw("Server responded", raw);

        // Try to parse as JSON
        let data;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          console.error("❌ Non-JSON:", e);
          toast("OCR returned non-JSON (see console)", "error");
          alert("OCR returned non-JSON. See console for details.");
          return;
        }

        // If server surfaced an error string, show it verbatim
        if (data?.error) {
          console.warn("⚠️ OCR error:", data.error);
          toast(`OCR error: ${data.error}`, "error");
          alert(`OCR error: ${data.error}`);
          return;
        }

        // Expect: { horses: [...] } - handle both array and stringified JSON
        {
          const horses = coerceHorsesArray(data?.horses);
          if (horses.length) {
            console.log(`✅ Parsed ${horses.length} horses`);
            await populateFormFromParsed(horses);
            toast(`Filled ${horses.length} horses`, "success");
          } else {
            console.warn("⚠️ No horses parsed", data);
            toast("No horses parsed (see console)", "error");
            alert(`No horses parsed.\n\n${JSON.stringify(data, null, 2)}`);
          }
        }
      } catch (e) {
        console.error("❌ Extract failed (timeout/network):", e);
        toast("Extract failed", "error");
        alert(`Extraction failed: ${String(e?.message || e)}`);
      } finally {
        console.timeEnd("extract_total");
        extractInFlight = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalLabel;
        }
      }
    }

    async function doPredict(endpoint){
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      const horses = gatherFormHorses();
      if (!horses.length) { toast("Please add at least one horse.","error"); return; }
      
      // Race context fields
      const raceDate = document.getElementById('raceDate')?.value || "";
      const track = document.getElementById('raceTrack')?.value || document.getElementById('track')?.value || "";
      const surface = document.getElementById('raceSurface')?.value || document.getElementById('surface')?.value || "";
      const distance = document.getElementById('raceDistance')?.value || document.getElementById('distance')?.value || "";
      
      const payload = {
        horses,
        race_context: { raceDate, track, surface, distance },
        useResearch: endpoint === 'research_predict'
      };
      
      // For research endpoint, request websearch with longer timeout
      if (endpoint === 'research_predict') {
        payload.provider = "websearch";
        payload.timeout_ms = 45000;  // 45s for websearch
      }
      
      console.log(`[FinishLine] ${endpoint} payload:`, payload);
      
      // Helper to call endpoint once
      const runOnce = async (body) => {
        const resp = await fetch(`${base}/${endpoint}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        const raw = await resp.text();
        console.log(`📥 Predict raw (${resp.status}):`, raw);
        let data = null;
        try { data = JSON.parse(raw); } catch {}
        return { ok: resp.ok, status: resp.status, statusText: resp.statusText, data, raw };
      };
      
      try {
        let { ok, status, statusText, data, raw } = await runOnce(payload);
        
        // Auto-retry fallback: if websearch timed out, retry with stub
        if (!ok && status === 504 && payload.provider === "websearch") {
          console.warn("⏱️ Websearch timed out; retrying with stub provider");
          (function showToast(msg){
            const el = document.createElement("div");
            el.textContent = msg;
            el.style.cssText = `position:fixed;bottom:16px;right:16px;padding:10px 12px;border-radius:10px;
              background:#7c3aed;color:white;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:14px`;
            document.body.appendChild(el); setTimeout(()=>el.remove(), 2500);
          })(`Websearch timed out — running quick local model…`);
          
          const fallback = { ...payload, provider: "stub", timeout_ms: 10000 };
          ({ ok, status, statusText, data, raw } = await runOnce(fallback));
        }
        
        if (!ok) {
          // Try to parse as JSON error
          if (data?.error) {
            // Structured error from backend
            let msg = `${status} ${statusText}\n\n${data.error}`;
            if (data.hint) msg += `\n\n💡 ${data.hint}`;
            if (data.how_to_fix) msg += `\n\n🔧 Fix: ${data.how_to_fix}`;
            
            // Include useful extras if present
            const extras = ["provider", "has_tavily_key", "has_openai_key", "shape", "exception", "detail", "timeout_ms"];
            const found = extras.filter(k => k in data);
            if (found.length) {
              msg += "\n\n" + found.map(k => `${k}: ${JSON.stringify(data[k])}`).join("\n");
            }
            
            console.error(`❌ Predict ${status}:`, data);
            toast(`Analyze failed (${status})`, "error");
            alert(`Analyze failed:\n${msg}`);
          } else {
            // Fallback to raw text
            const preview = raw.substring(0, 300);
            console.error("predict error", status, raw);
            toast(`Prediction failed (${status})`, "error");
            alert(`Prediction failed (${status})\n\n${preview}`);
          }
          return;
        }
        
        // Success path
        if (!data) {
          alert("Predict returned non-JSON. See console.");
          return;
        }
        
        console.log(`✅ ${endpoint} response:`, data);
        displayResults(data);
      } catch (e) {
        console.error(e);
        toast(`Prediction error: ${e.message}`, "error");
        alert(`Prediction error: ${e.message}`);
      }
    }
    
    // Developer helper: test OCR from URL
    window.debugExtractFromUrl = async function(url) {
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      try {
        const r = await fetch(`${base}/photo_extract_openai_url`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url })
        });
        const data = await r.json();
        const debugEl = document.getElementById('ocr-debug-json');
        if (debugEl) {
          debugEl.textContent = JSON.stringify(data, null, 2);
          document.getElementById('ocr-debug')?.setAttribute('open', 'true');
        }
        console.log("[debugExtractFromUrl] response:", data);
        const rows = data?.parsed_horses || [];
        if (rows.length) {
          populateFormFromParsed(rows);
          toast(`Extracted ${rows.length} horses from URL.`, "success");
        } else {
          toast("No horses extracted from URL.", "warn");
        }
      } catch (e) {
        console.error(e);
        toast(`URL extract failed: ${e.message}`, "error");
      }
    };
    
    // Fetch and display runtime config
    (async function loadRuntimeConfig() {
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      try {
        const r = await fetch(`${base}/debug_info`);
        if (r.ok) {
          const info = await r.json();
          const el = document.getElementById('runtime-config');
          if (el) {
            el.textContent = `Provider: ${info.provider} · OCR: ${info.ocr_enabled} · OpenAI: ${info.openai_present ? '✓' : '✗'} · Tavily: ${info.tavily_present ? '✓' : '✗'}`;
          }
        }
      } catch (e) {
        console.warn("Could not load runtime config:", e);
      }
    })();

    // Bind extract handler ONCE with guard
    if (fileInput && !fileInput.__extractBound) {
      fileInput.__extractBound = true;
      fileInput.addEventListener('change', () => {
        if (fileInput.files?.length) extractFromPhotos();
      });
    }
    
    if (btnExtract && !btnExtract.__extractBound) {
      btnExtract.__extractBound = true;
      btnExtract.addEventListener('click', extractFromPhotos);
    }
    
    if (btnAnalyze && !btnAnalyze.__analyzeBound) {
      btnAnalyze.__analyzeBound = true;
      btnAnalyze.addEventListener('click', ()=> doPredict('research_predict'));
    }
    
    if (btnPredict && !btnPredict.__predictBound) {
      btnPredict.__predictBound = true;
      btnPredict.addEventListener('click', ()=> doPredict('predict'));
    }
    
    // Helper to safely log and parse JSON responses
    function logAndParseJson(resp) {
      return resp.text().then(txt => {
        console.log("📥 Raw OCR response:", txt);
        try { return JSON.parse(txt); }
        catch (e) {
          console.error("❌ Non-JSON response:", e);
          alert("OCR returned non-JSON. See console for details.");
          return null;
        }
      });
    }
    
    // Debug: Extract by URL (bind once)
    const btnExtractUrl = document.getElementById("btn-extract-url");
    if (btnExtractUrl && !btnExtractUrl.__extractUrlBound) {
      btnExtractUrl.__extractUrlBound = true;
      btnExtractUrl.addEventListener("click", async () => {
        const urlInput = document.getElementById("debug-ocr-url");
        const url = urlInput?.value.trim();
        if (!url) { alert("Paste a direct image URL first."); return; }

        console.log("🌐 OCR by URL:", url);
        btnExtractUrl.disabled = true;
        btnExtractUrl.textContent = "Extracting…";
        
        try {
          const resp = await fetch("/api/finishline/photo_extract_openai_url", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url })
          });

          const data = await logAndParseJson(resp);
          if (!data) return;
          
          // Display in debug panel
          const debugEl = document.getElementById('ocr-debug-json');
          if (debugEl) debugEl.textContent = JSON.stringify(data, null, 2);

          if (Array.isArray(data?.horses) && data.horses.length) {
            console.log(`✅ Parsed ${data.horses.length} horses from URL`);
            populateFormFromParsed(data.horses);
            toast(`Filled ${data.horses.length} horses (URL)`, "success");
          } else {
            toast("No horses parsed from URL", "error");
            alert(`No horses parsed.\nServer response:\n${JSON.stringify(data, null, 2)}`);
          }
        } catch (e) {
          console.error("❌ Network/timeout calling OCR URL endpoint:", e);
          toast("Request failed (see console)", "error");
          alert("Request failed (network/timeout). See console.");
        } finally {
          btnExtractUrl.disabled = false;
          btnExtractUrl.textContent = "Extract (URL)";
        }
      });
    }
    
    // Debug: Load Demo DRF (bind once)
    const btnLoadDemo = document.getElementById("btn-load-demo");
    if (btnLoadDemo && !btnLoadDemo.__loadDemoBound) {
      btnLoadDemo.__loadDemoBound = true;
      btnLoadDemo.addEventListener("click", () => {
        const demo = [
          { name:"Cosmic Connection", odds:"6/1", trainer:"Debbie Schaber", jockey:"Huber Villa-Gomez", bankroll:1000, kelly_fraction:0.25 },
          { name:"Dancing On Air",   odds:"10/1", trainer:"Wendy Uhacz",   jockey:"Francisco Garcia",  bankroll:1000, kelly_fraction:0.25 },
          { name:"Double Up Larry",  odds:"5/2", trainer:"Randall R. Russell", jockey:"Gaddiel A. Martinez", bankroll:1000, kelly_fraction:0.25 },
          { name:"Gruit",            odds:"20/1", trainer:"Mary R. McKinley", jockey:"Kris Fox",        bankroll:1000, kelly_fraction:0.25 },
          { name:"Mr. Impatient",    odds:"7/2", trainer:"Kevin Rice",     jockey:"Israel O. Rodriguez", bankroll:1000, kelly_fraction:0.25 },
          { name:"Shannonia",        odds:"6/5", trainer:"Teresa Connelly", jockey:"Willie Martinez",  bankroll:1000, kelly_fraction:0.25 }
        ];
        console.log("🧪 Loading demo DRF list", demo);
        populateFormFromParsed(demo);
        toast("Loaded 6 demo horses", "success");
      });
    }
    
    // Developer console helper for testing OCR by URL
    window.debugExtractFromUrl = async function(url) {
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      try {
        const r = await fetch(`${base}/photo_extract_openai_url`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const j = await r.json();
        console.log('[debugExtractFromUrl] OCR parsed:', j.parsed_horses ?? j.horses ?? j);
        const debugEl = document.getElementById('ocr-debug-json');
        if (debugEl) {
          debugEl.textContent = JSON.stringify(j, null, 2);
          document.getElementById('ocr-debug')?.setAttribute('open', 'true');
        }
        populateFormFromParsed(j.parsed_horses ?? j.horses ?? []);
        return j;
      } catch (e) {
        console.error('[debugExtractFromUrl] Error:', e);
        throw e;
      }
    };
    
    // Developer helper: test population pipeline with stub
    window.devPopulateFromStub = async function() {
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      try {
        const resp = await fetch(`${base}/echo_stub`);
        const data = await resp.json();
        if (Array.isArray(data?.horses) && data.horses.length) {
          populateFormFromParsed(data.horses);
          console.log("[devPopulateFromStub] Populated", data.horses.length, "horses from stub");
        } else {
          console.warn("[devPopulateFromStub] Stub returned no horses");
        }
      } catch (e) {
        console.error("[devPopulateFromStub] Error:", e);
      }
    };
    
    // Event listeners (fallback)
    if (addHorseBtn) addHorseBtn.addEventListener('click', addHorseEntry);
    if (predictBtn && !btnPredict) predictBtn.addEventListener('click', handlePredict);
    
    // Photo picker wiring moved to bottom of file for reliability

    // OCR event listeners - wire to canonical insertIntoForm immediately
    const ocrBtn = document.getElementById("ocr-extract-btn");
    const insertBtn = document.getElementById("ocr-insert");
    if (ocrBtn) {
        ocrBtn.addEventListener("click", async () => {
            if ((window.PICKED_FILES || []).length === 0) {
                const inputEl = document.getElementById("photo-input");
                if (inputEl) inputEl.click();
                return;
            }
            try {
                showLoading();
                const text = await ocrImagesWithTesseract(window.PICKED_FILES);
                const horses = parseHorsesFromText(text);
                if (horses.length === 0) {
                    showError("OCR didn't find any horses. Try a clearer crop.");
                    hideLoading();
                    return;
                }
                insertIntoForm(horses);
                window.__OCR_LAST__ = horses;
                hideLoading();
                console.log("[FinishLine] OCR extracted and inserted", horses.length, "horses");
            } catch (e) {
                showError(`OCR failed: ${e.message || e}`);
                hideLoading();
            }
        });
    }
    if (insertBtn) {
        insertBtn.addEventListener("click", () => {
            const list = window.__OCR_LAST__ || [];
            insertIntoForm(list);
            const box = document.getElementById("ocr-review");
            if (box) box.classList.add("hidden");
        });
    }
    
    // Fallback for old addHorseEntry if needed
    // addHorseEntry();
});

/**
 * Collect horse data from form - use canonical approach
 */
function collectHorseData() {
    return collectHorsesForPredict();
}

/**
 * OLD: Add a new horse entry to the form (for compatibility)
 */
function addHorseEntry() {
    const horseEntry = document.createElement('div');
    horseEntry.className = 'horse-entry';
    const rowNum = horsesContainer.children.length + 1;
    horseEntry.setAttribute('data-horse-row', rowNum);
    horseEntry.innerHTML = `
        <div class="form-row">
            <div class="form-group">
                <label>Horse Name</label>
                <input type="text" class="name" data-field="name" name="horseName" placeholder="e.g., Thunderstride" required>
            </div>
            <div class="form-group">
                <label>Odds</label>
                <input type="text" class="odds" data-field="odds" name="odds" placeholder="e.g., 5-2" required>
            </div>
            <div class="form-group">
                <label>Jockey</label>
                <input type="text" class="jj jockey" data-field="jockey" name="jockey" placeholder="Jockey (optional)">
            </div>
            <div class="form-group">
                <label>Trainer</label>
                <input type="text" class="tt trainer" data-field="trainer" name="trainer" placeholder="Trainer (optional)">
            </div>
            <div class="form-group">
                <label>Bankroll</label>
                <input type="number" data-field="bankroll" name="bankroll" placeholder="1000" value="1000" min="1" required>
            </div>
            <div class="form-group">
                <label>Kelly Fraction</label>
                <input type="number" data-field="kelly" name="kellyFraction" placeholder="0.25" value="0.25" min="0" max="1" step="0.01" required>
            </div>
        </div>
        <button type="button" class="btn-secondary remove-horse" style="margin-top: 0.5rem;">Remove Horse</button>
    `;
    
    horsesContainer.appendChild(horseEntry);
    
    // Add remove functionality
    const removeBtn = horseEntry.querySelector('.remove-horse');
    removeBtn.addEventListener('click', () => {
        if (horsesContainer.children.length > 1) {
            horseEntry.remove();
        }
    });
}

/**
 * Handle photo selection
 */
function handlePhotoSelection(event) {
    const files = Array.from(event.target.files);
    
    if (files.length > 6) {
        showError('Maximum 6 photos allowed');
        return;
    }
    
    // Clear previous preview
    photoPreview.innerHTML = '';
    
    // Show preview for each file
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.alt = file.name;
                photoPreview.appendChild(img);
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Show photo section
    photoSection.style.display = 'block';
}

/**
 * Handle regular prediction
 */
async function handlePredict() {
    try {
        const horses = collectHorsesForPredict();
        
        if (!horses.length) {
            showError('Please add at least one horse');
            return;
        }
        
        const payload = {
            date: (document.querySelector('input[name="raceDate"]')?.value || document.getElementById('raceDate')?.value || '').trim(),
            track: (document.querySelector('input[name="track"]')?.value || document.getElementById('track')?.value || '').trim(),
            surface: (document.querySelector('select[name="surface"]')?.value || document.getElementById('surface')?.value || '').trim(),
            distance: (document.querySelector('input[name="distance"]')?.value || document.getElementById('distance')?.value || '').trim(),
            horses
        };
        
        console.log('[FinishLine] POST /predict payload:', payload);
        
        showLoading();
        hideError();
        hideResults();
        
        const res = await fetch(`${API_BASE}/api/finishline/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json().catch(() => ({}));
        console.log('[FinishLine] /predict response:', res.status, data);
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        displayResults(data);
        
    } catch (error) {
        console.error('[FinishLine] Prediction error:', error);
        showError(`Prediction failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * Handle photo prediction
 */
async function handlePhotoPredict() {
    try {
        const files = Array.from(photoInput.files);
        
        if (files.length === 0) {
            showError('Please select at least one photo');
            return;
        }
        
        showLoading();
        hideError();
        hideResults();
        
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });
        
        const response = await fetch(`${API_BASE}/api/finishline/photo_predict`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayResults(data);
        
    } catch (error) {
        console.error('Photo prediction error:', error);
        showError(`Photo analysis failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * Collect horse data from form
 */
function collectHorseData() {
    const horses = [];
    const horseEntries = horsesContainer.querySelectorAll('.horse-entry');
    
    horseEntries.forEach(entry => {
        const name = entry.querySelector('input[name="horseName"]').value.trim();
        const odds = entry.querySelector('input[name="odds"]').value.trim();
        const jockey = entry.querySelector('input[name="jockey"]')?.value.trim() || "";
        const trainer = entry.querySelector('input[name="trainer"]')?.value.trim() || "";
        const bankroll = parseFloat(entry.querySelector('input[name="bankroll"]').value);
        const kellyFraction = parseFloat(entry.querySelector('input[name="kellyFraction"]').value);
        
        if (name && odds && !isNaN(bankroll) && !isNaN(kellyFraction)) {
            horses.push({
                name,
                odds,
                jockey,
                trainer,
                bankroll,
                kelly_fraction: kellyFraction
            });
        }
    });
    
    return horses;
}

/**
 * Display prediction results
 */
function displayResults(data) {
    const { win, place, show } = data;
    
    // Update WIN card
    document.getElementById('winName').textContent = win.name;
    document.getElementById('winOdds').textContent = `Odds: ${win.odds}`;
    document.getElementById('winProb').textContent = `Probability: ${(win.prob * 100).toFixed(1)}%`;
    document.getElementById('winKelly').textContent = `Kelly: ${(win.kelly * 100).toFixed(1)}%`;
    document.getElementById('winRationale').textContent = win.rationale || 'AI analysis complete';
    
    // Update PLACE card
    document.getElementById('placeName').textContent = place.name;
    document.getElementById('placeOdds').textContent = `Odds: ${place.odds}`;
    document.getElementById('placeProb').textContent = `Probability: ${(place.prob * 100).toFixed(1)}%`;
    document.getElementById('placeKelly').textContent = `Kelly: ${(place.kelly * 100).toFixed(1)}%`;
    document.getElementById('placeRationale').textContent = place.rationale || 'AI analysis complete';
    
    // Update SHOW card
    document.getElementById('showName').textContent = show.name;
    document.getElementById('showOdds').textContent = `Odds: ${show.odds}`;
    document.getElementById('showProb').textContent = `Probability: ${(show.prob * 100).toFixed(1)}%`;
    document.getElementById('showKelly').textContent = `Kelly: ${(show.kelly * 100).toFixed(1)}%`;
    document.getElementById('showRationale').textContent = show.rationale || 'AI analysis complete';
    
    // Show results with animation
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Show loading state
 */
function showLoading() {
    loadingSection.style.display = 'block';
    loadingSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide loading state
 */
function hideLoading() {
    loadingSection.style.display = 'none';
}

/**
 * Show error message
 */
function showError(message) {
    errorText.textContent = message;
    errorSection.style.display = 'block';
    errorSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide error message
 */
function hideError() {
    errorSection.style.display = 'none';
}

/**
 * Hide results section
 */
function hideResults() {
    resultsSection.style.display = 'none';
}

/**
 * Test API connectivity
 */
async function testAPI() {
    try {
        const response = await fetch(`${API_BASE}/api/finishline/health`);
        const data = await response.json();
        console.log('API Health Check:', data);
        return data.status === 'ok';
    } catch (error) {
        console.error('API Health Check Failed:', error);
        return false;
    }
}

// Test API on load
testAPI();

// Robust photo picker wiring
(function wirePhotoPicker() {
  function attach() {
    const input = document.getElementById("photo-input");
    const drop = document.getElementById("drop-zone");
    const analyzeBtn = document.getElementById("analyze-photos-btn");
    if (!input) { console.warn("[FinishLine] #photo-input not found yet"); return false; }

    // Always handle change, and reset value so picking the same file twice works
    input.onchange = () => {
      addPickedFiles(input.files);
      input.value = ""; // critical for repeat selection of same file
    };

    if (drop) {
      ["dragenter","dragover"].forEach(evt =>
        drop.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); drop.classList.add("dragging"); })
      );
      ["dragleave","drop"].forEach(evt =>
        drop.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("dragging"); })
      );
      drop.addEventListener("drop", e => addPickedFiles(e.dataTransfer.files));
      drop.addEventListener("click", () => input.click());
    }

    if (analyzeBtn) {
      analyzeBtn.addEventListener("click", async () => {
        if ((window.PICKED_FILES || []).length === 0) {
          console.log("[FinishLine] analyze clicked with 0 files → opening chooser");
          input.click();
          return;
        }
        console.log("[FinishLine] analyze clicked with", window.PICKED_FILES.length, "files");
        try {
          const form = new FormData();
          window.PICKED_FILES.slice(0, MAX_FILES).forEach(f => form.append("files", f, f.name));
          const res = await fetch(`${API_BASE}/api/finishline/photo_predict`, {
            method: "POST",
            body: form
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          displayResults(data);
        } catch (err) {
          showError(`Photo analysis failed: ${err.message || err}`);
        }
      });
    }

    console.log("[FinishLine] photo picker wired");
    return true;
  }

  if (!attach()) {
    // Try again on DOM ready
    document.addEventListener("DOMContentLoaded", attach);
  }
})();
