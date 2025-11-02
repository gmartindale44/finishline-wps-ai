(function () {
  const state = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    analyzed: false,
    parsedHorses: [],     // [{ name, odds, jockey?, trainer?, post? }]
    speedFigs: {},        // { "Horse Name": 113, ... }
    surface: null,
    distance_input: null, // raw user distance string (miles OR furlongs)
    track: null,
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

  // === Mirror inputs into __fl_state ===
  function syncInputsToState() {
    const track = document.getElementById('race-track')?.value?.trim();
    const surface = document.getElementById('race-surface')?.value?.trim();
    const distance = document.getElementById('race-distance')?.value?.trim();
    if (track) window.__fl_state.track = track;
    if (surface) window.__fl_state.surface = surface;
    if (distance) window.__fl_state.distance_input = distance;
  }

  // === Simple normalized fuzzy-similarity (Dice coefficient over bigrams) ===
  function __fl_similarity(a, b) {
    if (!a || !b) return 0;
    a = String(a).toLowerCase().trim();
    b = String(b).toLowerCase().trim();
    if (a === b) return 1;
    const bigrams = s => {
      const out = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const bg = s.slice(i, i + 2);
        out.set(bg, (out.get(bg) || 0) + 1);
      }
      return out;
    };
    const A = bigrams(a), B = bigrams(b);
    let overlap = 0, sizeA = 0, sizeB = 0;
    A.forEach(v => { sizeA += v; });
    B.forEach(v => { sizeB += v; });
    A.forEach((v, k) => {
      if (B.has(k)) overlap += Math.min(v, B.get(k));
    });
    const denom = sizeA + sizeB;
    return denom ? (2 * overlap) / denom : 0;
  }

  // === Merge OCR speed figs into state (case-insensitive; fuzzy >= 0.85) ===
  function mergeSpeedFigsIntoState(ocrSpeedFigs) {
    if (!ocrSpeedFigs || typeof ocrSpeedFigs !== 'object') return;
    const existing = window.__fl_state.speedFigs || {};
    const names = window.__fl_state.parsedHorses?.map(h => h.name) || [];
    const out = { ...existing };

    Object.entries(ocrSpeedFigs).forEach(([rawName, fig]) => {
      if (!fig) return;
      // exact case-insensitive first
      const exact = names.find(n => n && n.toLowerCase().trim() === rawName.toLowerCase().trim());
      if (exact) {
        out[exact] = Number(fig);
        return;
      }
      // fuzzy match
      let best = null, bestScore = 0;
      for (const n of names) {
        const s = __fl_similarity(n, rawName);
        if (s > bestScore) { best = n; bestScore = s; }
      }
      if (best && bestScore >= 0.85) out[best] = Number(fig);
    });

    window.__fl_state.speedFigs = out;
  }

  // === Tiny diag ===
  function __fl_diag(label, obj) {
    try { console.log(`[FL] ${label}:`, JSON.parse(JSON.stringify(obj))); }
    catch { console.log(`[FL] ${label}:`, obj); }
  }

  // ─────────────────────────────────────────────
  // Toast helper (lightweight, no deps)
  // ─────────────────────────────────────────────
  function showToast(message, opts = {}) {
    try {
      const dur = opts.durationMs ?? 3000;
      const el = document.createElement('div');
      el.className = 'fl-toast';
      el.textContent = message || 'Notice';
      document.body.appendChild(el);
      // force reflow for animation
      void el.offsetWidth;
      el.classList.add('fl-toast-in');
      setTimeout(() => {
        el.classList.remove('fl-toast-in');
        el.classList.add('fl-toast-out');
        setTimeout(() => el.remove(), 250);
      }, dur);
    } catch (e) {
      console.warn('[FinishLine] toast error:', e);
    }
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
        toast('Processing file...', 'info');
        const mainFile = state.pickedFiles[0];

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

        // Merge speedFigs from main OCR response (extracted from main image)
        if (mainPayload?.speedFigs) {
          mergeSpeedFigsIntoState(mainPayload.speedFigs);
          
          // Also merge into normalized horses if not already present
          normalizedHorses.forEach(h => {
            const key = horseKey(h.name);
            const speedFigFromState = window.__fl_state.speedFigs?.[key] || window.__fl_state.speedFigs?.[h.name];
            if (speedFigFromState && !h.speedFig) {
              h.speedFig = speedFigFromState;
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

        // Merge speed figs if present in response
        if (mainPayload?.speedFigs || payload?.speedFigs) {
          mergeSpeedFigsIntoState(mainPayload?.speedFigs || payload?.speedFigs);
        }

        // Sync inputs to state
        syncInputsToState();

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
      showToast('Not enough horses to predict. Analyze first or add rows. (Need at least 3 with name + odds)');
      return;
    }

    await withBusy(predictBtn, async () => {
      try {
        showToast('Generating predictions...');
        
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

        // Sync inputs to state before predict
        syncInputsToState();

        // Build payload for Model v2
        const payload = {
          horses: horses.map(h => ({
            name: h.name,
            odds: h.odds_norm || h.odds_raw || h.odds,
            post: h.post || null,
          })),
          track: window.__fl_state.track || meta.track || '',
          surface: window.__fl_state.surface || meta.surface || '',
          distance_input: window.__fl_state.distance_input || meta.distance || '',
          speedFigs: window.__fl_state.speedFigs || {},
        };

        __fl_diag('predict payload', payload);

        let r;
        let data = null;
        try {
          r = await fetch('/api/predict_wps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          // Robust JSON parsing
          try {
            const text = await r.text();
            data = text ? JSON.parse(text) : null;
          } catch (parseErr) {
            console.error('[Predict] JSON parse error:', parseErr);
            showToast('Prediction response parse error – check console.');
            return;
          }
        } catch (fetchErr) {
          console.error('[Predict] Fetch error:', fetchErr);
          showToast('Prediction failed (connection error).');
          return;
        }

        if (!r.ok) {
          console.error('[Predict] Error response:', data);
          if (data?.error === 'insufficient_features' || data?.reason || data?.error === 'prediction_error') {
            showToast(data.message || data.reason || 'Prediction failed. Check your inputs.');
            return;
          }
          showToast(`Prediction failed: ${data?.error || data?.message || `HTTP ${r.status}`}`);
          return;
        }

        // Model v2 response format: { picks: [{slot, name, odds, reasons}], confidence, meta }
        const picks = data?.picks || [];
        const winPick = picks.find(p => p.slot === 'Win') || picks[0];
        const placePick = picks.find(p => p.slot === 'Place') || picks[1];
        const showPick = picks.find(p => p.slot === 'Show') || picks[2];

        const winName = winPick?.name || null;
        const placeName = placePick?.name || null;
        const showName = showPick?.name || null;

        // Validate response
        if (!winName || !placeName || !showName) {
          console.error('[Predict] Invalid response:', data);
          showToast('Predict returned invalid results. Check that at least 3 horses have valid names and odds.');
          return;
        }

        // Confidence is 0-1 range, convert to 0-100
        const confPct = typeof data.confidence === 'number' && data.confidence >= 0 
          ? Math.round(data.confidence * 100) 
          : 7;

        // Store prediction in localStorage
        try {
          localStorage.setItem('prediction', JSON.stringify(data));
        } catch (e) {
          console.warn('[Predict] Could not save to localStorage:', e);
        }
        
        // Build reasons object from picks (only show non-empty reasons)
        const reasons = {};
        picks.forEach(p => {
          if (p.reasons && p.reasons.length > 0) {
            reasons[p.name] = p.reasons;
          }
        });

        // Build horses array for display
        const horsesForDisplay = horses.map(h => ({
          name: h.name,
          odds: h.odds_norm || h.odds_raw || h.odds,
          speedFig: window.__fl_state.speedFigs?.[h.name] || h.speedFig || null,
        }));

        // Show persistent results panel with reasons and tickets (null-safe)
        try {
          if (window.FLResults?.show) {
            window.FLResults.show({
              win: winName,
              place: placeName,
              show: showName,
              confidence: confPct,
              horses: horsesForDisplay,
              reasons: reasons,
              tickets: data.tickets || null,
              strategy: data.strategy || null,
            });

            console.log('[Predict] Results displayed in panel', { win: winName, place: placeName, show: showName, confidence: confPct, tickets: data.tickets, strategy: data.strategy ? 'present' : 'missing' });
          } else {
            // Fallback to toast if panel not available
            showToast(`Predictions ready. Win: ${winName}, Place: ${placeName}, Show: ${showName}`);
          }
        } catch (modalErr) {
          console.error('[Predict] Modal render error:', modalErr);
          showToast('Prediction display error – check console.');
        }
      } catch (e) {
        console.error('[Predict] Unexpected error:', e);
        showToast(`Prediction failed: ${e?.message || 'Unknown error'}`);
      }
    });
  }

  const analyzeBtn = qAnalyze();
  const predictBtn = qPredict();

  if (analyzeBtn) analyzeBtn.addEventListener('click', onAnalyze);
  if (predictBtn) predictBtn.addEventListener('click', onPredict);
})();
