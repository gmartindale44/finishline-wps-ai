// FinishLine WPS AI — Hardened Photo Picker Bootstrap with Incremental Population
// - Creates/ensures a hidden file input
// - Opens the OS picker via global click delegation
// - Handles file upload + OCR + incremental horse population
// - Provides comprehensive logging and error handling
(function () {
  if (window.__finishline_picker_bootstrapped__) return;
  window.__finishline_picker_bootstrapped__ = true;

  function log(...args) { console.log("[FLDBG]", ...args); }
  function warn(...args) { console.warn("[FLDBG]", ...args); }
  function error(...args) { console.error("[FLDBG]", ...args); }

  // DOM element selectors
  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const ids = {
    chooseBtn:  '#photo-choose-btn',
    fileInput:  '#photo-input-main',
    note:       '#photo-file-note',
    addHorse:   '#add-horse-btn',
    horseList:  '#horse-rows',
    analyzeBtn: '#analyze-btn',
    predictBtn: '#predict-btn'
  };

  // Check for required DOM elements
  const missing = Object.entries(ids).filter(([, sel]) => !$(sel)).map(([k, sel]) => `${k} (${sel})`);
  if (missing.length) {
    error('Missing DOM elements:', missing.join(', '));
  } else {
    log('Required DOM elements found.');
  }

  // 1) Ensure hidden <input type="file">
  let input = $(ids.fileInput);
  if (!input) {
    input = document.createElement("input");
    input.id = "photo-input-main";
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.style.display = "none";
    document.body.appendChild(input);
    log("Inserted hidden file input #photo-input-main");
  } else {
    log("Found existing #photo-input-main");
  }

  // 2) Overlay & z-index guard so clicks aren't swallowed
  const style = document.createElement("style");
  style.setAttribute("data-picker-guard", "true");
  style.textContent = `
    /* Prevent common overlays from consuming clicks over the picker button */
    .overlay, .backdrop, .mask, .modal-overlay, .loading, [data-blocking-overlay="true"] {
      pointer-events: none !important;
    }
    /* Keep any explicit picker label/button clickable and on top if needed */
    .photo-picker-label, [data-action="choose"], ${ids.chooseBtn} {
      position: relative;
      z-index: 1000 !important;
      pointer-events: auto !important;
    }
  `;
  document.head.appendChild(style);

  // 3) File to base64 conversion
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('FileReader failed'));
      fr.onload = () => {
        const s = String(fr.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.readAsDataURL(file);
    });
  }

  // 4) Add horse row with timeout protection
  async function addHorseRowWait() {
    const addBtn = $(ids.addHorse);
    const list = $(ids.horseList);
    if (!addBtn || !list) throw new Error('Missing add-horse button or horse list container');
    
    const before = list.children.length;
    addBtn.click();
    
    const start = performance.now();
    while (list.children.length <= before) {
      if (performance.now() - start > 4000) throw new Error('Timeout waiting for new horse row');
      await sleep(40);
    }
    return list.children[list.children.length - 1];
  }

  // 5) Fill row inputs by CSS class
  function fillRow(row, h) {
    (row.querySelector('.horse-name') || {}).value = h.name ?? '';
    (row.querySelector('.horse-odds') || {}).value = h.odds ?? '';
    (row.querySelector('.horse-jockey') || {}).value = h.jockey ?? '';
    (row.querySelector('.horse-trainer') || {}).value = h.trainer ?? '';
  }

  // 6) OCR Error Display Functions
  function showOcrError(msg) {
    console.warn('[FLDBG] OCR error:', msg);
    const host = document.querySelector('#action-buttons, .action-buttons') || document.getElementById('analyze-section') || document.body;
    let el = document.getElementById('fl-ocr-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fl-ocr-error';
      el.style.marginLeft = '8px';
      el.style.display = 'inline-block';
      el.style.padding = '4px 8px';
      el.style.borderRadius = '6px';
      el.style.background = 'rgba(220, 53, 69, 0.15)'; // soft danger
      el.style.color = '#ff6b6b';
      el.style.fontSize = '12px';
      el.style.fontWeight = '600';
      host.appendChild(el);
    }
    el.textContent = msg;
    el.style.visibility = 'visible';
  }

  function hideOcrError() {
    const el = document.getElementById('fl-ocr-error');
    if (el) el.style.visibility = 'hidden';
  }

  function tryParseJSON(str) {
    try { return JSON.parse(str); } catch { return null; }
  }

  function extractBracedJSON(str) {
    if (typeof str !== 'string') return null;
    const start = str.indexOf('{');
    if (start === -1) return null;
    // attempt to find a balanced block
    let depth = 0;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const sliced = str.slice(start, i + 1);
          const parsed = tryParseJSON(sliced);
          if (parsed) return parsed;
        }
      }
    }
    return null;
  }

  /**
   * Accepts whatever the API returned and tries hard to get horses[].
   * Supports:
   *   { ok:true, horses:[...] }
   *   { ok:true, data:{ horses:[...] } }
   *   { ok:true, data:"{ \"horses\": [...] }" }
   *   { ok:true, text:"... JSON blob ..." }
   */
  function coerceHorses(resp) {
    console.log('[FLDBG] coerceHorses: raw resp keys =', resp && Object.keys(resp || {}));
    const trunc = (v) => (typeof v === 'string' ? v.slice(0, 300) : JSON.stringify(v || {}, null, 0).slice(0, 300));
    console.log('[FLDBG] API JSON (trunc):', trunc(resp));

    // 1) direct
    if (resp && Array.isArray(resp.horses)) return resp.horses;

    // 2) nested object
    if (resp && resp.data && Array.isArray(resp.data.horses)) return resp.data.horses;

    // 3) nested string JSON
    if (resp && typeof resp.data === 'string') {
      const parsed = tryParseJSON(resp.data) || extractBracedJSON(resp.data);
      if (parsed && Array.isArray(parsed.horses)) return parsed.horses;
    }

    // 4) sometimes servers put the blob in resp.text or resp.raw
    const candidates = [resp && resp.text, resp && resp.raw, resp && resp.body, resp && resp.message];
    for (const c of candidates) {
      if (typeof c === 'string') {
        const parsed = tryParseJSON(c) || extractBracedJSON(c);
        if (parsed && Array.isArray(parsed.horses)) return parsed.horses;
      } else if (c && typeof c === 'object' && Array.isArray(c.horses)) {
        return c.horses;
      }
    }

    // 5) last-ditch: scan any stringy field containing "horses"
    const allStr = [];
    for (const k in (resp || {})) {
      const val = resp[k];
      if (typeof val === 'string' && val.includes('"horses"')) allStr.push(val);
    }
    for (const blob of allStr) {
      const parsed = tryParseJSON(blob) || extractBracedJSON(blob);
      if (parsed && Array.isArray(parsed.horses)) return parsed.horses;
    }

    return [];
  }

  // ---------- Odds normalizer ----------
  function normalizeOdds(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    const dashish = /(\d+)\s*[-–—]\s*(\d+)/;
    const toish   = /(\d+)\s*(?:to|:)\s*(\d+)/i;
    if (dashish.test(s)) return s.replace(dashish, '$1/$2');
    if (toish.test(s))  return s.replace(toish, '$1/$2');
    return s;
  }

  // ---------- DOM helpers tuned to our UI ----------
  function getHorseSectionRoot() {
    // Flexible: try a known container; fall back to form/body
    return (
      document.querySelector('#horse-section') ||
      document.querySelector('.horse-section') ||
      document.querySelector('form') ||
      document.body
    );
  }

  function clickAddHorse() {
    const btn =
      document.querySelector('button[data-action="add-horse"]') ||
      [...document.querySelectorAll('button, input[type="button"]')].find(
        b => /add\s*horse/i.test(b.textContent || b.value || '')
      );
    if (btn) {
      btn.click();
      return true;
    }
    console.warn('[FLDBG] Add Horse button not found.');
    return false;
  }

  function getLastRowInputs() {
    const root = getHorseSectionRoot();
    const nameInputs    = [...root.querySelectorAll('input[placeholder*="Horse"]')];
    const oddsInputs    = [...root.querySelectorAll('input[placeholder*="ML Odds"]')];
    const jockeyInputs  = [...root.querySelectorAll('input[placeholder*="Jockey"]')];
    const trainerInputs = [...root.querySelectorAll('input[placeholder*="Trainer"]')];
    const last = arr => (arr.length ? arr[arr.length - 1] : null);
    return {
      name:    last(nameInputs),
      odds:    last(oddsInputs),
      jockey:  last(jockeyInputs),
      trainer: last(trainerInputs),
    };
  }

  async function ensureBlankRow() {
    let { name, odds, jockey, trainer } = getLastRowInputs();
    const filled =
      (name && name.value?.trim()) ||
      (odds && odds.value?.trim()) ||
      (jockey && jockey.value?.trim()) ||
      (trainer && trainer.value?.trim());

    if (!name || !odds || !jockey || !trainer || filled) {
      if (clickAddHorse()) {
        await new Promise(r => setTimeout(r, 150)); // let DOM append the new quartet
        ({ name, odds, jockey, trainer } = getLastRowInputs());
      }
    }
    return { name, odds, jockey, trainer };
  }

  async function fillOneRow(h) {
    const { name, odds, jockey, trainer } = await ensureBlankRow();
    if (!name || !odds || !jockey || !trainer) {
      console.warn('[FLDBG] Missing inputs for a row:', { name, odds, jockey, trainer });
      return false;
    }
    // Fill the last row's quartet
    name.value     = h?.name    ?? '';
    odds.value     = normalizeOdds(h?.odds);
    jockey.value   = h?.jockey  ?? '';
    trainer.value  = h?.trainer ?? '';
    return true;
  }

  // 7) Incremental horse population
  async function populateIncremental(horses) {
    try {
      if (!Array.isArray(horses) || horses.length === 0) {
        console.warn('[FLDBG] populateIncremental: empty list');
        return;
      }
      let filled = 0;
      for (let i = 0; i < horses.length; i++) {
        const h = horses[i] || {};
        console.log(`[FLDBG] Row ${i + 1}:`, h);
        const ok = await fillOneRow(h);
        if (ok) filled++;
        await new Promise(r => setTimeout(r, 60)); // small pacing
      }
      // Toast
      const toast = document.createElement('div');
      toast.textContent = `✅ Horses populated: ${filled}/${horses.length}`;
      Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        padding: '10px 14px',
        background: 'rgba(0,255,140,0.12)',
        border: '1px solid #00ff8c',
        color: '#00ff8c',
        borderRadius: '10px',
        fontSize: '14px',
        zIndex: 99999,
        backdropFilter: 'blur(6px)',
      });
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3200);
    } catch (err) {
      console.error('[FLDBG] populateIncremental error:', err);
    }
  }

  // 7) Main upload + extract + populate flow
  async function finishlineUploadAndExtract(file) {
    log('START upload+extract for', file.name);
    
    // File validation
    if (!file.type || (!file.type.startsWith('image/') && file.type !== 'application/pdf')) {
      alert('Please select an image or PDF');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      alert('File > 15MB; pick a smaller file.');
      return;
    }

    // Update UI state
    const statusBadge = document.querySelector('[data-status-badge]') || { textContent: '' };
    statusBadge.textContent = 'Extracting…';

    try {
      // Convert to base64
      const b64 = await fileToBase64(file);
      log('base64 length:', b64.length);

      // POST to API
      const t0 = performance.now();
      const res = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mime: file.type, data: b64 })
      });
      const raw = await res.text();
      const dt = (performance.now() - t0) | 0;
      log('POST /api/photo_extract_openai_b64 status:', res.status, `(${dt}ms)`, 'raw:', raw);

      // Parse response
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { ok: false, error: 'Bad JSON', raw };
      }

      if (!res.ok || !payload.ok) {
        const msg = payload.error || `HTTP ${res.status}`;
        alert(`Extraction failed: ${msg}\nCheck Network + Vercel logs.`);
        statusBadge.textContent = 'Idle';
        return;
      }

      // Hide any previous OCR errors
      hideOcrError();

      // Handle consistent API response shape
      if (!payload?.ok || !Array.isArray(payload.horses)) {
        showOcrError('OCR failed: invalid response');
        statusBadge.textContent = 'Idle';
        return;
      }

      if (payload.horses.length === 0) {
        showOcrError('No horses found in the image');
        statusBadge.textContent = 'Idle';
        return;
      }

      // Extract horses array from response
      const horses = Array.isArray(payload?.horses) ? payload.horses : [];
      log('horses extracted:', horses);

      // Populate horses incrementally
      try {
        await populateIncremental(horses);
        statusBadge.textContent = 'Ready';
      } catch (e) {
        error('populateIncremental error:', e);
        showOcrError('Population failed. See console for details.');
        statusBadge.textContent = 'Idle';
      }

    } catch (err) {
      error('finishlineUploadAndExtract error:', err);
      alert('Unexpected error (see console).');
      statusBadge.textContent = 'Idle';
    }
  }

  // 8) Wire up file picker
  const chooseBtn = $(ids.chooseBtn);
  const note = $(ids.note) || { textContent: '' };

  if (chooseBtn && input) {
    chooseBtn.addEventListener('click', () => {
      log('Choose clicked');
      input.value = '';
      input.click();
    });

    chooseBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.value = '';
        input.click();
      }
    });

    input.addEventListener('change', async () => {
      if (!input.files || !input.files.length) {
        warn('fileInput.change: no file selected');
        note.textContent = 'No file selected.';
        return;
      }
      
      const f = input.files[0];
      note.textContent = `Selected: ${f.name} (${Math.round(f.size / 1024)} KB)`;
      log('file selected:', { name: f.name, type: f.type, size: f.size });
      
      try {
        await finishlineUploadAndExtract(f);
      } catch (err) {
        error('finishlineUploadAndExtract error:', err);
        alert('Unexpected error (see console).');
      }
    });

    log('Picker wired');
  }

  // 9) Test Backend button (sends 1x1 PNG to the same endpoint)
  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test Backend';
  testBtn.className = 'btn';
  testBtn.style.marginLeft = '8px';
  (document.querySelector(ids.chooseBtn)?.parentElement || document.body).appendChild(testBtn);
  
  testBtn.addEventListener('click', async () => {
    log('Test Backend clicked');
    const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAA' +
                  'AAC0lEQVR42mP8/x8AAwMB/ax0Qb0AAAAASUVORK5CYII=';
    const t0 = performance.now();
    const res = await fetch('/api/photo_extract_openai_b64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'debug.png', mime: 'image/png', data: png1x1 })
    });
    const raw = await res.text();
    const dt = (performance.now() - t0) | 0;
    log('TEST POST status:', res.status, `(${dt}ms)`, 'raw:', raw);
    try {
      console.log('[FLDBG] TEST parsed:', JSON.parse(raw));
    } catch {
      console.warn('[FLDBG] TEST raw not JSON:', raw);
    }
    alert(`Test call returned HTTP ${res.status}. See console for body.`);
  });

  // 10) Expose API for external use
  window.finishlineUploadAndExtract = finishlineUploadAndExtract;
  window.populateIncremental = populateIncremental;

  log('Debug bootstrap installed.');
})();