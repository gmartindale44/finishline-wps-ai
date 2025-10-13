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

  // === SEQUENTIAL HORSE POPULATION (single-row editor approach) ===
  
  // Utility: find an input by flexible label/placeholder/name/id match
  function findInput(hints) {
    const list = Array.isArray(hints) ? hints : [hints];
    const all = Array.from(document.querySelectorAll('input,textarea'));
    const rxes = list.map(h => (h instanceof RegExp ? h : new RegExp(String(h), 'i')));
    return all.find(el => {
      const ph   = el.getAttribute('placeholder') || '';
      const name = el.getAttribute('name') || '';
      const id   = el.getAttribute('id') || '';
      const aria = el.getAttribute('aria-label') || '';
      const lbl  = el.closest('label')?.textContent || '';
      const text = [ph, name, id, aria, lbl].join(' ');
      return rxes.every(rx => rx.test(text));
    });
  }

  // Stable single-row field getters for the "Horse Data" editor
  function getHorseNameInput()   { return findInput([/horse/i, /name/i]) || findInput('Horse Name'); }
  function getMlOddsInput()      { return findInput([/ml/i, /odds/i]) || findInput(/odds/i); }
  function getJockeyInput()      { return findInput(/jockey/i); }
  function getTrainerInput()     { return findInput(/trainer/i); }

  // Find the "Add Horse" button by text or data attribute
  function getAddHorseBtn() {
    return addHorseBtn ||
           document.getElementById('addHorseBtn') ||
           document.querySelector('[data-action="add-horse"]') ||
           Array.from(document.querySelectorAll('button, a')).find(b => /add\s*horse/i.test(b.textContent || ''));
  }

  // Helpers to set value and fire events so app state updates
  function setVal(el, value) {
    if (!el || value == null) return;
    el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Sequential population: fill editor, click Add Horse, repeat
  async function populateHorsesSequential(horses, statusCb) {
    const addBtn = getAddHorseBtn();
    if (!addBtn) {
      statusCb?.('Could not find "Add Horse" button');
      console.warn('[FinishLine] Add Horse button not found');
      return 0;
    }
    
    let count = 0;
    console.info(`[FinishLine] Starting sequential population of ${horses.length} horses`);

    for (const h of horses) {
      // 1) Fill the editor row
      setVal(getHorseNameInput(), h?.name || '');
      setVal(getMlOddsInput(),    h?.ml_odds || h?.odds || '');
      setVal(getJockeyInput(),    h?.jockey || '');
      setVal(getTrainerInput(),   h?.trainer || '');

      console.debug(`[FinishLine] Filled horse ${count + 1}: ${h?.name || '(unnamed)'}`);

      // Tiny pause to allow reactive validation
      await sleep(40);

      // 2) Click Add Horse (app should append & clear fields)
      addBtn.click();
      count += 1;

      // Allow DOM/state to settle before next horse
      await sleep(80);
    }
    
    statusCb?.(`✅ OCR parsed and populated ${count} horses.`);
    console.info(`[FinishLine] Sequential population complete: ${count} horses added`);
    return count;
  }

  // === GLOBAL HOOK FOR EXTERNAL CALLS ===
  window.__finishline_fillFromOCR = async function(extracted) {
    console.info('[FinishLine] __finishline_fillFromOCR called with:', extracted);
    
    // Fill race meta
    const setRace = (ids, val) => {
      if (val == null) return;
      const el = document.getElementById(ids) || 
                 document.querySelector(`[name="${ids}"]`) || 
                 document.querySelector(`[data-field="${ids}"]`);
      if (el) {
        setVal(el, val);
        console.debug(`[FinishLine] Set race ${ids} = ${val}`);
      }
    };
    
    const race = extracted?.race || {};
    setRace('raceDate', race.date);
    setRace('track',    race.track);
    setRace('surface',  race.surface);
    setRace('distance', race.distance);

    // Populate horses sequentially through single-row editor
    const horses = Array.isArray(extracted?.horses) ? extracted.horses : [];
    await populateHorsesSequential(horses, (msg) => show(msg, 'info'));
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
