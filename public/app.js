// FinishLine WPS — capture native <input type="file"> selections + bind Extract + populate all horses

(() => {
  if (window.__finishline_bind_v4) return;
  window.__finishline_bind_v4 = true;

  // ---- tiny helpers
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  // ---- NEVER require a date for OCR/extract
  const dateField = $('#raceDate') || $('[name="raceDate"]');
  if (dateField) dateField.removeAttribute('required');

  // ---- shared bucket
  window.__finishline_bucket = window.__finishline_bucket || [];
  function updateSelectedCount() {
    const badge = document.getElementById('photoCount') || document.querySelector('[data-photo-count]');
    if (badge) badge.textContent = `${window.__finishline_bucket.length} / 6 selected`;
  }

  // ---- capture ANY input[type=file] anywhere (native, labels, etc.)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('input[type="file"]')) {
      const files = Array.from(el.files || []);
      for (const f of files) if (f && f.name) window.__finishline_bucket.push(f);
      // allow selecting the same file twice
      try { el.value = ''; } catch {}
      updateSelectedCount();
      console.info('[FinishLine] captured files:', files.map(f => f.name));
    }
  }, true);
})();

// Make "Choose Photos / PDF" reliably open a native file picker (and capture selections)

(() => {
  if (window.__finishline_choose_bind_v1) return;
  window.__finishline_choose_bind_v1 = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // Shared bucket used by Extract
  window.__finishline_bucket = window.__finishline_bucket || [];
  function capture(filesLike) {
    const files = Array.from(filesLike || []);
    for (const f of files) if (f && f.name) window.__finishline_bucket.push(f);
    const badge = $('#photoCount') || $('[data-photo-count]');
    if (badge) badge.textContent = `${window.__finishline_bucket.length} / 6 selected`;
  }

  // 1) Locate the native input if it exists; otherwise make one (hidden).
  function getNativeFileInput() {
    // Prefer an existing input near your dropzone/controls
    let inp =
      $('#photosInput') ||
      ($('[data-dropzone], .photos-dropzone, #dropzone') || document).querySelector?.('input[type="file"]') ||
      $$('input[type="file"]').find(i => (i.accept||'').includes('image') || (i.accept||'').includes('pdf'));

    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.accept = 'image/*,.pdf';
      inp.id = 'finishline-hidden-file-input';
      Object.assign(inp.style, { position: 'fixed', left: '-9999px', top: '-9999px' });
      document.body.appendChild(inp);
    }

    // Always capture what the user picks
    if (!inp.dataset.finishlineChangeBound) {
      inp.dataset.finishlineChangeBound = '1';
      inp.addEventListener('change', (e) => {
        capture(e.target.files);
        // allow re-selecting the same file twice
        try { e.target.value = ''; } catch {}
      });
    }
    return inp;
  }

  // 2) Bind the visible "Choose Photos / PDF" control to open the native input
  function findChooseButton() {
    return document.getElementById('choosePhotosBtn')
        || document.querySelector('[data-action="choose-photos"]')
        || $$('button, a, input[type="button"], input[type="submit"]')
           .find(el => /^choose\s*photos\s*\/\s*pdf$/i.test((el.textContent || el.value || '').trim()));
  }

  function bindChoose() {
    const btn = findChooseButton();
    if (!btn || btn.dataset.finishlineChooseBound) return;

    btn.dataset.finishlineChooseBound = '1';

    // Make sure clicks aren't swallowed by other handlers: capture phase + stopImmediatePropagation
    btn.addEventListener('click', (e) => {
      try { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); } catch {}
      const input = getNativeFileInput();
      // Some sites wrap a <label for=...>. If this is already a label, let the browser do it;
      // otherwise force the picker.
      if (btn.tagName !== 'LABEL') input.click();
    }, true);
  }

  // 3) Also capture ANY file input anywhere (labels wrapping inputs, etc.)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.matches?.('input[type="file"]')) capture(el.files);
  }, true);

  // 4) Initialize and keep bound after re-renders
  function init() { bindChoose(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
    init();
  }
  new MutationObserver(bindChoose).observe(document.body, { childList: true, subtree: true });
    })();

