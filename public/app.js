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

  function setValue(cands, value) {
    if (value == null) return;
    const ids = Array.isArray(cands) ? cands : [cands];
    for (const id of ids) {
      const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`) || document.querySelector(`[data-field="${id}"]`);
      if (el) {
        el.value = value;
        console.debug(`[FinishLine] Set ${id} = ${value}`);
        return;
      }
    }
  }

  // Find all horse input columns
  function $$name()    { return document.querySelectorAll('.horse-row .horse-name, .horse-name, [data-col="name"] input, [data-field="name"], input[placeholder*="Horse Name" i]'); }
  function $$odds()    { return document.querySelectorAll('.horse-row .horse-odds, .horse-odds, [data-col="odds"] input, [data-field="odds"], input[placeholder*="Odds" i]'); }
  function $$jockey()  { return document.querySelectorAll('.horse-row .horse-jockey, .horse-jockey, .jj, [data-col="jockey"] input, [data-field="jockey"], input[placeholder*="Jockey" i]'); }
  function $$trainer() { return document.querySelectorAll('.horse-row .horse-trainer, .horse-trainer, .tt, [data-col="trainer"] input, [data-field="trainer"], input[placeholder*="Trainer" i]'); }

  function ensureRows(n) {
    if (!addHorseBtn) {
      console.warn('[FinishLine] Add Horse button not found, cannot create rows');
            return;
    }
    
    let tries = 0;
    const maxTries = n + 10;
    
    while (tries < maxTries) {
      const currentRows = Math.max($$name().length, $$odds().length, $$jockey().length, $$trainer().length);
      if (currentRows >= n) {
        console.info(`[FinishLine] Ensured ${n} horse rows (current: ${currentRows})`);
          return;
        }

      console.debug(`[FinishLine] Adding row ${currentRows + 1}/${n}`);
      addHorseBtn.click();
      tries++;
    }
    
    console.warn(`[FinishLine] Could not create ${n} rows after ${maxTries} tries`);
  }

  function fillRace(r) {
    if (!r) return;
    console.info('[FinishLine] Filling race data:', r);
    setValue(['raceDate','race-date','inputRaceDate'], r.date);
    setValue(['raceTrack','track','inputTrack'], r.track);
    setValue(['raceSurface','surface','inputSurface'], r.surface);
    setValue(['raceDistance','distance','inputDistance'], r.distance);
  }

  function fillHorses(horses) {
    if (!Array.isArray(horses) || !horses.length) {
      console.warn('[FinishLine] No horses to fill');
          return;
        }
        
    console.info(`[FinishLine] Filling ${horses.length} horses:`, horses);
    ensureRows(horses.length);
    
    const nameC = $$name();
    const oddsC = $$odds();
    const jockeyC = $$jockey();
    const trainerC = $$trainer();
    
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
        fillRace(ex.race);
        fillHorses(ex.horses);
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
