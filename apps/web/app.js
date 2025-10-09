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

    function populateFormFromParsed(parsed) {
      if (!Array.isArray(parsed) || !parsed.length) {
        console.warn('[FinishLine] populateFormFromParsed: empty or invalid input');
        return;
      }
      console.log(`[FinishLine] populateFormFromParsed: ${parsed.length} horses`);
      const cleaned = parsed.map(splitTrainerJockey);
      ensureRowCount(cleaned.length);
      cleaned.forEach((h, i) => {
        const normalized = {
          name: (h.name || "").split("\n")[0].trim(),
          trainer: (h.trainer || "").split("\n")[0].trim(),
          jockey: (h.jockey || "").split("\n")[0].trim(),
          odds: (h.ml_odds || h.odds || "").trim(),
        };
        writeRow(i, normalized);
      });
      console.log(`[FinishLine] populateFormFromParsed: wrote ${cleaned.length} rows`);
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
    async function fetchWithTimeout(resource, options = {}, timeoutMs = 25000) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(t);
        return resp;
      } catch (e) {
        clearTimeout(t);
        throw e;
      }
    }
    
    async function extractFromPhotos() {
      const files = fileInput?.files || [];
      if (!files.length) { toast("Please select at least one photo/PDF.", "error"); return; }
      
      const f = files[0];
      if (!/^image\//.test(f.type)) {
        toast("Please upload a PNG/JPG image.", "error");
        return;
      }
      
      console.log(`[FinishLine] extractFromPhotos: encoding ${f.name} (${f.type})`);
      const dataURL = await fileToDataURL(f);
      
      const payload = {
        filename: f.name,
        mime: f.type || "image/png",
        data_b64: dataURL
      };
      
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      
      let resp;
      try {
        console.log(`[FinishLine] POSTing to ${base}/photo_extract_openai_b64`);
        resp = await fetchWithTimeout(`${base}/photo_extract_openai_b64`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }, 25000);
      } catch (e) {
        console.error("[FinishLine] Request aborted or network error:", e);
        toast("Extraction request timed out or was blocked.", "error");
        return;
      }
      
      const ct = resp.headers.get("content-type") || "";
      if (!resp.ok || !ct.includes("application/json")) {
        const text = await resp.text();
        console.error("[FinishLine] Unexpected response:", text.slice(0, 500));
        toast("Extraction failed (see console).", "error");
        return;
      }
      
      const data = await resp.json();
      console.log(`[FinishLine] Response:`, data);
      
      const debugEl = document.getElementById('ocr-debug-json');
      if (debugEl) debugEl.textContent = JSON.stringify(data, null, 2);
      
      let rows = data?.horses || data?.parsed_horses || data?.rows || [];
      if (!Array.isArray(rows)) rows = [];
      
      rows = rows.map(r => ({
        name: (r.name || r.horse || "").split("\n")[0].trim(),
        trainer: (r.trainer || "").split("\n")[0].trim(),
        jockey: (r.jockey || "").split("\n")[0].trim(),
        odds: (r.odds || r.ml_odds || "").trim(),
      })).filter(r => r.name && r.odds);
      rows = uniqBy(rows, h => h.name.toLowerCase());
      
      if (!rows.length) {
        toast("No rows were detected in the photo. Try cropping tighter around the table.", "error");
        return;
      }
      
      console.log(`[FinishLine] Populating ${rows.length} horses into form`);
      populateFormFromParsed(rows);
      toast(`Extracted ${rows.length} horses from photos.`, "success");
    }

    async function doPredict(endpoint){
      const base = (window.FINISHLINE_API_BASE || "/api/finishline").replace(/\/$/, "");
      const horses = gatherFormHorses();
      if (!horses.length) { toast("Please add at least one horse.","error"); return; }
      const payload = {
        date: document.getElementById('raceDate')?.value || "",
        track: document.getElementById('raceTrack')?.value || "",
        surface: document.getElementById('raceSurface')?.value || "",
        distance: document.getElementById('raceDistance')?.value || "",
        horses
      };
      try {
        const r = await fetch(`${base}/${endpoint}`, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(payload) });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          const preview = text.substring(0, 160);
          console.error("predict error", r.status, text);
          toast(`Prediction failed (${r.status}): ${preview}`, "error");
          return;
        }
        const j = await r.json();
        displayResults(j);
      } catch (e) {
        console.error(e);
        toast(`Prediction error: ${e.message}`, "error");
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

    if (fileInput) fileInput.addEventListener('change', ()=> fileInput.files?.length && extractFromPhotos());
    if (btnExtract) btnExtract.addEventListener('click', extractFromPhotos);
    if (btnAnalyze) btnAnalyze.addEventListener('click', ()=> doPredict('research_predict'));
    if (btnPredict) btnPredict.addEventListener('click', ()=> doPredict('predict'));
    
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
