// FinishLine WPS — Loader Self-Test + Independent Debug Uploader (does NOT touch your existing UI)
(() => {
  // --- Self-test banner so we KNOW this script is loaded ---
  try {
    const bannerId = 'finishline-selftest';
    if (!document.getElementById(bannerId)) {
      const b = document.createElement('div');
      b.id = bannerId;
      b.textContent = 'FinishLine app.js loaded ✔';
      Object.assign(b.style, {
        position: 'fixed', top: '8px', right: '8px', zIndex: '2147483647',
        background: '#0ea5e9', color: '#fff', padding: '6px 10px',
        borderRadius: '8px', fontSize: '12px', boxShadow: '0 6px 18px rgba(0,0,0,.2)'
      });
      const close = document.createElement('button');
      close.textContent = '×'; close.title = 'Hide';
      Object.assign(close.style, { marginLeft: '8px', background: 'transparent', border: 'none', color: '#fff', fontSize: '14px', cursor: 'pointer' });
      close.onclick = () => b.remove();
      b.appendChild(close);
      document.body.appendChild(b);
    }
    console.info('[FinishLine] app.js loaded ✔');
  } catch (e) {}

  // --- Shared bucket + helpers (independent of your UI) ---
  window.__finishline_bucket = window.__finishline_bucket || [];
  function addFiles(list) {
    const arr = Array.from(list || []);
    for (const f of arr) if (f && f.name) window.__finishline_bucket.push(f);
  }
  async function sendToOCR() {
    const files = window.__finishline_bucket;
    if (!files.length) throw new Error('No files selected. Choose images or PDFs first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); }
    const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json; try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // --- Floating Debug Uploader (does not interfere with your app) ---
  if (!document.getElementById('finishline-debug-uploader')) {
    const panel = document.createElement('div');
    panel.id = 'finishline-debug-uploader';
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">Upload Debug Panel</div>
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
        <input id="finishline-debug-input" type="file" multiple accept="image/*,.pdf" />
        <button id="finishline-debug-send" type="button">Send to OCR</button>
        <button id="finishline-debug-clear" type="button">Clear</button>
        <button id="finishline-debug-hide" type="button">Hide</button>
      </div>
      <div id="finishline-debug-status" style="font-size:12px; opacity:.9;">0 selected</div>
    `;
    Object.assign(panel.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483646',
      background: 'rgba(26,28,35,.95)', color: '#fff', padding: '10px 12px',
      border: '1px solid rgba(255,255,255,.08)', borderRadius: '10px',
      boxShadow: '0 8px 28px rgba(0,0,0,.35)', fontSize: '12px'
    });
    document.body.appendChild(panel);

    const fileEl = panel.querySelector('#finishline-debug-input');
    const sendEl = panel.querySelector('#finishline-debug-send');
    const clearEl= panel.querySelector('#finishline-debug-clear');
    const hideEl = panel.querySelector('#finishline-debug-hide');
    const status = panel.querySelector('#finishline-debug-status');

    const update = () => { status.textContent = `${window.__finishline_bucket.length} selected`; };

    fileEl.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value=''; update(); });
    clearEl.addEventListener('click', () => { window.__finishline_bucket = []; update(); });
    hideEl.addEventListener('click', () => panel.remove());
    sendEl.addEventListener('click', async () => {
      sendEl.disabled = true; sendEl.textContent = 'Uploading…';
      try {
        const json = await sendToOCR();
        console.log('[FinishLine][OCR]', json);
        status.textContent = 'Uploaded ✔ — open DevTools → Network → photo_extract_openai_b64 to verify.';
        alert('OCR upload OK. Check DevTools Network for response JSON.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        status.textContent = `Error: ${msg}`;
        alert(`OCR error: ${msg}`);
      } finally {
        sendEl.disabled = false; sendEl.textContent = 'Send to OCR';
      }
    });

    update();
  }
})();

// === OCR → FORM POPULATE (works with Debug Panel or your normal Extract button) ===

(() => {
  // Tiny helpers
  const $  = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
  const setBadge = (txt, cls='ready') => {
    const badge = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle');
    if (badge) { badge.textContent = txt; badge.className = `badge ${cls}`; }
  };

  // --- Editor scoping (the single-row "Horse Data" editor) ---
  function findEditorNameInput() {
    return $('#horseName') || $('input[name="horseName"]') ||
      $$('input,textarea').find(el =>
        /horse\s*name/i.test([el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||''].join(' '))
      );
  }
  function getEditorContainer() {
    const nameEl = findEditorNameInput();
    return nameEl ? (nameEl.closest('form, [data-section="horse"], section, fieldset, .horse-editor, .horse-data, .card, .panel') || nameEl.parentElement) : null;
  }
  function findInEditor(rx) {
    const scope = getEditorContainer() || document;
    const re = rx instanceof RegExp ? rx : new RegExp(String(rx), 'i');
    return $$('input,textarea,select', scope).find(el => {
      const s = [el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||'', el.closest('label')?.textContent||''].join(' ');
      return re.test(s);
    });
  }
  const getOddsInput    = () => findInEditor(/(ml\s*odds|odds)/i);
  const getJockeyInput  = () => findInEditor(/jockey/i);
  const getTrainerInput = () => findInEditor(/trainer/i);

  // Table/list rows after "Add Horse"
  function horseRows() {
    return $$('.horse-list .horse-row').length   ? $$('.horse-list .horse-row')
         : $$('.horses .row').length            ? $$('.horses .row')
         : $$('.horse-items .item').length      ? $$('.horse-items .item')
         : $$('.added-horses .row'); // fallback
  }

  function getAddHorseControl() {
    const scope = getEditorContainer() || document;
    const btnByText = $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()));
    if (btnByText) return btnByText;
    return scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  async function addOneHorse(h) {
    const nameEl = findEditorNameInput();
    if (!nameEl) return false;

    if (h?.name) { nameEl.value = h.name; fire(nameEl); }
    const oddsEl = getOddsInput();
    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;  fire(jEl); }
    const tEl = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }
    await sleep(30);

    const before = horseRows().length;
    const form = nameEl.closest('form');
    const btn  = getAddHorseControl();

    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    else if (btn) btn.click();

    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      await sleep(60);
      if (horseRows().length > before) return true;
    }
    // Some branches render rows later; don't block
    return true;
  }

  function setRaceMeta(race) {
    const setField = (label, val) => {
      if (val == null) return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
            [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
          ));
      if (el) { el.value = val; fire(el); }
    };
    setField('raceDate', race?.date);
    setField('track',    race?.track);
    setField('surface',  race?.surface);
    setField('distance', race?.distance);
  }

  // ---------- MAIN: process OCR JSON and populate UI ----------
  async function finishline_process_ocr(json) {
    // Normalize different shapes
    const data = json?.data || json;
    const received  = data?.received;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses    = Array.isArray(extracted?.horses) ? extracted.horses
                     : Array.isArray(data?.horses)     ? data.horses
                     : [];

    // Race info (best-effort)
    setRaceMeta(extracted?.race || data?.race || {});

    // Add horses sequentially
    let added = 0;
    for (const h of horses) {
      const ok = await addOneHorse({
        name:    h.name || h.horse || h.title || '',
        ml_odds: h.ml_odds || h.odds || '',
        jockey:  h.jockey || '',
        trainer: h.trainer || ''
      });
      if (ok) added++;
    }

    // Hide JSON area if present
    const pre = document.getElementById('ocrJson');
    if (pre) pre.style.display = 'none';

    // User-facing status (your green banner or debug area)
    const resultBox = $('#ocrResult') || $('[data-ocr-result]');
    if (resultBox) {
      resultBox.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`;
      resultBox.dataset.type = 'info';
    }

    // Badge → Ready to analyze
    setBadge('Ready to analyze', 'ready');

    // Optional: dump small summary to console for verification
    console.info('[FinishLine] OCR received:', received?.length || 0, 'file(s); added:', added, 'horses.');
  }
  window.finishline_process_ocr = finishline_process_ocr;

  // ---------- Upload & Extract helpers ----------
  async function finishline_sendToOCR() {
    const files = (window.__finishline_getFiles && window.__finishline_getFiles()) || window.__finishline_bucket || [];
    if (!files.length) throw new Error('No files selected. Choose images/PDFs first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); }
    const res  = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json;
    try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // Expose a one-click extractor you can bind to your main button later
  window.finishline_extractNow = async function() {
    try {
      const json = await finishline_sendToOCR();
      await finishline_process_ocr(json);
      alert('OCR upload OK and form populated.'); // remove if you don't want the alert
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error('[FinishLine][OCR] error:', m);
      alert(`OCR error: ${m}`);
    }
  };

  // ---------- Hook the Debug Panel's "Send to OCR" to populate the form ----------
  // If the debug panel exists, patch its click handler to call our processor.
  const tryPatchDebugPanel = () => {
    const sendBtn = document.getElementById('finishline-debug-send');
    if (!sendBtn || sendBtn.dataset.finishlinePatched === '1') return;
    sendBtn.dataset.finishlinePatched = '1';
    sendBtn.addEventListener('click', async (ev) => {
      // Our loader already bound a handler earlier; let it run then populate.
      // To guarantee population, we attach a microtask follow-up here:
      await sleep(50);
      try {
        // Try pulling last network response from memory bucket if present; otherwise just call send
        const json = await finishline_sendToOCR();
        await finishline_process_ocr(json);
      } catch (e) {
        console.error('[FinishLine][DebugPanel] populate failed:', e);
      }
    }, { capture: true });
  };
  tryPatchDebugPanel();
  const mo = new MutationObserver(tryPatchDebugPanel);
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}
})();