// Continue with the rest of the v4 system
    (() => {
  if (window.__finishline_bind_v4_continue) return;
  window.__finishline_bind_v4_continue = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  // ---- drag & drop (if dropzone exists)
  const dz = $('#dropzone') || document.querySelector('[data-dropzone], .photos-dropzone');
  if (dz) {
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => dz.addEventListener(evt, stop, false));
    dz.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      for (const f of files) if (f && f.name) window.__finishline_bucket.push(f);
      const badge = $('#photoCount') || $('[data-photo-count]');
      if (badge) badge.textContent = `${window.__finishline_bucket.length} / 6 selected`;
      console.info('[FinishLine] drop files:', files.map(f => f.name));
    }, false);
  }

  // ---- locate Extract button by id/data/text
  function findExtractBtn() {
    return document.getElementById('extractFromPhotosBtn')
        || document.querySelector('[data-action="extract-photos"]')
        || $$('button, a, input[type="button"], input[type="submit"]').find(el =>
             /^(extract\s+from\s+photos|extract\s+photos)/i.test((el.textContent || el.value || '').trim()));
  }

  // ---- editor traversal for add-horse
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

  function horseRowsCount() {
    return (
      $$('.horse-list .horse-row').length ||
      $$('.horses .row').length ||
      $$('.horse-items .item').length ||
      $$('.added-horses .row').length ||
      $$('[data-horse-row], .horse-row, .horse-card').length
    );
  }
  function getAddHorseControl() {
    const scope = getEditorContainer() || document;
    const byText = $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()));
    return byText || scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  async function addOneHorse(h) {
    const nameEl = findEditorNameInput();
    if (!nameEl) return false;

    nameEl.value = h?.name || ''; fire(nameEl);
    const oddsEl = getOddsInput();    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl    = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;  fire(jEl); }
    const tEl    = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }

    await sleep(40);

    const before = horseRowsCount();
    const form   = nameEl.closest('form');
    const addBtn = getAddHorseControl();

    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    else if (addBtn) addBtn.click();

    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      await sleep(70);
      if (horseRowsCount() > before) return true;
      if (findEditorNameInput()?.value === '') return true;
    }
    return true;
  }

  function setRaceMeta(race) {
    const setField = (label, val) => {
      if (val == null || val === '') return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
            [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
          ));
      if (el) { el.value = val; fire(el); }
    };
    setField('track',    race?.track);
    setField('surface',  race?.surface);
    setField('distance', race?.distance);
    // date optional by design
  }

  async function processOCR(json) {
    const data      = json?.data || json;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses    = Array.isArray(extracted?.horses) ? extracted.horses
                     : Array.isArray(data?.horses)     ? data.horses : [];

    setRaceMeta(extracted?.race || data?.race || {});

    let added = 0;
    for (const raw of horses) {
      const h = {
        name:    raw.name || raw.horse || raw.title || '',
        ml_odds: raw.ml_odds || raw.odds || '',
        jockey:  raw.jockey || '',
        trainer: raw.trainer || '',
      };
      if (!h.name) continue;
      const ok = await addOneHorse(h);
      if (ok) added++;
    }

    const pre = document.getElementById('ocrJson');
    if (pre) pre.style.display = 'none';

    const result = $('#ocrResult') || $('[data-ocr-result]');
    if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type='info'; }

    const badge = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle');
    if (badge) { badge.textContent = 'Ready to analyze'; badge.className = 'badge ready'; }
  }
  window.finishline_process_ocr = processOCR; // expose for console if needed

  async function postToOCR() {
    const files = window.__finishline_bucket || [];
    if (!files.length) throw new Error('No files selected. Click "Choose Photos / PDF" first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); }
    const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json;
    try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // Expose convenience for manual testing
  window.finishline_extractNow = async () => {
    const json = await postToOCR();
    await processOCR(json);
  };

  // Bind Extract button
  function bindExtract() {
    const btn = findExtractBtn();
    if (!btn || btn.dataset.finishlineBound) return;
    btn.dataset.finishlineBound = '1';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Extracting…';
        const json = await postToOCR();
        await processOCR(json);
        btn.textContent = label;
      } catch (err) {
        btn.disabled = false;
        const msg = err instanceof Error ? err.message : String(err);
        alert(`OCR error: ${msg}`);
      } finally {
          btn.disabled = false;
      }
    }, true);
    console.info('[FinishLine] Extract button bound.');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindExtract, { once:true });
  else bindExtract();
  new MutationObserver(bindExtract).observe(document.body, { childList:true, subtree:true });
    })();

