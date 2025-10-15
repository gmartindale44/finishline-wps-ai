// Restore original upload + robust OCR → form population + no date requirement

(() => {
  // ======= CLEANUP: remove any previous temporary widgets (FAB/debug panel/overlay) =======
  ['finishline-upload-fab','finishline-emergency-picker','finishline-debug-uploader','finishline-screen-picker']
    .forEach(id => document.getElementById(id)?.remove());

  // ======= Small utilities =======
  const $  = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
  const setBadge = (txt, cls='ready') => {
    const badge = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle');
    if (badge) { badge.textContent = txt; badge.className = `badge ${cls}`; }
  };

  // ======= Shared file bucket (used by our send) =======
  window.__finishline_bucket = window.__finishline_bucket || [];
  window.__finishline_getFiles = () => window.__finishline_bucket;

  // ======= Find canonical controls (tolerant to class/ID drift) =======
  function findChooseBtn() {
    return document.getElementById('choosePhotosBtn')
        || document.querySelector('[data-action="choose-photos"]')
        || $$('button, a, input[type="button"], input[type="submit"]').find(el =>
             /^choose\s*photos\s*\/\s*pdf$/i.test((el.textContent || el.value || '').trim()));
  }
  function findExtractBtn() {
    return document.getElementById('extractFromPhotosBtn')
        || document.querySelector('[data-action="extract-photos"]')
        || $$('button, a, input[type="button"], input[type="submit"]').find(el =>
             /^(extract\s+from\s+photos|extract\s+photos)/i.test((el.textContent || el.value || '').trim()));
  }

  // ======= Single hidden native input (the original UX) =======
  function ensureHiddenPicker() {
    let inp = document.getElementById('finishline-file-input');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.id   = 'finishline-file-input';
      inp.multiple = true;
      inp.accept  = 'image/*,.pdf';
      inp.style.position = 'fixed';
      inp.style.left = '-9999px';
      document.body.appendChild(inp);
      inp.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) if (f && f.name) window.__finishline_bucket.push(f);
        e.target.value = ''; // allow re-select same file
        const badge = document.getElementById('photoCount') || document.querySelector('[data-photo-count]');
        if (badge) badge.textContent = `${window.__finishline_bucket.length} / 6 selected`;
      });
    }
    return inp;
  }

  // ======= Wire original "Choose Photos / PDF" =======
  const chooseBtn = findChooseBtn();
  if (chooseBtn && !chooseBtn.dataset.finishlineBound) {
    chooseBtn.dataset.finishlineBound = '1';
    chooseBtn.addEventListener('click', (e) => { e.preventDefault(); ensureHiddenPicker().click(); }, true);
  }

  // ======= NO DATE REQUIRED: Never block actions because of empty date =======
  // If any client-side validator exists, neutralize it here (leave form UX intact)
  const dateField = $('#raceDate') || $('[name="raceDate"]');
  if (dateField) dateField.removeAttribute('required');

  // ======= OCR editor traversal =======
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
  function getAddHorseControl() {
    const scope = getEditorContainer() || document;
    const btnByText = $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()));
    if (btnByText) return btnByText;
    return scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }
  function horseRowsCount() {
    // count any visible rows / cards that represent added horses
    return (
      $$('.horse-list .horse-row').length ||
      $$('.horses .row').length ||
      $$('.horse-items .item').length ||
      $$('.added-horses .row').length ||
      // fallback: count delete buttons within list area if present
      $$('[data-horse-row], .horse-row, .horse-card').length
    );
  }

  async function addOneHorse(h) {
    const nameEl = findEditorNameInput();
    if (!nameEl) return false;

    nameEl.value = h?.name || '';
    fire(nameEl);
    const oddsEl = getOddsInput();    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl    = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;  fire(jEl); }
    const tEl    = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }

    await sleep(50);

    const before = horseRowsCount();
    const form   = nameEl.closest('form');
    const addBtn = getAddHorseControl();

    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
    else if (addBtn) addBtn.click();

    // Wait for either a new row or the editor name to clear (typical UX)
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await sleep(80);
      const now = horseRowsCount();
      if (now > before) return true;
      if (findEditorNameInput()?.value === '') return true;
    }
    return true; // don't block subsequent horses
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
    // date is optional – do not force it
  }

  // ======= OCR processing → populate form (adds ALL horses) =======
  async function finishline_process_ocr(json) {
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
      const ok = await addOneHorse(h);
      if (ok) added++;
    }

    // Hide any JSON debug dump if present
    const pre = document.getElementById('ocrJson');
    if (pre) pre.style.display = 'none';

    const result = $('#ocrResult') || $('[data-ocr-result]');
    if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type='info'; }
    setBadge('Ready to analyze', 'ready');
  }
  window.finishline_process_ocr = finishline_process_ocr;

  // ======= POST to backend using the shared bucket =======
  async function sendToOCR() {
    const files = window.__finishline_getFiles();
    if (!files.length) throw new Error('No files selected. Choose images/PDFs first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); } // tolerant server-side
    const res  = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json;
    try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // Expose for console/manual trigger
  window.finishline_extractNow = async function () {
    const json = await sendToOCR();
    await finishline_process_ocr(json);
  };

  // ======= Wire original "Extract from Photos" button to work again =======
  const extractBtn = findExtractBtn();
  if (extractBtn && !extractBtn.dataset.finishlineBound) {
    extractBtn.dataset.finishlineBound = '1';
    extractBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        extractBtn.disabled = true; extractBtn.dataset.label = extractBtn.textContent; extractBtn.textContent = 'Extracting…';
        await window.finishline_extractNow();
      } catch (err) {
        alert(`OCR error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        extractBtn.disabled = false; if (extractBtn.dataset.label) extractBtn.textContent = extractBtn.dataset.label;
      }
    }, true);
  }
})();