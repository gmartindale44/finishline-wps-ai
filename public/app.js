// FinishLine WPS — Loader Self-Test + Independent Debug Uploader (does NOT touch your existing UI)
(() => {
  // --- Self-test banner so we KNOW this script is loaded ---
  try {
    const bannerId = 'finishline-selftest';
    if (!document.getElementById(bannerId)) {
      const b = document.createElement('div');
      b.id = bannerId;
      b.textContent = 'FinishLine app.js loaded ✔';
      Object.assign(b.style, {
        position: 'fixed', top: '8px', right: '8px', zIndex: '2147483647',
        background: '#0ea5e9', color: '#fff', padding: '6px 10px',
        borderRadius: '8px', fontSize: '12px', boxShadow: '0 6px 18px rgba(0,0,0,.2)'
      });
      const close = document.createElement('button');
      close.textContent = '×'; close.title = 'Hide';
      Object.assign(close.style, { marginLeft: '8px', background: 'transparent', border: 'none', color: '#fff', fontSize: '14px', cursor: 'pointer' });
      close.onclick = () => b.remove();
      b.appendChild(close);
      document.body.appendChild(b);
    }
    console.info('[FinishLine] app.js loaded ✔');
  } catch (e) {}

  // --- Shared bucket + helpers (independent of your UI) ---
  window.__finishline_bucket = window.__finishline_bucket || [];
  function addFiles(list) {
    const arr = Array.from(list || []);
    for (const f of arr) if (f && f.name) window.__finishline_bucket.push(f);
  }
  async function sendToOCR() {
    const files = window.__finishline_bucket;
    if (!files.length) throw new Error('No files selected. Choose images or PDFs first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); }
    const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json; try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // --- Floating Debug Uploader (does not interfere with your app) ---
  if (!document.getElementById('finishline-debug-uploader')) {
    const panel = document.createElement('div');
    panel.id = 'finishline-debug-uploader';
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">Upload Debug Panel</div>
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
        <input id="finishline-debug-input" type="file" multiple accept="image/*,.pdf" />
        <button id="finishline-debug-send" type="button">Send to OCR</button>
        <button id="finishline-debug-clear" type="button">Clear</button>
        <button id="finishline-debug-hide" type="button">Hide</button>
      </div>
      <div id="finishline-debug-status" style="font-size:12px; opacity:.9;">0 selected</div>
    `;
    Object.assign(panel.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483646',
      background: 'rgba(26,28,35,.95)', color: '#fff', padding: '10px 12px',
      border: '1px solid rgba(255,255,255,.08)', borderRadius: '10px',
      boxShadow: '0 8px 28px rgba(0,0,0,.35)', fontSize: '12px'
    });
    document.body.appendChild(panel);

    const fileEl = panel.querySelector('#finishline-debug-input');
    const sendEl = panel.querySelector('#finishline-debug-send');
    const clearEl= panel.querySelector('#finishline-debug-clear');
    const hideEl = panel.querySelector('#finishline-debug-hide');
    const status = panel.querySelector('#finishline-debug-status');

    const update = () => { status.textContent = `${window.__finishline_bucket.length} selected`; };

    fileEl.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value=''; update(); });
    clearEl.addEventListener('click', () => { window.__finishline_bucket = []; update(); });
    hideEl.addEventListener('click', () => panel.remove());
    sendEl.addEventListener('click', async () => {
      sendEl.disabled = true; sendEl.textContent = 'Uploading…';
      try {
        const json = await sendToOCR();
        console.log('[FinishLine][OCR]', json);
        status.textContent = 'Uploaded ✔ — open DevTools → Network → photo_extract_openai_b64 to verify.';
        alert('OCR upload OK. Check DevTools Network for response JSON.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        status.textContent = `Error: ${msg}`;
        alert(`OCR error: ${msg}`);
      } finally {
        sendEl.disabled = false; sendEl.textContent = 'Send to OCR';
      }
    });

    update();
  }
})();