// Fill form from { race, horses[] } and show any ocr_error note.

(() => {
  console.info('[FinishLine] app.js loaded with multi-horse OCR ✔');

  const form        = document.getElementById('raceForm') || document.getElementById('ocrForm') || document.querySelector('form[data-ocr]');
  const extractBtn  = document.getElementById('extractBtn') || document.getElementById('btnExtract') || document.querySelector('[data-action="extract"]');
  const chooseBtn   = document.getElementById('choosePhotosBtn') || document.getElementById('btnChoosePhotos') || document.querySelector('[data-action="choose-photos"]');
  const fileInput   = document.getElementById('fileInput') || document.getElementById('photoFiles') || (() => {
    const el = document.createElement('input'); el.type='file'; el.multiple=true; el.id='fileInput'; el.style.display='none'; document.body.appendChild(el); return el;
  })();
  const resultBox   = document.getElementById('ocrResult');
  const prettyBox   = document.getElementById('ocrJson');
  const countBadge  = document.getElementById('photoCount') || document.getElementById('photo-count');
  const addHorseBtn = document.getElementById('add-horse-btn') || document.getElementById('addHorseBtn') || document.getElementById('add-horse') || document.getElementById('btnAddHorse') || document.querySelector('[data-action="add-horse"]') || document.querySelector('[data-add-horse]');

  const bucket = [];
  
  const show = (m, t='info') => {
    const msg = typeof m === 'string' ? m : (m?.message || JSON.stringify(m));
    if (resultBox) {
      resultBox.textContent = msg;
      resultBox.dataset.type = t;
      resultBox.style.display = 'block';
      resultBox.style.background = t === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)';
      resultBox.style.color = t === 'error' ? '#fca5a5' : '#86efac';
      resultBox.style.border = t === 'error' ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(34,197,94,0.4)';
    } else {
      (t==='error'?console.error:console.log)(msg);
      if (t==='error') alert(msg);
    }
  };
  
  const addFiles = (list) => {
  if (!list) return;
    bucket.length = 0; // Clear and refill
    for (const f of list) if (f?.name) bucket.push(f);
    if (countBadge) countBadge.textContent = `${bucket.length} / 6 selected`;
    console.debug('[FinishLine] Added files:', bucket.map(f => ({name:f.name,size:f.size,type:f.type})));
  };
  
  if (chooseBtn && fileInput) {
    chooseBtn.addEventListener('click', e => {
      e.preventDefault();
        fileInput.click();
      });
    console.info('[FinishLine] Wired choose button');
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', e => addFiles(e.target.files));
    console.info('[FinishLine] File input listener attached');
  }

  // Drag & drop
  const dropzone = document.getElementById('drop-zone') || document.getElementById('photoDropzone') || document.querySelector('[data-dropzone]');
  if (dropzone) {
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      addFiles(e.dataTransfer?.files);
    });
    console.info('[FinishLine] Drag & drop attached');
  }

  async function send() {
    if (!bucket.length) throw new Error('No files selected. Choose images/PDFs first.');
    const fd = new FormData();
    for (const f of bucket) fd.append('files', f);
    for (const f of bucket) fd.append('photos', f);
    
    console.debug('[FinishLine] Uploading:', bucket.map(f => ({name:f.name,size:f.size,type:f.type})));
    const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Server returned non-JSON (HTTP ${res.status}).`);
    }
    
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // === SCOPED SEQUENTIAL HORSE POPULATION (editor container approach) ===
  
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  function fire(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Find "Horse Name" input (the single-row editor)
  function getHorseNameInput() {
    // Try common ids/names, then fallback to placeholder text
    return document.getElementById('horseName')
        || document.querySelector('input[name="horseName"]')
        || Array.from(document.querySelectorAll('input,textarea'))
             .find(el => /horse\s*name/i.test(
               [el.placeholder || '', el.name || '', el.id || '', el.getAttribute('aria-label') || ''].join(' ')
             ));
  }

  // Scope: nearest container that truly holds the editor row + its Add button
  function getEditorContainer() {
    const nameEl = getHorseNameInput();
    if (!nameEl) return null;
    // Prefer a section/card/fieldset around the input
    return nameEl.closest('[data-section="horse"], section, fieldset, .card, .panel, .horse-editor, .horse-data') || nameEl.parentElement;
  }

  // Within the editor container, find the *right* "Add Horse"
  function getAddHorseControl() {
    const scope = getEditorContainer() || document;
    // Prefer an explicit add button inside the editor scope
    const byText = Array.from(scope.querySelectorAll('button, a, input[type="button"], input[type="submit"]'))
      .find(el => /^(add\s*horse)$/i.test((el.textContent || el.value || '').trim()));
    if (byText) return byText;

    // Fallback: any element marked for adding inside the scope
    return scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  // Other editor inputs (ML Odds, Jockey, Trainer) – all resolved inside the editor container
  function findInEditor(match) {
    const scope = getEditorContainer() || document;
    const rx = match instanceof RegExp ? match : new RegExp(String(match), 'i');
    return Array.from(scope.querySelectorAll('input,textarea')).find(el => {
      const s = [el.placeholder || '', el.name || '', el.id || '', el.getAttribute('aria-label') || '', el.closest('label')?.textContent || ''].join(' ');
      return rx.test(s);
    });
  }
  const getMlOddsInput = () => findInEditor(/(ml\s*odds|odds)/i);
  const getJockeyInput = () => findInEditor(/jockey/i);
  const getTrainerInput= () => findInEditor(/trainer/i);

  // Add one horse via the editor container only
  async function addOneHorse(h) {
    const nameEl = getHorseNameInput();
    if (!nameEl) return false;

    // Fill fields in the editor
    if (h?.name)    { nameEl.value = h.name; fire(nameEl); }
    const oddsEl = getMlOddsInput();
    if (oddsEl && (h?.ml_odds || h?.odds)) {
      oddsEl.value = h.ml_odds || h.odds;
      fire(oddsEl);
    }
    const jEl = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;   fire(jEl); }
    const tEl = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer;  fire(tEl); }

    console.debug(`[FinishLine] Filled horse: ${h?.name || '(unnamed)'}`);
    await sleep(40); // let any masking/validation run

    // Prefer the Add button inside the editor; otherwise submit the editor form
    const addBtn = getAddHorseControl();
    const form   = nameEl.closest('form');
    if (addBtn) {
      console.debug('[FinishLine] Clicking Add Horse button');
      addBtn.click();
    } else if (form?.requestSubmit) {
      console.debug('[FinishLine] Submitting form via requestSubmit()');
      form.requestSubmit();
    } else if (form) {
      console.debug('[FinishLine] Submitting form via submit event');
      form.dispatchEvent(new Event('submit', { bubbles: true }));
    } else {
      console.warn('[FinishLine] No Add button or form found');
    }

    await sleep(100); // let the app append & clear the editor
    return true;
  }

  // === GLOBAL HOOK FOR EXTERNAL CALLS ===
  window.__finishline_fillFromOCR = async function(extracted) {
    console.info('[FinishLine] __finishline_fillFromOCR called with:', extracted);
    
    // Fill race meta (keep generic & tolerant)
    const setMeta = (selText, val) => {
      if (val == null) return;
      const el = document.getElementById(selText)
             || document.querySelector(`[name="${selText}"]`)
             || Array.from(document.querySelectorAll('input,select,textarea'))
                  .find(x => new RegExp(selText, 'i').test(
                    [x.placeholder || '', x.name || '', x.id || '', x.getAttribute('aria-label') || ''].join(' ')
                  ));
      if (el) {
        el.value = val;
        fire(el);
        console.debug(`[FinishLine] Set race ${selText} = ${val}`);
      }
    };
    
    const race = extracted?.race || {};
    setMeta('raceDate', race.date);
    setMeta('track',    race.track);
    setMeta('surface',  race.surface);
    setMeta('distance', race.distance);

    // Add horses sequentially **inside the editor container**
    const horses = Array.isArray(extracted?.horses) ? extracted.horses : [];
    let added = 0;
    console.info(`[FinishLine] Starting scoped sequential population of ${horses.length} horses`);
    
    for (const h of horses) {
      const ok = await addOneHorse(h);
      if (ok) added++;
    }

    // Status message
    if (resultBox) {
      resultBox.textContent = `✅ OCR parsed and populated ${added} horses.`;
      resultBox.dataset.type = 'info';
      resultBox.style.display = 'block';
    }
    console.info(`[FinishLine] Scoped sequential population complete: ${added} horses added`);
  };

  async function onExtract(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
    
    try {
      const payload = await send();
      
      if (prettyBox) {
        prettyBox.textContent = JSON.stringify(payload, null, 2);
        prettyBox.style.display = 'block';
      }

      const ex = payload?.data?.extracted;
      const note = payload?.data?.ocr_error;
      
      if (ex) {
        // Use global hook for sequential filling (async)
        await window.__finishline_fillFromOCR(ex);
      } else if (note) {
        show(`OCR note: ${note}`, 'error');
      } else {
        show('OCR returned no structured data.', 'error');
      }
      
      console.info('[FinishLine] Upload successful:', payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      show(`OCR error: ${msg}`, 'error');
      console.error('[FinishLine] Upload failed:', err);
    }
  }

  if (extractBtn) {
    extractBtn.addEventListener('click', onExtract, true);
    console.info('[FinishLine] Extract button attached (capture phase)');
  }
  if (form) {
    form.addEventListener('submit', onExtract, true);
    console.info('[FinishLine] Form submit attached (capture phase)');
  }
  
  console.info('[FinishLine] Initialization complete');
    })();
    
// --- Photo picker state (keep existing) ---
window.PICKED_FILES = window.PICKED_FILES || [];

function updatePhotoCount() {
  const el = document.getElementById("photo-count") || document.getElementById("photoCount");
  if (el) el.textContent = `${(window.PICKED_FILES || []).length} / 6 selected`;
}
