// FinishLine WPS AI — Explicit Upload Path
// Uses a hidden <input type="file"> with styled button trigger

(() => {
  console.info('[FinishLine] app.js loaded ✔');  // Self-test

  const OCR_ENDPOINT = '/api/photo_extract_openai_b64';

  // UI hooks (robust fallbacks)
  const chooseBtn   = document.getElementById('choosePhotosBtn')
                   || document.getElementById('btnChoosePhotos')
                   || document.querySelector('[data-action="choose-photos"]');
  const fileInput   = document.getElementById('fileInput')
                   || document.getElementById('photoFiles')
                   || document.querySelector('input[type="file"]');
  const extractBtn  = document.getElementById('extractBtn')
                   || document.getElementById('btnExtract')
                   || document.querySelector('[data-action="extract"]');
  const form        = document.getElementById('raceForm')
                   || document.getElementById('ocrForm')
                   || document.querySelector('form[data-ocr]');
  const resultBox   = document.getElementById('ocrResult');
  const countBadge  = document.getElementById('photoCount')
                   || document.getElementById('photo-count');
  const dropzone    = document.getElementById('drop-zone')
                   || document.getElementById('photoDropzone')
                   || document.querySelector('[data-dropzone]');

  // Local file bucket (mirrors picks; survives UI re-renders)
  const bucket = [];

  function show(msg, type='info') {
    const text = typeof msg === 'string' ? msg : (msg?.message || JSON.stringify(msg));
    if (resultBox) {
      resultBox.textContent = text;
      resultBox.dataset.type = type;
      resultBox.style.display = 'block';
      resultBox.style.background = type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)';
      resultBox.style.color = type === 'error' ? '#fca5a5' : '#86efac';
      resultBox.style.border = type === 'error' ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(34,197,94,0.4)';
    } else {
      (type === 'error' ? console.error : console.log)(text);
      if (type === 'error') alert(text);
    }
  }

  function refreshCount() {
    if (!countBadge) return;
    countBadge.textContent = `${bucket.length} / 6 selected`;
  }

  function addFiles(list) {
    if (!list) return;
    for (const f of list) if (f && f.name) bucket.push(f);
    refreshCount();
    console.debug('[FinishLine] Added files:', bucket.map(f => ({name:f.name,size:f.size,type:f.type})));
  }

  // Open the real file picker when the user clicks your styled button
  if (chooseBtn && fileInput) {
    chooseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      fileInput.click();
    });
    console.info('[FinishLine] Wired "Choose Photos" button to file input');
  }

  // Mirror chosen files into our bucket
  if (fileInput) {
    if (!fileInput.hasAttribute('multiple')) fileInput.setAttribute('multiple','');
    fileInput.addEventListener('change', (e) => {
      // Clear bucket and refill from current selection
      bucket.length = 0;
      addFiles(e.target.files);
    });
    console.info('[FinishLine] File input change listener attached');
  }

  // Also support drag/drop if you have a dropzone element
  if (dropzone) {
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      bucket.length = 0; // Clear and refill
      addFiles(e.dataTransfer?.files);
    });
    console.info('[FinishLine] Drag & drop listeners attached');
  }

  async function sendMultipart(files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    for (const f of files) fd.append('photos', f);
    // IMPORTANT: no manual Content-Type
    const res = await fetch(OCR_ENDPOINT, { method: 'POST', body: fd });
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

  async function handleExtract(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
    const files = bucket.slice();
    if (!files.length) {
      show('No files selected. Click "Choose Photos / PDF" and pick 1–6 files.', 'error');
        return;
      }
    console.debug('[FinishLine] Uploading:', files.map(f => ({name:f.name,size:f.size,type:f.type})));
    try {
      const payload = await sendMultipart(files);
      show('✅ OCR upload successful. Files received by server.', 'info');
      const pretty = document.getElementById('ocrJson');
      if (pretty) {
        pretty.textContent = JSON.stringify(payload, null, 2);
        pretty.style.display = 'block';
      }
      console.info('[FinishLine] Upload successful:', payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      show(`OCR error: ${msg}`, 'error');
      console.error('[FinishLine] Upload failed:', err);
    }
  }

  // Bind both the button and the form (capture-phase so we beat any other handlers)
  if (extractBtn) {
    extractBtn.addEventListener('click', handleExtract, true);
    console.info('[FinishLine] Extract button click listener attached (capture phase)');
  }
  if (form) {
    form.addEventListener('submit', handleExtract, true);
    console.info('[FinishLine] Form submit listener attached (capture phase)');
  }

  refreshCount();
  console.info('[FinishLine] Initialization complete');
    })();

// --- Photo picker state (keep existing) ---
window.PICKED_FILES = window.PICKED_FILES || [];

function updatePhotoCount() {
  const el = document.getElementById("photo-count") || document.getElementById("photoCount");
  if (el) el.textContent = `${(window.PICKED_FILES || []).length} / 6 selected`;
}
