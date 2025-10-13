// Client: submit, render JSON, and FILL the form when OCR returns structured values.
// NOTE: keep your existing styles and HTML. We only wire IDs safely.

(() => {
  console.info('[FinishLine] app.js loaded with OCR auto-fill ✔');

  const form = document.getElementById('raceForm') || document.getElementById('ocrForm') || document.querySelector('form[data-ocr]');
  const extractBtn = document.getElementById('extractBtn') || document.getElementById('btnExtract') || document.querySelector('[data-action="extract"]');
  const chooseBtn  = document.getElementById('choosePhotosBtn') || document.getElementById('btnChoosePhotos') || document.querySelector('[data-action="choose-photos"]');
  const fileInput  = document.getElementById('fileInput') || document.getElementById('photoFiles') || (() => {
    const el = document.createElement('input'); el.type = 'file'; el.multiple = true; el.id = 'fileInput'; el.style.display='none';
    document.body.appendChild(el); return el;
  })();
  const resultBox  = document.getElementById('ocrResult');
  const prettyBox  = document.getElementById('ocrJson');
  const countBadge = document.getElementById('photoCount') || document.getElementById('photo-count');

  const bucket = [];
  
  const show = (msg, type='info') => {
    const text = typeof msg === 'string' ? msg : (msg?.message || JSON.stringify(msg));
    if (resultBox) {
      resultBox.textContent = text;
      resultBox.dataset.type = type;
      resultBox.style.display = 'block';
      resultBox.style.background = type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)';
      resultBox.style.color = type === 'error' ? '#fca5a5' : '#86efac';
      resultBox.style.border = type === 'error' ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(34,197,94,0.4)';
    } else {
      (type==='error'?console.error:console.log)(text);
      if (type==='error') alert(text);
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
    console.info('[FinishLine] Wired choose button to file input');
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', e => addFiles(e.target.files));
    console.info('[FinishLine] File input listener attached');
  }

  // Drag & drop support
  const dropzone = document.getElementById('drop-zone') || document.getElementById('photoDropzone') || document.querySelector('[data-dropzone]');
  if (dropzone) {
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      addFiles(e.dataTransfer?.files);
    });
    console.info('[FinishLine] Drag & drop listeners attached');
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

  // --- Fill the form from OCR JSON ---
  function setValue(candidates, value) {
    if (value == null) return;
    const ids = Array.isArray(candidates) ? candidates : [candidates];
    for (const id of ids) {
      const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`) || document.querySelector(`[data-field="${id}"]`);
      if (el) {
        el.value = value;
        console.debug(`[FinishLine] Set ${id} = ${value}`);
        return;
      }
    }
  }

  function fillForm(extracted) {
    if (!extracted) return;
    
    console.info('[FinishLine] Auto-filling form from OCR data:', extracted);
    
    // Race block
    const race = extracted.race || {};
    setValue(['raceDate','race-date','inputRaceDate'], race.date);
    setValue(['raceTrack','track','inputTrack'], race.track);
    setValue(['raceSurface','surface','inputSurface'], race.surface);
    setValue(['raceDistance','distance','inputDistance'], race.distance);
    
    // Horse block (single horse for now - can extend to multiple)
    const horse = extracted.horse || {};
    
    // Try to find first empty horse name input, or use the first one
    const horseNameInputs = Array.from(document.querySelectorAll('input.horse-name, input[data-field="name"], input[placeholder*="Horse Name" i]'));
    const oddsInputs = Array.from(document.querySelectorAll('input.horse-odds, input[data-field="odds"], input[placeholder*="Odds" i]'));
    const jockeyInputs = Array.from(document.querySelectorAll('input.horse-jockey, input[data-field="jockey"], input[placeholder*="Jockey" i]'));
    const trainerInputs = Array.from(document.querySelectorAll('input.horse-trainer, input[data-field="trainer"], input[placeholder*="Trainer" i]'));
    
    if (horseNameInputs[0] && horse.name) {
      horseNameInputs[0].value = horse.name;
      console.debug(`[FinishLine] Set horse name = ${horse.name}`);
    }
    if (oddsInputs[0] && horse.ml_odds) {
      oddsInputs[0].value = horse.ml_odds;
      console.debug(`[FinishLine] Set ML odds = ${horse.ml_odds}`);
    }
    if (jockeyInputs[0] && horse.jockey) {
      jockeyInputs[0].value = horse.jockey;
      console.debug(`[FinishLine] Set jockey = ${horse.jockey}`);
    }
    if (trainerInputs[0] && horse.trainer) {
      trainerInputs[0].value = horse.trainer;
      console.debug(`[FinishLine] Set trainer = ${horse.trainer}`);
    }
    
    show('✅ Form auto-filled from OCR data', 'info');
  }

  async function onExtract(ev){
    if (ev){ ev.preventDefault(); ev.stopImmediatePropagation(); }
    try {
      const payload = await send();
      show('OCR upload successful. Files received by server.','info');
      
      if (prettyBox) {
        prettyBox.textContent = JSON.stringify(payload, null, 2);
        prettyBox.style.display = 'block';
      }

      // Try to fill from returned structured data
      const extracted = payload?.data?.extracted;
      const ocrErr    = payload?.data?.ocr_error;
      
      if (extracted) {
        fillForm(extracted);
      }
      if (!extracted && ocrErr) {
        show(`OCR note: ${ocrErr}`, 'error');
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
    console.info('[FinishLine] Extract button listener attached (capture phase)');
  }
  if (form) {
    form.addEventListener('submit', onExtract, true);
    console.info('[FinishLine] Form submit listener attached (capture phase)');
  }
  
  console.info('[FinishLine] Initialization complete');
})();

// --- Photo picker state (keep existing) ---
window.PICKED_FILES = window.PICKED_FILES || [];

function updatePhotoCount() {
  const el = document.getElementById("photo-count") || document.getElementById("photoCount");
  if (el) el.textContent = `${(window.PICKED_FILES || []).length} / 6 selected`;
}
