(function () {
  const state = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    analyzed: false,
    parsedHorses: [],
    speedFile: null,
    features: {},
  });

  // Name normalization helpers
  function normName(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\b(st|jr|sr|iii|ii)\b/g, '')
      .trim();
  }

  function horseKey(name) {
    return normName(name);
  }

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
        toast('Processing files...', 'info');
        const mainFile = state.pickedFiles[0];
        const speedFile = state.speedFile;

        if (!mainFile) {
          toast('Please choose at least one image or PDF first.', 'warn');
          return;
        }

        // Process main file
        let mainB64, mainMime;
        if (mainFile.type === 'application/pdf') {
          toast('Extracting first page from main PDF...', 'info');
          ({ b64: mainB64, mime: mainMime } = await pdfFirstPageToDataURL(mainFile));
        } else {
          toast('Preparing main image...', 'info');
          ({ b64: mainB64, mime: mainMime } = await downscaleImageToDataURL(mainFile));
        }

        toast('Sending main image to OCR...', 'info');
        
        const mainResp = await fetch("/api/photo_extract_openai_b64", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagesB64: [mainB64], kind: "main" })
        });

        if (!mainResp.ok) {
          const t = await mainResp.text();
          throw new Error(`OCR ${mainResp.status}: ${t}`);
        }

        const mainPayload = await mainResp.json();
        const entries = mainPayload?.entries || mainPayload?.data?.entries || [];

        // Process speed file if provided
        let speedData = [];
        if (speedFile) {
          toast('Processing speed/PP photo...', 'info');
          let speedB64, speedMime;
          if (speedFile.type === 'application/pdf') {
            ({ b64: speedB64, mime: speedMime } = await pdfFirstPageToDataURL(speedFile));
          } else {
            ({ b64: speedB64, mime: speedMime } = await downscaleImageToDataURL(speedFile));
          }

          const speedResp = await fetch("/api/photo_extract_openai_b64", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imagesB64: [speedB64], kind: "speed" })
          });

          if (speedResp.ok) {
            const speedPayload = await speedResp.json();
            speedData = speedPayload?.speed || [];
          }
        }

        // Normalize entries to { name, odds, jockey, trainer, speedFig } format
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
            speedFig: typeof lower.speedfig === 'number' ? lower.speedfig : (lower.speedfig ? Number(lower.speedfig) : null),
          };
        }).filter(h => h.name && h.name.length > 1) : [];

        // Merge speed data by name
        if (speedData.length > 0) {
          const speedMap = new Map();
          speedData.forEach(s => {
            const key = horseKey(s.name);
            if (key && s.speedFig != null) {
              speedMap.set(key, Number(s.speedFig));
            }
          });

          normalizedHorses.forEach(h => {
            const key = horseKey(h.name);
            if (speedMap.has(key) && !h.speedFig) {
              h.speedFig = speedMap.get(key);
            }
          });
        }

        // Convert odds to decimal for features
        function oddsToDecimal(oddsStr) {
          if (!oddsStr) return null;
          const match = String(oddsStr).match(/^(\d+)\s*\/\s*(\d+)$/);
          if (match) {
            const num = Number(match[1]);
            const den = Number(match[2] || 1);
            return num / den;
          }
          const num = Number(oddsStr);
          return isFinite(num) && num > 0 ? num : null;
        }

        // Build features object
        const features = {};
        normalizedHorses.forEach(h => {
          const key = horseKey(h.name);
          const decOdds = oddsToDecimal(h.odds);
          features[key] = {
            name: h.name,
            odds: decOdds,
            implied: decOdds != null ? 1 / (decOdds + 1) : null,
            speed: h.speedFig,
            jockey: h.jockey || '',
            trainer: h.trainer || '',
          };
        });

        window.__fl_state.parsedHorses = normalizedHorses;
        window.__fl_state.features = features;
        window.__fl_state.analyzed = true;
        state.parsedHorses = normalizedHorses;
        state.features = features;
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

        // Get features or build from horses
        let features = window.__fl_state.features || {};
        if (Object.keys(features).length === 0) {
          // Fallback: build from current horses
          features = {};
          horses.forEach(h => {
            const key = horseKey(h.name);
            const decOdds = h.odds_norm || h.odds_raw || h.odds;
            let implied = null;
            if (decOdds) {
              const match = String(decOdds).match(/^(\d+)\s*\/\s*(\d+)$/);
              if (match) {
                const num = Number(match[1]);
                const den = Number(match[2] || 1);
                const decimal = num / den;
                implied = 1 / (decimal + 1);
              }
            }
            features[key] = {
              name: h.name,
              odds: decOdds,
              implied,
              speed: h.speedFig || null,
              jockey: h.jockey || '',
              trainer: h.trainer || '',
            };
          });
        }

        // Get toggle states
        const useDistance = document.getElementById('use-distance')?.checked ?? true;
        const useSurface = document.getElementById('use-surface')?.checked ?? true;
        const usePriors = document.getElementById('use-priors')?.checked ?? true;

        const r = await fetch('/api/predict_wps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            features,
            useDistance,
            useSurface,
            usePriors,
            track: meta.track,
            distance: meta.distance,
            surface: meta.surface,
          }),
        });

        const data = await r.json();

        if (!r.ok) {
          if (data.error === 'insufficient_features' || data.reason) {
            toast(data.reason || 'Not enough usable signals—try adding Speed/PP photo or enable priors.', 'warn');
            return;
          }
          throw new Error(data?.error || `Predict failed: ${r.status}`);
        }

        // New response format: { win, place, show } or { predictions: { win: {name, odds}, ... } }
        const winName = data.predictions?.win?.name || data.win || null;
        const placeName = data.predictions?.place?.name || data.place || null;
        const showName = data.predictions?.show?.name || data.show || null;

        // Validate response
        if (!winName || !placeName || !showName) {
          console.error('[Predict] Invalid response:', data);
          throw new Error('Predict returned null results. Check that at least 3 horses have valid names and odds.');
        }

        // Use server-provided confidence directly (already 0-100 range)
        const confPct = typeof data.confidence === 'number' && data.confidence >= 0 ? data.confidence : 7;

        // Store prediction in localStorage
        try {
          localStorage.setItem('prediction', JSON.stringify(data));
        } catch (e) {
          console.warn('[Predict] Could not save to localStorage:', e);
        }
        
        // Build horses array with odds from predictions response
        const horsesForDisplay = (data.horses || horses || []).map(h => ({
          name: h.horse || h.name || '',
          odds: h.odds || '',
          speedFig: h.speedFig || null,
          prob: h.prob || null,
        }));
        
        // Show persistent results panel with reasons
        if (window.FLResults?.show) {
          window.FLResults.show({
            win: winName,
            place: placeName,
            show: showName,
            confidence: confPct,
            horses: horsesForDisplay,
            reasons: data.reasons || {},
          });
          
          console.log('[Predict] Results displayed in panel', { win: winName, place: placeName, show: showName, confidence: confPct });
        } else {
          // Fallback to toast if panel not available
          toast(
            data?.message ||
              `Predictions ready.\nWin: ${data.win}\nPlace: ${data.place}\nShow: ${data.show}\nConfidence: ${confidence > 0 ? confidence.toFixed(2) : '—'}`,
            'success'
          );
        }
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