// Wire "Extract from Photos" → collect files from ANY file input → POST → fill ALL horses
    
    (() => {
  if (window.__finishline_extract_bind_v2) return;
  window.__finishline_extract_bind_v2 = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  // Never require a date for OCR
  const dateField = $('#raceDate') || $('[name="raceDate"]');
  if (dateField) dateField.removeAttribute('required');

  // ---------- collect files directly from any native file inputs ----------
  function collectSelectedFiles() {
    // gather from ALL file inputs present on the page
    const inputs = $$('input[type="file"]');
    const files = [];
    for (const i of inputs) {
      if (i?.files?.length) files.push(...Array.from(i.files));
    }
    // fall back to our shared bucket if you kept it
    if (!files.length && window.__finishline_bucket?.length) files.push(...window.__finishline_bucket);
    return files;
  }

  // ---------- find Extract button by id / data attr / label ----------
  function findExtractBtn() {
    return document.getElementById('extractFromPhotosBtn')
        || document.querySelector('[data-action="extract-photos"]')
        || $$('button, a, input[type="button"], input[type="submit"]').find(el =>
             /^(extract\s+from\s+photos|extract\s+photos)/i.test((el.textContent || el.value || '').trim()));
  }

  // ---------- helpers to interact with the inline "Add Horse" editor ----------
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

  function horseRowsCount() {
    return (
      $$('.horse-list .horse-row').length ||
      $$('.horses .row').length ||
      $$('.horse-items .item').length ||
      $$('.added-horses .row').length ||
      $$('[data-horse-row], .horse-row, .horse-card').length
    );
  }
  function getAddHorseControl() {
    const scope = getEditorContainer() || document;
    const byText = $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()));
    return byText || scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  async function addOneHorse(h) {
    const nameEl = findEditorNameInput();
    if (!nameEl) return false;

    nameEl.value = h?.name || ''; fire(nameEl);
    const oddsEl = getOddsInput();    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl    = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;  fire(jEl); }
    const tEl    = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }

    await sleep(40);

    const before = horseRowsCount();
    const form   = nameEl.closest('form');
    const addBtn = getAddHorseControl();

    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    else if (addBtn) addBtn.click();

    // wait for a new row or an editor clear
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      await sleep(70);
      if (horseRowsCount() > before) return true;
      if (findEditorNameInput()?.value === '') return true;
    }
    return true; // don't block next horses if UI is slow
  }

  function setRaceMeta(race) {
    const setField = (label, val) => {
      if (val == null || val === '') return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
            [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
          ));
      if (el) { el.value = val; fire(el); }
    };
    setField('track',    race?.track);
    setField('surface',  race?.surface);
    setField('distance', race?.distance);
    // date is optional by design
  }

  async function processOCR(json) {
    const data      = json?.data || json;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses    = Array.isArray(extracted?.horses) ? extracted.horses
                     : Array.isArray(data?.horses)     ? data.horses : [];

    setRaceMeta(extracted?.race || data?.race || {});

    let added = 0;
    for (const raw of horses) {
      const h = {
        name:    raw.name || raw.horse || raw.title || '',
        ml_odds: raw.ml_odds || raw.odds || '',
        jockey:  raw.jockey || '',
        trainer: raw.trainer || '',
      };
      if (!h.name) continue;
      const ok = await addOneHorse(h);
      if (ok) added++;
    }

    const pre = document.getElementById('ocrJson'); if (pre) pre.style.display = 'none';
    const result = $('#ocrResult') || $('[data-ocr-result]');
    if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type = 'info'; }
    const badge = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle');
    if (badge) { badge.textContent = 'Ready to analyze'; badge.className = 'badge ready'; }
  }

  async function postToOCR(files) {
    if (!files?.length) throw new Error('No files selected. Click "Choose Photos / PDF" first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); } // tolerant server-side
    const res  = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json; try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // Bind the real Extract button
  function bindExtract() {
    const btn = findExtractBtn();
    if (!btn || btn.dataset.finishlineExtractBound) return;
    btn.dataset.finishlineExtractBound = '1';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const files = collectSelectedFiles();
        if (!files.length) throw new Error('No files selected.');
        const old = btn.textContent; btn.disabled = true; btn.textContent = 'Extracting…';
        const json = await postToOCR(files);
        await processOCR(json);
        btn.textContent = old;
      } catch (err) {
        alert(`OCR error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
          btn.disabled = false;
      }
    }, true);
    console.info('[FinishLine] Extract button bound.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindExtract, { once: true });
          } else {
    bindExtract();
  }
  new MutationObserver(bindExtract).observe(document.body, { childList: true, subtree: true });

  // Also expose manual trigger (for console testing)
  window.finishline_extractNow = async () => {
    const json = await postToOCR(collectSelectedFiles());
    await processOCR(json);
  };
    })();

// Robust: delegate clicks for "Extract from Photos" → collect files → POST → add ALL horses

(() => {
  if (window.__finishline_extract_delegate_v1) return;
  window.__finishline_extract_delegate_v1 = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  // Never require date for OCR
  const dateField = $('#raceDate') || $('[name="raceDate"]'); if (dateField) dateField.removeAttribute('required');

  // -------- file collection (from ANY <input type=file> or shared bucket) ----------
  function collectSelectedFiles() {
    const inputs = $$('input[type="file"]');
    const files = [];
    for (const i of inputs) if (i?.files?.length) files.push(...Array.from(i.files));
    if (!files.length && Array.isArray(window.__finishline_bucket)) files.push(...window.__finishline_bucket);
    return files;
  }

  // -------- add-horse editor helpers ----------
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

  function rowsCount() {
    return (
      $$('.horse-list .horse-row').length ||
      $$('.horses .row').length ||
      $$('.horse-items .item').length ||
      $$('.added-horses .row').length ||
      $$('[data-horse-row], .horse-row, .horse-card').length
    );
  }
  function addBtnEl() {
    const scope = getEditorContainer() || document;
    const byText = $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()));
    return byText || scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  async function addOneHorse(h) {
    const nameEl = findEditorNameInput();
    if (!nameEl) return false;

    nameEl.value = h?.name || ''; fire(nameEl);
    const oddsEl = getOddsInput();    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl    = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;  fire(jEl); }
    const tEl    = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }

    await sleep(40);

    const before = rowsCount();
    const form   = nameEl.closest('form');
    const addBtn = addBtnEl();

    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    else if (addBtn) addBtn.click();

    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      await sleep(70);
      if (rowsCount() > before) return true;
      if (findEditorNameInput()?.value === '') return true;
    }
    return true;
  }

  function setRaceMeta(race) {
    const setField = (label, val) => {
      if (val == null || val === '') return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
            [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
          ));
      if (el) { el.value = val; fire(el); }
    };
    setField('track',    race?.track);
    setField('surface',  race?.surface);
    setField('distance', race?.distance);
  }

  async function processOCR(json) {
    const data      = json?.data || json;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses    = Array.isArray(extracted?.horses) ? extracted.horses
                     : Array.isArray(data?.horses)     ? data.horses : [];

    setRaceMeta(extracted?.race || data?.race || {});

    let added = 0;
    for (const raw of horses) {
      const h = {
        name:    raw.name || raw.horse || raw.title || '',
        ml_odds: raw.ml_odds || raw.odds || '',
        jockey:  raw.jockey || '',
        trainer: raw.trainer || '',
      };
      if (!h.name) continue;
      if (await addOneHorse(h)) added++;
    }

    const pre = document.getElementById('ocrJson'); if (pre) pre.style.display = 'none';
    const result = $('#ocrResult') || $('[data-ocr-result]'); if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type='info'; }
    const badge = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle'); if (badge) { badge.textContent = 'Ready to analyze'; badge.className = 'badge ready'; }
  }

  async function postToOCR(files) {
    if (!files?.length) throw new Error('No files selected. Click "Choose Photos / PDF" first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); }
    const res  = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json; try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // --------- DELEGATED CLICK HANDLER (can't miss re-renders/variants) ----------
  function normText(el) {
    return (el?.textContent || el?.value || '').replace(/\s+/g,' ').trim();
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a, input[type="button"], input[type="submit"]');
    if (!t) return;
    const label = normText(t).toLowerCase();
    if (!/(^extract from photos$|^extract photos$|^extract from photos with ai$|^extract from photos\.?$)/i.test(label)) return;

    e.preventDefault(); e.stopPropagation();
    try {
      const files = collectSelectedFiles();
      if (!files.length) throw new Error('No files selected.');
      const old = t.textContent; t.disabled = true; t.textContent = 'Extracting…';
      const json = await postToOCR(files);
      await processOCR(json);
      t.textContent = old;
    } catch (err) {
      alert(`OCR error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
      t.disabled = false;
    }
  }, true);

  // Expose manual trigger for console
  window.finishline_extractNow = async () => {
    const json = await postToOCR(collectSelectedFiles());
    await processOCR(json);
  };
})();

