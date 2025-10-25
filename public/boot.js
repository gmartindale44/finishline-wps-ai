// public/boot.js
(() => {
  const VER = "boot@1.1.0";
  const LOG = (...a) => console.log("[BOOT]", ...a);
  const ERR = (...a) => console.error("[BOOT]", ...a);

  // Global error surfacing
  window.addEventListener("error", (e) => {
    ERR("window error:", e?.message, e?.error);
    try { alert(`Script error: ${e?.message || e}`); } catch {}
  });
  window.addEventListener("unhandledrejection", (e) => {
    ERR("unhandled rejection:", e?.reason);
    try { alert(`Unhandled error: ${e?.reason?.message || e?.reason}`); } catch {}
  });

  const $ = (id) => document.getElementById(id);

  function bindOnce(el, type, handler) {
    if (!el) return;
    el.removeEventListener(type, handler);
    el.addEventListener(type, handler);
  }

  function setFilenameLabel(text) {
    const lab = $("file-name-label");
    if (lab) lab.textContent = text || "No file selected.";
  }

  function ensureSingleAddHorse() {
    // Remove accidental duplicates — keep the first #add-horse-btn
    const all = Array.from(document.querySelectorAll("#add-horse-btn"));
    if (all.length > 1) {
      all.slice(1).forEach((n) => n.parentNode && n.parentNode.removeChild(n));
      LOG("Removed duplicate Add Horse buttons:", all.length - 1);
    }
  }

  async function postPhoto(file) {
    // Send as multipart form data for Node.js function
    const fd = new FormData();
    fd.append("file", file);
    LOG("POST /api/photo_extract_openai_b64 size=", file.size, "type=", file.type);

    const res = await fetch("/api/photo_extract_openai_b64", { 
      method: "POST", 
      body: fd
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OCR API ${res.status}: ${txt || res.statusText}`);
    }
    return res.json();
  }

  function populateHorsesFromExtraction(payload) {
    // Do not touch race date / track / surface / distance
    // Handle API response format: {ok: true, horses: [...]}
    const horses = payload?.horses || payload?.data?.entries || payload?.entries || [];
    if (!Array.isArray(horses) || horses.length === 0) {
      LOG("No horses found in payload; payload keys:", Object.keys(payload || {}));
      alert("No horses found in OCR result.");
      return;
    }

    // Use app-level helper if present:
    if (window.finishline && typeof window.finishline.populateFromExtraction === "function") {
      LOG("Delegating to finishline.populateFromExtraction");
      window.finishline.populateFromExtraction(payload);
      return;
    }

    // Minimal safe filler (append rows + fill) — never touch the race fields.
    const nameInputSel   = 'input[name="horse_name"]';
    const oddsInputSel   = 'input[name="horse_odds"]';
    const jockeyInputSel = 'input[name="horse_jockey"]';
    const trainerInputSel= 'input[name="horse_trainer"]';

    const addBtn = $("add-horse-btn");
    if (!addBtn) {
      ERR("Missing #add-horse-btn; cannot append rows");
      return;
    }

    // Helper: adds a row by clicking the app's button so the native layout is respected
    function addRow() { addBtn.click(); }

    // Locate the last row inputs (most apps append at the end)
    function lastRowInputs() {
      const names   = document.querySelectorAll(nameInputSel);
      const odds    = document.querySelectorAll(oddsInputSel);
      const jockeys = document.querySelectorAll(jockeyInputSel);
      const trainers= document.querySelectorAll(trainerInputSel);
      const idx = Math.max(names.length, odds.length, jockeys.length, trainers.length) - 1;
      return {
        name: names[idx], odds: odds[idx], jockey: jockeys[idx], trainer: trainers[idx]
      };
    }

    horses.forEach((h, i) => {
      addRow();
      const { name, odds, jockey, trainer } = normalizeHorse(h);
      const inputs = lastRowInputs();
      if (inputs.name)    inputs.name.value    = name;
      if (inputs.odds)    inputs.odds.value    = odds;
      if (inputs.jockey)  inputs.jockey.value  = jockey;
      if (inputs.trainer) inputs.trainer.value = trainer;
    });

    function normalizeHorse(h) {
      // Be flexible on keys from OCR
      const name    = h.name    || h.horse   || h.horse_name   || "";
      const odds    = h.odds    || h.ml      || h.morning_line || "";
      const jockey  = h.jockey  || h.rider   || "";
      const trainer = h.trainer || h.handler || "";
      return { name, odds, jockey, trainer };
    }
  }

  function initUI() {
    LOG(`initUI ${VER}`);
    ensureSingleAddHorse();

    const btnPick = $("choose-photos-btn");
    const input   = $("photo-input-main");
    const btnAna  = $("analyze-btn");
    const btnPre  = $("predict-btn");
    const btnAdd  = $("add-horse-btn");

    [btnPick, btnAna, btnPre, btnAdd].forEach(b => b && b.removeAttribute("disabled"));

    bindOnce(btnPick, "click", () => {
      LOG("Choose clicked");
      if (!input) { alert("File input not found"); return; }
      input.click();
    });

    bindOnce(input, "change", async (ev) => {
      try {
        const f = ev?.target?.files?.[0];
        if (!f) { setFilenameLabel("No file selected."); return; }
        setFilenameLabel(`${f.name} (${(f.size/1024).toFixed(1)} KB)`);
        // Post and populate
        const json = await postPhoto(f);
        LOG("OCR response:", json);
        populateHorsesFromExtraction(json);
      } catch (e) {
        ERR("file change handler:", e);
        alert(`Image extraction failed: ${e?.message || e}`);
      } finally {
        // Allow re-selecting the same file later
        try { ev.target.value = ""; } catch {}
      }
    });

    bindOnce(btnAna, "click", () => {
      LOG("Analyze clicked");
      // Optional: trigger the same as choose if no file chosen yet
      alert("Analyze is wired. Use Choose Photos / PDF to select a file.");
    });

    bindOnce(btnPre, "click", () => {
      LOG("Predict clicked");
      alert("Predict is wired. (Model call not shown here.)");
    });

    bindOnce(btnAdd, "click", () => LOG("Add Horse clicked"));

    const debug = new URLSearchParams(location.search).get("debug") === "ui";
    if (debug) {
      LOG("debug=ui elements:", { btnPick, input, btnAna, btnPre, btnAdd });
      const badge = document.createElement("div");
      badge.textContent = "UI DEBUG MODE";
      Object.assign(badge.style, { position:"fixed", right:"8px", bottom:"8px", padding:"4px 6px", background:"#2b2d31", color:"#fff", fontSize:"12px", borderRadius:"4px", zIndex:99999 });
      document.body.appendChild(badge);
    }

    LOG("UI wired successfully.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUI, { once:true });
  } else {
    initUI();
  }
})();

/* finishline-picker-wireup.js */
(function () {
  const log = (...a) => console.log("[FinishLine]", ...a);
  const err = (...a) => console.error("[FinishLine]", ...a);

  /* SAFE element finders */
  function byDataAction(action) {
    return document.querySelector(`[data-action="${action}"]`);
  }
  function buttonByText(regex) {
    return Array.from(document.querySelectorAll('button')).find(b => regex.test(b.textContent || ''));
  }

  /* REQUIRED elements (prefer data-action; then fall back to text) */
  const inputFile =
    document.getElementById('photo-input-main') ||
    document.querySelector('input[type="file"][accept*="image"], input[type="file"][accept*="pdf"]');

  /* Choose button: prefer data-action="choose"; fallback to common button text */
  const btnChoose =
    byDataAction('choose') ||
    document.querySelector('.photo-picker-label') ||      // if you kept the <label for="photo-input-main">
    buttonByText(/choose (photos|photo)|upload|choose file/i);

  /* Analyze button: prefer data-action="analyze"; fallback to text match */
  const btnAnalyze =
    byDataAction('analyze') ||
    buttonByText(/analyze photos with ai/i);

  /* Optional status chip */
  const statusChip =
    document.querySelector('[data-status]') ||
    document.querySelector('.status-chip') ||
    document.querySelector('.chip-status') ||
    null;

  /* Guard: log clearly if something is missing, but do not use unsupported selectors */
  if (!inputFile) {
    console.error("[FinishLine] file input not found. Add: <input id='photo-input-main' type='file' accept='image/*,.pdf' />");
  }
  if (!btnAnalyze) {
    console.error("[FinishLine] analyze button not found. Add data-action='analyze' to the 'Analyze Photos with AI' button.");
  }
  if (!btnChoose) {
    console.warn("[FinishLine] choose button not found (label click may still open the dialog). Add data-action='choose' for deterministic wiring.");
  }

  /* Minimal wiring example (keep if missing) */
  let selectedFile = null;
  let extracting = false;

  function setStatus(txt){ if(statusChip) statusChip.textContent = txt; }

  if (inputFile) {
    inputFile.addEventListener('change', (e) => {
      selectedFile = (e.target.files && e.target.files[0]) || null;
      console.log("[FinishLine] onFilesSelected:", selectedFile && { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type });
      if (btnAnalyze) btnAnalyze.disabled = !selectedFile;
    });
  }

  if (btnChoose && inputFile) {
    btnChoose.addEventListener('click', () => {
      if (extracting) return;
      console.log("[FinishLine] Choose clicked → opening dialog");
      inputFile.value = "";      // allow re-select same file
      inputFile.click();
    });
  }

  async function postOCR(file){
    const fd = new FormData();
    fd.append("file", file, file.name || "upload");
    console.log("[FinishLine] POST /api/photo_extract_openai_b64", {name:file.name, size:file.size, type:file.type});
    const res = await fetch("/api/photo_extract_openai_b64", { method:"POST", body: fd });
    const ct = res.headers.get("content-type") || "";
    const data = /application\/json/.test(ct) ? await res.json() : await res.text();
    if (!res.ok || (data && data.ok === false)) {
      const msg = (data && (data.detail || data.error)) || res.statusText || "OCR failed";
      const rid = data && data.reqId;
      throw new Error(`${msg}${rid ? " | reqId="+rid : ""}`);
    }
    return data;
  }

  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', async () => {
      if (!selectedFile || extracting) return;
      try {
        extracting = true; setStatus("Extracting…"); btnAnalyze.disabled = true;
        const data = await postOCR(selectedFile);
        console.log("[FinishLine] OCR response:", data);
        // expect data.horses = [{name, odds, jockey, trainer}, ...]
        if (data && Array.isArray(data.horses)) {
          if (typeof window.populateHorseForm === "function") {
            data.horses.forEach((h,i)=>{ try{ window.populateHorseForm(h,i); }catch(e){ console.error(e);} });
          } else {
            // fallback: fill first row and click "Add Horse" (by text) for the rest
            const addBtn = buttonByText(/add horse/i);
            const rows = () => document.querySelectorAll('[data-horse-row], .horse-row, .horse-line');
            function fillRow(i,h){
              const r = rows()[i] || document;
              (r.querySelector('input[placeholder*="Horse"]')  || document.querySelector('input[placeholder*="Horse"]'))?.value  = h.name    || "";
              (r.querySelector('input[placeholder*="Odds"]')   || document.querySelector('input[placeholder*="Odds"]'))?.value   = h.odds    || "";
              (r.querySelector('input[placeholder*="Jockey"]') || document.querySelector('input[placeholder*="Jockey"]'))?.value = h.jockey  || "";
              (r.querySelector('input[placeholder*="Trainer"]')|| document.querySelector('input[placeholder*="Trainer"]'))?.value= h.trainer || "";
            }
            data.horses.forEach((h,i)=>{ if(i>0 && addBtn) addBtn.click(); fillRow(i,h); });
          }
        } else {
          console.warn("[FinishLine] No horses returned.");
        }
        setStatus("Ready to predict");
      } catch (e) {
        console.error("[FinishLine] OCR error:", e);
        alert(e.message || "OCR failed");
        setStatus("Idle");
      } finally {
        extracting = false;
        if (btnAnalyze) btnAnalyze.disabled = !selectedFile;
      }
    });
  }

  setStatus("Idle");
  console.log("[FinishLine] Safe selector wire-up ready");
})();