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

  // Controls (adjust selectors if needed)
  const btnChoose = document.querySelector('.photo-picker-label, button[data-action="choose"]') 
                 || document.querySelector('button:has(span.picker-text)');
  const inputFile = document.getElementById('photo-input-main') 
                 || document.querySelector('input[type="file"][accept*="image"], input[type="file"][accept*="pdf"]');
  const btnAnalyze = document.querySelector('button[data-action="analyze"], button:has(> span:contains("Analyze Photos with AI"))')
                   || Array.from(document.querySelectorAll('button')).find(b => /Analyze Photos with AI/i.test(b.textContent));
  const statusChip = document.querySelector('[data-status], .status-chip, .chip-status') 
                  || document.querySelector('button[aria-live], .status'); // fallback

  if (!inputFile || !btnAnalyze) {
    err("Picker/Analyze controls not found. inputFile:", !!inputFile, "btnAnalyze:", !!btnAnalyze);
    return;
  }

  // State
  let selectedFile = null;
  let extracting = false;

  // Helpers
  const setIdle = () => {
    extracting = false;
    btnAnalyze.disabled = !selectedFile;
    if (statusChip) statusChip.textContent = "Idle";
    document.body.dataset.extracting = "0";
  };

  const setExtracting = () => {
    extracting = true;
    btnAnalyze.disabled = true;
    if (statusChip) statusChip.textContent = "Extracting…";
    document.body.dataset.extracting = "1";
  };

  const setDone = () => {
    extracting = false;
    btnAnalyze.disabled = !selectedFile;
    if (statusChip) statusChip.textContent = "Ready to predict";
    document.body.dataset.extracting = "0";
  };

  // Call backend
  async function postOCR(file) {
    const url = "/api/photo_extract_openai_b64";
    const fd = new FormData();
    fd.append("file", file, file.name || "upload");

    log("POST", url, { name: file.name, size: file.size, type: file.type });

    const res = await fetch(url, { method: "POST", body: fd });
    const ct = res.headers.get("content-type") || "";
    let data = null;
    try {
      data = /application\/json/.test(ct) ? await res.json() : await res.text();
    } catch (e) {
      err("Failed to parse response", e);
    }

    if (!res.ok || !data || data.ok === false) {
      const detail = (data && (data.detail || data.error)) || res.statusText;
      const reqId = data && data.reqId;
      throw new Error(`OCR failed (${res.status}). ${detail || "Unknown error"}${reqId ? " | reqId="+reqId : ""}`);
    }
    return data;
  }

  // Populate horses incrementally
  function populateHorses(horses) {
    const list = Array.isArray(horses) ? horses : [];
    if (!list.length) {
      log("No horses parsed from OCR");
      return;
    }
    log("Populating horses", list.length, list);

    // Use existing helper if present
    if (typeof window.populateHorseForm === "function") {
      list.forEach((h, idx) => {
        try { window.populateHorseForm(h, idx); } catch (e) { err("populateHorseForm error", e); }
      });
      return;
    }

    // Fallback: fill first row, then click Add Horse and fill subsequent rows
    const addBtn = Array.from(document.querySelectorAll("button")).find(b => /Add Horse/i.test(b.textContent));
    function fillRow(i, horse) {
      const rows = document.querySelectorAll('[data-horse-row], .horse-row, .horse-line');
      const row = rows[i] || rows[rows.length - 1] || document;
      const name = row.querySelector('input[placeholder*="Horse"]') || document.querySelector('input[placeholder*="Horse"]');
      const odds = row.querySelector('input[placeholder*="Odds"]') || document.querySelector('input[placeholder*="Odds"]');
      const jockey = row.querySelector('input[placeholder*="Jockey"]') || document.querySelector('input[placeholder*="Jockey"]');
      const trainer = row.querySelector('input[placeholder*="Trainer"]') || document.querySelector('input[placeholder*="Trainer"]');

      if (name) name.value = horse.name || "";
      if (odds) odds.value = horse.odds || "";
      if (jockey) jockey.value = horse.jockey || "";
      if (trainer) trainer.value = horse.trainer || "";
    }

    list.forEach((h, i) => {
      if (i > 0 && addBtn) addBtn.click();
      fillRow(i, h);
    });
  }

  // Events
  inputFile.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    selectedFile = f || null;
    log("onFilesSelected", !!selectedFile, selectedFile && { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type });
    if (selectedFile) {
      btnAnalyze.disabled = false;
      // optional: show filename somewhere
      const info = document.querySelector('[data-file-name]');
      if (info) info.textContent = selectedFile.name;
    } else {
      btnAnalyze.disabled = true;
    }
  });

  btnAnalyze.addEventListener("click", async () => {
    if (!selectedFile || extracting) return;
    try {
      setExtracting();
      const data = await postOCR(selectedFile);
      log("OCR response", data);
      if (data && data.horses) populateHorses(data.horses);
      setDone();
    } catch (e) {
      err(e.message || e);
      setIdle();
      alert(e.message || "OCR failed");
    }
  });

  // Optional: auto-run OCR immediately after choosing a file (uncomment if desired)
  // inputFile.addEventListener("change", () => {
  //   if (selectedFile && !extracting) btnAnalyze.click();
  // });

  // If your Choose button is a custom element not tied to the input directly, keep this
  if (btnChoose && !btnChoose.hasAttribute("for")) {
    btnChoose.addEventListener("click", () => {
      if (!extracting) {
        log("Choose clicked → opening dialog");
        inputFile.value = "";
        inputFile.click();
      }
    });
  }

  // Initial state
  setIdle();
  log("Picker/Analyze wireup ready");
})();