// Auto-extract on file select/drop: POST to /api/photo_extract_openai_b64 and populate ALL horses

(() => {
  if (window.__finishline_auto_extract_v1) return;
  window.__finishline_auto_extract_v1 = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  // ---- Never require race date
  const dateField = $('#raceDate') || $('[name="raceDate"]');
  if (dateField) dateField.removeAttribute('required');

  // ---- Editor helpers
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

  function rowsCount() {
    return (
      $$('.horse-list .horse-row').length ||
      $$('.horses .row').length ||
      $$('.horse-items .item').length ||
      $$('.added-horses .row').length ||
      $$('[data-horse-row], .horse-row, .horse-card').length
    );
  }
  function addBtnEl() {
    const scope = getEditorContainer() || document;
    const byText = $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()));
    return byText || scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  async function addOneHorse(h) {
    const nameEl = findEditorNameInput();
    if (!nameEl) return false;

    nameEl.value = h?.name || ''; fire(nameEl);
    const oddsEl = getOddsInput();    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl    = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;  fire(jEl); }
    const tEl    = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }

    await sleep(40);

    const before = rowsCount();
    const form   = nameEl.closest('form');
    const addBtn = addBtnEl();

    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    else if (addBtn) addBtn.click();

    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      await sleep(70);
      if (rowsCount() > before) return true;
      if (findEditorNameInput()?.value === '') return true;
    }
    return true;
  }

  function setRaceMeta(race) {
    const setField = (label, val) => {
      if (val == null || val === '') return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
            [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
          ));
      if (el) { el.value = val; fire(el); }
    };
    setField('track',    race?.track);
    setField('surface',  race?.surface);
    setField('distance', race?.distance);
  }

  async function processOCR(json) {
    const data      = json?.data || json;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses    = Array.isArray(extracted?.horses) ? extracted.horses
                     : Array.isArray(data?.horses)     ? data.horses : [];

    setRaceMeta(extracted?.race || data?.race || {});

    let added = 0;
    for (const raw of horses) {
      const h = {
        name:    raw.name || raw.horse || raw.title || '',
        ml_odds: raw.ml_odds || raw.odds || '',
        jockey:  raw.jockey || '',
        trainer: raw.trainer || '',
      };
      if (!h.name) continue;
      if (await addOneHorse(h)) added++;
    }

    const pre = document.getElementById('ocrJson'); if (pre) pre.style.display = 'none';
    const result = $('#ocrResult') || $('[data-ocr-result]'); if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type='info'; }
    const badge = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle'); if (badge) { badge.textContent = 'Ready to analyze'; badge.className = 'badge ready'; }

    console.info('[FinishLine] OCR populated', added, 'horses.');
  }

  async function postToOCR(files) {
    if (!files?.length) throw new Error('No files selected.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); } // tolerant to both names
    const res  = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json; try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // ---- AUTO-EXTRACT on ANY file input selection
  async function autoExtractFromEventFiles(fileList) {
    try {
      const files = Array.from(fileList || []);
      if (!files.length) return;                       // nothing to do
      console.info('[FinishLine] Auto-extract starting; files:', files.map(f=>f.name));
      const json = await postToOCR(files);
      await processOCR(json);
        } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FinishLine][AutoExtract] error:', msg);
      alert(`OCR error: ${msg}`);
    }
  }

  // 1) Any native input[type=file]
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.matches?.('input[type="file"]')) {
      autoExtractFromEventFiles(el.files);
      // allow re-selecting the same file again
      try { el.value = ''; } catch {}
    }
  }, true);

  // 2) Drop-to-extract (if a dropzone exists)
  const dz = $('#dropzone') || document.querySelector('[data-dropzone], .photos-dropzone');
  if (dz) {
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => dz.addEventListener(evt, stop, false));
    dz.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      autoExtractFromEventFiles(files);
    }, false);
  }

  // 3) Expose for console/manual retry
  window.finishline_extractNow = async () => {
    const inputs = $$('input[type="file"]');
    let files = [];
    for (const i of inputs) if (i?.files?.length) files.push(...Array.from(i.files));
    if (!files.length && window.__finishline_bucket?.length) files = [...window.__finishline_bucket];
    const json = await postToOCR(files);
    await processOCR(json);
  };
})();

