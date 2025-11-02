(function () {
  const state = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    analyzed: false,
    parsedHorses: [],
  });

  function qAnalyze() {
    return document.querySelector('[data-fl-analyze]') || document.getElementById('analyze-btn') || document.querySelector('button.analyze');
  }

  function qPredict() {
    return document.querySelector('[data-fl-predict]') || document.getElementById('predict-btn') || document.querySelector('button.predict');
  }

  function enable(el, on = true) {
    if (!el) return;
    // Idempotent: no-op if already set
    if (el.disabled === !on && el.classList.contains('disabled') === !on) return;
    el.disabled = !on;
    el.classList.toggle('disabled', !on);
    el.setAttribute('aria-disabled', String(!on));
  }

  // Toast helper
  function toast(msg, kind = 'info') {
    const container = document.getElementById('fl-toast');
    if (!container) {
      console.log(`[${kind}]`, msg);
      return;
    }
    const colors = { info: '#4a90e2', success: '#5cb85c', warn: '#f0ad4e', error: '#d9534f' };
    container.style.display = 'block';
    container.style.background = colors[kind] || colors.info;
    container.textContent = msg;
    setTimeout(() => {
      container.style.display = 'none';
    }, kind === 'error' ? 8000 : 4000);
  }

  // Busy helper
  async function withBusy(btn, fn) {
    const wasDisabled = btn.disabled;
    enable(btn, false);
    try {
      return await fn();
    } finally {
      enable(btn, !wasDisabled);
    }
  }

  // PDF first page to PNG data URL
  async function pdfFirstPageToDataURL(file) {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js not loaded');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    const dataURL = canvas.toDataURL('image/png');
    const b64 = dataURL.split(',')[1];
    return { b64, mime: 'image/png' };
  }

  // Downscale image to data URL
  async function downscaleImageToDataURL(fileOrDataURL, maxW = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW) {
          height = (height * maxW) / width;
          width = maxW;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataURL = canvas.toDataURL('image/jpeg', 0.9);
        const b64 = dataURL.split(',')[1];
        resolve({ b64, mime: 'image/jpeg' });
      };
      img.onerror = reject;
      if (typeof fileOrDataURL === 'string') {
        img.src = fileOrDataURL;
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(fileOrDataURL);
      }
    });
  }

  // Parse text to horses using normalizeHorsesFromText logic
  function parseHorsesFromText(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
    const out = [];
    for (const raw of lines) {
      const line = String(raw || '').trim().replace(/\s+/g, ' ');
      if (!line) continue;
      let cols = line.includes('|')
        ? line.split('|').map(s => s.trim())
        : line.split(/\s{2,}/).map(s => s.trim());
      const [name, odds, jockey, trainer] = [
        cols[0] || '',
        cols[1] || '',
        cols[2] || '',
        cols[3] || '',
      ].map(s => s.trim());
      if (name && name.length > 1) {
        out.push({ name, odds, jockey, trainer });
      }
    }
    return out;
  }

  async function onAnalyze() {
    const analyzeBtn = qAnalyze();
    const predictBtn = qPredict();

    if (!state.pickedFiles || state.pickedFiles.length === 0) {
      toast('Please choose at least one image or PDF first.', 'warn');
      return;
    }

    await withBusy(analyzeBtn, async () => {
      try {
        toast('Processing file...', 'info');
        const file = state.pickedFiles[0]; // Process first file only

        let b64, mime;
        if (file.type === 'application/pdf') {
          toast('Extracting first page from PDF...', 'info');
          ({ b64, mime } = await pdfFirstPageToDataURL(file));
        } else {
          toast('Preparing image...', 'info');
          ({ b64, mime } = await downscaleImageToDataURL(file));
        }

        toast('Sending to OCR...', 'info');
        
        // Convert to imagesB64 array format
        const imagesB64 = [b64];
        
        const resp = await fetch("/api/photo_extract_openai_b64", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagesB64 })
        });

        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`OCR ${resp.status}: ${t}`);
        }

        const payload = await resp.json();
        const entries = payload?.entries || payload?.data?.entries || [];

        window.__fl_state.parsedHorses = Array.isArray(entries) ? entries : [];
        window.__fl_state.analyzed = true;
        state.parsedHorses = window.__fl_state.parsedHorses;
        state.analyzed = true;

        enable(predictBtn, true);
        toast(`Analysis complete — ${window.__fl_state.parsedHorses.length} entries parsed.`, 'success');
      } catch (e) {
        console.error('[Analyze]', e);
        toast(`Analyze failed: ${e.message}`, 'error');
      }
    });
  }

  async function onPredict() {
    const predictBtn = qPredict();

    if (!state.analyzed || !state.parsedHorses.length) {
      toast('Please analyze first.', 'warn');
      return;
    }

    await withBusy(predictBtn, async () => {
      try {
        toast('Generating predictions...', 'info');
        const r = await fetch('/api/predict_wps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            horses: state.parsedHorses,
          }),
        });

        const data = await r.json();

        if (!r.ok) throw new Error(data?.error || `Predict failed: ${r.status}`);

        toast(
          data?.message ||
            `Predictions ready.\nWin: ${data?.win}\nPlace: ${data?.place}\nShow: ${data?.show}\nConfidence: ${data?.confidence ?? '—'}`,
          'success'
        );
      } catch (e) {
        console.error('[Predict]', e);
        toast(`Predict failed: ${e.message}`, 'error');
      }
    });
  }

  const analyzeBtn = qAnalyze();
  const predictBtn = qPredict();

  if (analyzeBtn) analyzeBtn.addEventListener('click', onAnalyze);
  if (predictBtn) predictBtn.addEventListener('click', onPredict);
})();
