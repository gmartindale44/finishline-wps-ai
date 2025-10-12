// Minimal, clean upload handler (uses proper FormData; no manual Content-Type; real messages)
(() => {
  const form = document.getElementById('ocrForm') || document.getElementById('raceForm');
  const pickBtn = document.getElementById('choosePhotosBtn') || document.getElementById('btnChoosePhotos') || document.querySelector('[data-action="choose-photos"]');
  const fileInput = document.getElementById('fileInput') || document.getElementById('photoFiles') || (() => {
    const el = document.createElement('input');
    el.type = 'file'; el.multiple = true; el.id = 'fileInput'; el.style.display = 'none';
    document.body.appendChild(el); return el;
  })();
  const resultBox = document.getElementById('ocrResult');
  const extractBtn = document.getElementById('extractBtn') || document.getElementById('btnExtract') || document.querySelector('[data-action="extract"]');
  const countBadge = document.getElementById('photoCount') || document.getElementById('photo-count');
  const bucket = [];

  const show = (t, type='info') => {
    const msg = typeof t === 'string' ? t : (t?.message || JSON.stringify(t));
    if (resultBox) {
      resultBox.textContent = msg;
      resultBox.dataset.type = type;
      resultBox.style.display = 'block';
      resultBox.style.background = type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)';
      resultBox.style.color = type === 'error' ? '#fca5a5' : '#86efac';
      resultBox.style.border = type === 'error' ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(34,197,94,0.4)';
    } else {
      (type==='error'?console.error:console.log)(msg);
      if (type==='error') alert(msg);
    }
  };

  const addFiles = (list) => {
  if (!list) return;
    bucket.length = 0; // Clear and refill
    for (const f of list) if (f?.name) bucket.push(f);
    refresh();
    console.debug('[FinishLine] Added files:', bucket.map(f => ({name:f.name,size:f.size,type:f.type})));
  };
  
  const refresh = () => {
    if (countBadge) countBadge.textContent = `${bucket.length} / 6 selected`;
  };

  if (pickBtn && fileInput) {
    pickBtn.addEventListener('click', e => {
      e.preventDefault();
      fileInput.click();
    });
    console.info('[FinishLine] Wired pick button to file input');
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
    if (!bucket.length) {
      show('No files selected. Choose images/PDFs first.', 'error');
        return null;
    }
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

  async function onSubmit(e) {
    if (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    try {
      const out = await send();
      if (!out) return; // No files
      
      show('✅ OCR upload successful. Files received by server.', 'info');
      const pretty = document.getElementById('ocrJson');
      if (pretty) {
        pretty.textContent = JSON.stringify(out, null, 2);
        pretty.style.display = 'block';
      }
      console.info('[FinishLine] Upload successful:', out);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      show(`OCR error: ${msg}`, 'error');
      console.error('[FinishLine] Upload failed:', err);
    }
  }

  if (extractBtn) {
    extractBtn.addEventListener('click', onSubmit, true);
    console.info('[FinishLine] Extract button listener attached (capture phase)');
  }
  if (form) {
    form.addEventListener('submit', onSubmit, true);
    console.info('[FinishLine] Form submit listener attached (capture phase)');
  }
  
  refresh();
  console.info('[FinishLine] app.js loaded ✔');
    })();

// --- Photo picker state (keep existing) ---
window.PICKED_FILES = window.PICKED_FILES || [];

function updatePhotoCount() {
  const el = document.getElementById("photo-count") || document.getElementById("photoCount");
  if (el) el.textContent = `${(window.PICKED_FILES || []).length} / 6 selected`;
}
