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

  // === ROBUST ROW SELECTORS (no reliance on duplicate IDs) ===
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  // Find inputs by placeholder/label text across all rows (case-insensitive).
  function findByPlaceholderLike(text) {
    const rx = new RegExp(text, 'i');
    return $all('input,textarea').filter(el => {
      const ph = el.getAttribute('placeholder') || '';
      const lbl = (el.closest('label')?.textContent || '');
      const aria = el.getAttribute('aria-label') || '';
      return rx.test(ph) || rx.test(lbl) || rx.test(aria);
    });
  }

  // Column lists in DOM order (these return ALL rows in order)
  function cols_name()    { return findByPlaceholderLike('horse name'); }
  function cols_odds()    { return findByPlaceholderLike('ml odds|odds'); }
  function cols_jockey()  { return findByPlaceholderLike('jockey'); }
  function cols_trainer() { return findByPlaceholderLike('trainer'); }

  // Add rows until we have at least n fields in *each* column.
  function ensureRows(n) {
    const addBtn = addHorseBtn || 
                   document.querySelector('[data-action="add-horse"]') ||
                   document.querySelector('#AddHorse, .add-horse, button.add-horse, button:has(+ [placeholder*="Jockey" i])');

    if (!addBtn) {
      console.warn('[FinishLine] Add Horse button not found, cannot create rows');
      return;
    }

    let guard = 0;
    while (Math.min(
      cols_name().length,
      cols_odds().length,
      cols_jockey().length,
      cols_trainer().length
    ) < n && guard < n + 10) {
      console.debug(`[FinishLine] Creating row ${guard + 1} for ${n} horses`);
      addBtn.click();
      guard++;
    }
    
    const currentRows = Math.min(cols_name().length, cols_odds().length, cols_jockey().length, cols_trainer().length);
    console.info(`[FinishLine] Ensured ${n} horse rows (current: ${currentRows})`);
  }

  // === FILL FUNCTIONS ===
  function fillRace(r) {
    const setValue = (cands, value) => {
      if (value == null) return;
      const ids = Array.isArray(cands) ? cands : [cands];
      for (const id of ids) {
        const el = document.getElementById(id) ||
                   document.querySelector(`[name="${id}"]`) ||
                   document.querySelector(`[data-field="${id}"]`) ||
                   findByPlaceholderLike(id)[0];
        if (el) {
          el.value = value;
          console.debug(`[FinishLine] Set ${id} = ${value}`);
          return;
        }
      }
    };
    
    if (!r) return;
    console.info('[FinishLine] Filling race data:', r);
    setValue(['raceDate','date'], r.date);
    setValue(['track'], r.track);
    setValue(['surface'], r.surface);
    setValue(['distance'], r.distance);
  }

  function fillHorses(horses) {
    if (!Array.isArray(horses) || !horses.length) {
      console.warn('[FinishLine] No horses to fill');
      return;
    }

    console.info(`[FinishLine] Filling ${horses.length} horses:`, horses);
    
    // 1) Make sure we have enough rows
    ensureRows(horses.length);

    // 2) Get live NodeLists AFTER rows are added
    const nameC    = cols_name();
    const oddsC    = cols_odds();
    const jockeyC  = cols_jockey();
    const trainerC = cols_trainer();

    // 3) Assign by index
    horses.forEach((h, i) => {
      const n = nameC[i];
      const o = oddsC[i];
      const j = jockeyC[i];
      const t = trainerC[i];
      
      if (n && h?.name) {
        n.value = h.name;
        console.debug(`[FinishLine] Horse ${i+1} name: ${h.name}`);
      }
      if (o && h?.ml_odds) {
        o.value = h.ml_odds;
        console.debug(`[FinishLine] Horse ${i+1} odds: ${h.ml_odds}`);
      }
      if (j && h?.jockey) {
        j.value = h.jockey;
        console.debug(`[FinishLine] Horse ${i+1} jockey: ${h.jockey}`);
      }
      if (t && h?.trainer) {
        t.value = h.trainer;
        console.debug(`[FinishLine] Horse ${i+1} trainer: ${h.trainer}`);
      }
    });
  }

  // === GLOBAL HOOK FOR EXTERNAL CALLS ===
  window.__finishline_fillFromOCR = function(extracted) {
    fillRace(extracted?.race);
    fillHorses(extracted?.horses);
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
        // Use global hook for robust filling
        window.__finishline_fillFromOCR(ex);
        show(`✅ OCR parsed and populated ${ex.horses?.length || 0} horses.`, 'info');
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
