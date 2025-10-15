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

  // ---- drag & drop (if dropzone exists)
  const dz = $('#dropzone') || document.querySelector('[data-dropzone], .photos-dropzone');
  if (dz) {
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => dz.addEventListener(evt, stop, false));
    dz.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      for (const f of files) if (f && f.name) window.__finishline_bucket.push(f);
      updateSelectedCount();
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