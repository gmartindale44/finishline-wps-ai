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

        // Normalize entries to { name, odds, jockey, trainer } format
        const normalizedHorses = Array.isArray(entries) ? entries.map(e => {
          // Handle case-insensitive keys from OCR
          const lower = {};
          for (const [k, v] of Object.entries(e || {})) {
            lower[k.toLowerCase()] = v;
          }
          return {
            name: String(lower.name || lower.horse || lower.runner || ''),
            odds: String(lower.odds || lower.ml_odds || lower.price || lower.odd || ''),
            jockey: String(lower.jockey || lower.rider || lower.j || ''),
            trainer: String(lower.trainer || lower.trainer_name || lower.t || ''),
          };
        }).filter(h => h.name && h.name.length > 1) : [];

        window.__fl_state.parsedHorses = normalizedHorses;
        window.__fl_state.analyzed = true;
        state.parsedHorses = normalizedHorses;
        state.analyzed = true;

        // Render horses to table
        if (typeof window.__fl_table !== 'undefined' && window.__fl_table.renderHorsesToTable) {
          const rendered = window.__fl_table.renderHorsesToTable(normalizedHorses);
          
          // Diagnostics
          if (window.__fl_diag) {
            console.table(normalizedHorses.slice(0, 5));
            console.log(`[Analyze] Parsed ${normalizedHorses.length} horses, rendered ${rendered} rows`);
          }

          if (normalizedHorses.length < 3) {
            toast(`Only ${normalizedHorses.length} entries parsed—results may be unreliable.`, 'warn');
          } else {
            toast(`Analysis complete — ${normalizedHorses.length} entries parsed & added to list.`, 'success');
          }
        } else {
          console.warn('[Analyze] table.js not loaded; horses stored in state only');
          toast(`Analysis complete — ${normalizedHorses.length} entries parsed.`, 'success');
        }

        enable(predictBtn, true);
      } catch (e) {
        console.error('[Analyze]', e);
        toast(`Analyze failed: ${e.message}`, 'error');
      }
    });
  }

  // Get horses for prediction with strict priority: table first, then state
  function getHorsesForPrediction() {
    // Priority 1: Use table if it has >= 3 valid rows (name + odds)
    if (typeof window.__fl_table !== 'undefined' && window.__fl_table.readHorsesFromTable) {
      const tableHorses = window.__fl_table.readHorsesFromTable();
      if (tableHorses.length >= 3) {
        if (window.__fl_diag) {
          console.log(`[Predict] Using ${tableHorses.length} horses from table`);
          console.table(tableHorses.slice(0, 5));
        }
        return tableHorses.map(h => ({
          ...h,
          odds_raw: h.odds,
          odds_norm: window.__fl_table.normalizeOdds ? window.__fl_table.normalizeOdds(h.odds) : h.odds,
        }));
      }
    }

    // Priority 2: Use parsed horses from state if >= 3
    if (window.__fl_state?.parsedHorses && Array.isArray(window.__fl_state.parsedHorses) && window.__fl_state.parsedHorses.length >= 3) {
      if (window.__fl_diag) {
        console.log(`[Predict] Using ${window.__fl_state.parsedHorses.length} horses from state`);
        console.table(window.__fl_state.parsedHorses.slice(0, 5));
      }
      return window.__fl_state.parsedHorses.map(h => ({
        ...h,
        odds_raw: h.odds,
        odds_norm: window.__fl_table?.normalizeOdds ? window.__fl_table.normalizeOdds(h.odds) : h.odds,
      }));
    }

    return null;
  }

  async function onPredict() {
    const predictBtn = qPredict();

    // Get horses with priority order
    const horses = getHorsesForPrediction();

    if (!horses || horses.length < 3) {
      toast('Not enough horses to predict. Analyze first or add rows. (Need at least 3 with name + odds)', 'error');
      return;
    }

    await withBusy(predictBtn, async () => {
      try {
        toast('Generating predictions...', 'info');
        
        // Collect meta from form
        const meta = {
          track: (document.getElementById('race-track')?.value || '').trim(),
          surface: (document.getElementById('race-surface')?.value || '').trim(),
          distance: (document.getElementById('race-distance')?.value || '').trim(),
          date: (document.getElementById('race-date')?.value || '').trim(),
        };

        const r = await fetch('/api/predict_wps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            horses: horses.map(h => ({
              name: h.name,
              odds: h.odds_norm || h.odds_raw || h.odds,
              jockey: h.jockey || '',
              trainer: h.trainer || '',
            })),
            meta,
          }),
        });

        const data = await r.json();

        if (!r.ok) throw new Error(data?.error || `Predict failed: ${r.status}`);

        // Validate response
        if (!data.win || !data.place || !data.show) {
          console.error('[Predict] Invalid response:', data);
          throw new Error('Predict returned null results. Check that at least 3 horses have valid names and odds.');
        }

        const confidence = typeof data.confidence === 'number' && data.confidence > 0 ? data.confidence : 0;
        toast(
          data?.message ||
            `Predictions ready.\nWin: ${data.win}\nPlace: ${data.place}\nShow: ${data.show}\nConfidence: ${confidence > 0 ? confidence.toFixed(2) : '—'}`,
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