(() => {
  if (window.__finishline_upload_pipeline_v4) return;
  window.__finishline_upload_pipeline_v4 = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el, type) => el?.dispatchEvent(new Event(type || 'change', { bubbles:true }));

  // Make race date optional
  const dateField = $('#raceDate') || $('[name="raceDate"]');
  if (dateField) dateField.removeAttribute('required');

  function ensurePhotosInput() {            // one input we fully control
    let inp = $('#photosInput');
    if (!inp) {
      const host = $('#photosCard') || $('[data-photos-card]') || document.body;
      inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.accept   = 'image/*,.pdf';
      inp.id       = 'photosInput';
      Object.assign(inp.style, { position:'absolute', opacity:'0', width:'1px', height:'1px', pointerEvents:'none' });
      host.appendChild(inp);
    }
    return inp;
  }
  const photosInput = ensurePhotosInput();
  let lastFiles = [];
  const hud = $('#ocrHud');
  const setHud = (msg) => { if (hud) hud.textContent = msg || ''; };

  // ---------- Add-Horse helpers ----------
  function findEditorNameInput() {
    return $('#horseName') || $('input[name="horseName"]') ||
      $$('input,textarea').find(el =>
        /horse\s*name/i.test([el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||''].join(' '))
      );
  }
  function editorScope() {
    const name = findEditorNameInput();
    return name ? (name.closest('form, [data-section="horse"], section, fieldset, .horse-editor, .horse-data, .card, .panel') || name.parentElement) : document;
  }
  function findInEditor(rx) {
    const scope = editorScope();
    const re = rx instanceof RegExp ? rx : new RegExp(String(rx), 'i');
    return $$('input,textarea,select', scope).find(el => {
      const s = [el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||'', el.closest('label')?.textContent||''].join(' ');
      return re.test(s);
    });
  }
  const getOdds    = () => findInEditor(/(ml\s*odds|odds)/i);
  const getJockey  = () => findInEditor(/jockey/i);
  const getTrainer = () => findInEditor(/trainer/i);
  const rowsCount  = () =>
    $$('.horse-list .horse-row, .horses .row, .horse-items .item, .added-horses .row, [data-horse-row], .horse-row, .horse-card').length;
  const addBtn = () => {
    const scope = editorScope();
    return $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()))
      || scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  };
  async function addHorseRow(h) {
    const nameEl = findEditorNameInput(); if (!nameEl) return false;
    nameEl.value = h?.name || ''; fire(nameEl, 'input'); fire(nameEl);
    const o = getOdds();    if (o && (h?.ml_odds || h?.odds)) { o.value = h.ml_odds || h.odds; fire(o, 'input'); fire(o); }
    const j = getJockey();  if (j && h?.jockey)  { j.value = h.jockey;  fire(j, 'input'); fire(j); }
    const t = getTrainer(); if (t && h?.trainer) { t.value = h.trainer; fire(t, 'input'); fire(t); }
    await sleep(30);
    const before = rowsCount();
    const form   = nameEl.closest('form');
    const btn    = addBtn();
    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
    else if (btn) btn.click();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await sleep(60);
      if (rowsCount() > before) return true;
      if (findEditorNameInput()?.value === '') return true;
    }
    return true;
  }
  function setRaceMeta(race) {
    const set = (label, val) => {
      if (val == null || val === '') return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test([x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')));
      if (el) { el.value = val; fire(el, 'input'); fire(el); }
    };
    set('track',    race?.track);
    set('surface',  race?.surface);
    set('distance', race?.distance);
  }

  // ---------- OCR call & populate ----------
  async function callOCR(files) {
    if (!files?.length) throw new Error('No files selected.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); } // accept both keys server-side
    const res = await fetch('/api/photo_extract_openai_b64', { method:'POST', body:fd });
    let json; try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }
  async function processOCR(json) {
    const data   = json?.data || json;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses = Array.isArray(extracted?.horses) ? extracted.horses
                  : Array.isArray(data?.horses)     ? data.horses : [];
    setRaceMeta(extracted?.race || data?.race || {});
    let added = 0;
    for (const raw of horses) {
      const h = {
        name:    raw.name || raw.horse || raw.title || '',
        ml_odds: raw.ml_odds || raw.odds || '',
        jockey:  raw.jockey || '',
        trainer: raw.trainer || '',
      };
      if (!h.name) continue;
      if (await addHorseRow(h)) added++;
    }
    const badge  = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle');
    if (badge) { badge.textContent = 'Ready to analyze'; badge.className = 'badge ready'; }
    const result = $('#ocrResult') || $('[data-ocr-result]');
    if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type='info'; }
  }

  // When our controlled input changes → immediately extract
  photosInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    lastFiles = files;
    const badge = $('#statusBadge') || $('[data-status-badge]') || $('.idle');
    try {
      if (badge) { badge.textContent = 'Extracting…'; badge.className = 'badge extracting'; }
      setHud(`Uploading ${files.length} file(s)…`);
      const json = await callOCR(files);
      await processOCR(json);
      setHud(`Done. Parsed and populated from ${files.length} file(s).`);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err));
      setHud(`OCR error: ${msg}`);
      alert(`OCR error: ${msg}`);
    } finally {
      if (badge) { badge.textContent = 'Idle'; badge.className = 'badge idle'; }
      try { e.target.value = ''; } catch {}
    }
  });

  // Bind the visible "Choose Photos / PDF" button to our input
  function chooseBtn() {
    return document.getElementById('choosePhotosBtn')
        || document.querySelector('[data-action="choose-photos"]')
        || $$('button, a, input[type="button"], input[type="submit"]').find(el =>
             /^choose\s*photos\s*\/\s*pdf$/i.test((el.textContent || el.value || '').trim()));
  }
  function bindChoose() {
    const btn = chooseBtn();
    if (!btn || btn.dataset.finishlineChooseBound) return;
    btn.dataset.finishlineChooseBound = '1';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); photosInput.click(); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindChoose, { once:true }); else bindChoose();
  new MutationObserver(bindChoose).observe(document.body, { childList:true, subtree:true });

  // Bind the new, always-visible Safe Upload button to our controlled input
  (function bindSafeChoose(){
    const btn = $('#safeChooseBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => { e.preventDefault(); photosInput.click(); });
  })();

  // Bind "Extract from Photos" button to run with current selection (or prompt)
  function extractBtn() {
    return document.getElementById('extractFromPhotosBtn')
        || document.querySelector('[data-action="extract-photos"]')
        || $$('button, a, input[type="button"], input[type="submit"]').find(el =>
             /^extract\s+from\s+photos/i.test((el.textContent || el.value || '').trim()));
  }
  function bindExtract() {
    const btn = extractBtn();
    if (!btn || btn.dataset.finishlineExtractBound) return;
    btn.dataset.finishlineExtractBound = '1';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        let files = lastFiles;
        if (!files?.length) {
          // scan all inputs if our selection cache is empty
          const allInputs = $$('input[type="file"]');
          files = [];
          allInputs.forEach(i => i?.files?.length && files.push(...Array.from(i.files)));
        }
        if (!files?.length) { photosInput.click(); return; }   // ask user to pick; handler will continue
        const old = btn.textContent; btn.disabled = true; btn.textContent = 'Extracting…';
        setHud(`Uploading ${files.length} file(s)…`);
        const json = await callOCR(files);
        await processOCR(json);
        btn.textContent = old;
        setHud(`Done. Parsed and populated from ${files.length} file(s).`);
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err));
        setHud(`OCR error: ${msg}`);
        alert(`OCR error: ${msg}`);
      } finally {
        btn.disabled = false;
      }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindExtract, { once:true }); else bindExtract();
  new MutationObserver(bindExtract).observe(document.body, { childList:true, subtree:true });

  // Console helpers (for quick manual checks)
  window.finishline_pick   = () => photosInput.click();
  window.finishline_extract= async () => { if (!lastFiles.length) return alert('Pick files first'); const j = await callOCR(lastFiles); await processOCR(j); };

  // Drag & Drop fallback into the visible drop area
  (function enableDrop(){
    const dz = $('#dropzone'); if (!dz) return;
    ;['dragenter','dragover','dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, {passive:false}));
    dz.addEventListener('drop', async (e) => {
      const dt = e.dataTransfer; const files = dt ? Array.from(dt.files||[]) : [];
      if (!files.length) return;
      lastFiles = files;
      try {
        setHud(`Uploading ${files.length} file(s)…`);
        const json = await callOCR(files);
        await processOCR(json);
        setHud(`Done. Parsed and populated from ${files.length} file(s).`);
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err));
        setHud(`OCR error: ${msg}`);
        alert(`OCR error: ${msg}`);
      }
    });
  })();
})();