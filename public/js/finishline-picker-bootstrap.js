(function () {
  // Simple no-op UI busy shim so missing FLUI won't crash
  (function FL_Init_Bootstrap() {
    if (!window.FLUI) {
      window.FLUI = {
        setBusy: (flag, msg) => {
          try {
            const id = 'fl-busy';
            let el = document.getElementById(id);
            if (flag) {
              if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.style.position = 'fixed';
                el.style.left = '50%';
                el.style.top = '20px';
                el.style.transform = 'translateX(-50%)';
                el.style.padding = '8px 12px';
                el.style.borderRadius = '10px';
                el.style.background = 'rgba(40,40,60,.9)';
                el.style.color = '#fff';
                el.style.zIndex = '99999';
                el.style.fontSize = '12px';
                document.body.appendChild(el);
              }
              el.textContent = msg || 'Working…';
              el.style.display = 'block';
            } else if (el) {
              el.style.display = 'none';
            }
          } catch {}
        }
      };
    }

    // Small toast for visible errors
    if (!window.flToast) {
      window.flToast = function flToast(msg, type = 'error') {
        try {
          const id = 'fl-toast';
          let el = document.getElementById(id);
          if (!el) {
            el = document.createElement('div');
            el.id = id;
            document.body.appendChild(el);
            Object.assign(el.style, {
              position: 'fixed',
              right: '16px',
              bottom: '16px',
              padding: '10px 14px',
              borderRadius: '10px',
              backdropFilter: 'blur(8px)',
              color: '#fff',
              zIndex: 99999,
              transition: 'opacity .4s'
            });
          }
          el.style.background = type === 'ok' ? 'rgba(16,155,89,.9)' : 'rgba(200,60,60,.9)';
          el.textContent = msg;
          el.style.opacity = '1';
          setTimeout(() => { el.style.opacity = '0'; }, 3000);
        } catch {}
      };
    }
  })();

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
  function flToast(msg, type = 'error') {
    try {
      const id = 'fl-toast';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.position = 'fixed';
        el.style.right = '16px';
        el.style.bottom = '16px';
        el.style.padding = '10px 14px';
        el.style.borderRadius = '10px';
        el.style.backdropFilter = 'blur(8px)';
        el.style.zIndex = '99999';
        el.style.color = '#fff';
        document.body.appendChild(el);
      }
      el.style.background = type === 'ok' ? 'rgba(16,155,89,.9)' : 'rgba(200,60,60,.9)';
      el.innerText = msg;
      el.style.opacity = '1';
      setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 3000);
    } catch {}
  }

  function showToast(message, opts = {}) {
    flToast(message, opts.type === 'ok' ? 'ok' : 'error');
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

  // ===== Core predict handler =====
  async function predictWPS() {
    try {
      console.log('[FinishLine] predictWPS()');
      syncInputsToState();
      const horses = getHorsesForPrediction();

      const payload = (window.FLForm && typeof window.FLForm.collect === 'function')
        ? window.FLForm.collect()
        : {
            horses: horses ? horses.map(h => ({
              name: h.name,
              odds: h.odds_norm || h.odds_raw || h.odds,
              post: h.post || null,
            })) : [],
            track: window.__fl_state.track || '',
            surface: window.__fl_state.surface || '',
            distance_input: window.__fl_state.distance_input || '',
            speedFigs: window.__fl_state.speedFigs || {},
          };

      if (!payload || !Array.isArray(payload.horses) || payload.horses.length < 3) {
        throw new Error('Need at least 3 horses before predicting.');
      }

      __fl_diag('predict payload', payload);

      const res = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error('API ' + res.status);
      }

      const data = await res.json();

      console.log('[FinishLine] predict success', { strategy: !!data?.strategy, picks: !!data?.picks });

      if (window.FLResults && typeof window.FLResults.show === 'function') {
        window.FLResults.show({
          picks: data.picks || null,
          strategy: data.strategy || null,
          tickets: data.tickets || null,
          confidence: data.confidence || null,
          meta: { from: 'predict_wps', ts: Date.now() }
        });
      } else {
        console.warn('[FinishLine] FLResults.show missing');
        window.flToast('Renderer missing (see console).');
      }

    } catch (err) {
      console.error('[FinishLine] predict failed', err);
      window.flToast('Prediction failed: ' + (err?.message || err), false);
      try {
        window.FLResults?.show?.({ picks: null, strategy: null, tickets: null, error: { message: String(err?.message || err) } });
      } catch {}
    }
  }

  // Expose for inline fallback
  window.FLHandlers = Object.assign(window.FLHandlers || {}, { predictWPS });

  async function handlePredictWPS() {
    return predictWPS();
  }

  async function onPredict() {
    return handlePredictWPS();
  }

  const analyzeBtn = qAnalyze();
  const predictBtn = qPredict();

  if (analyzeBtn) analyzeBtn.addEventListener('click', onAnalyze);

  // ===== Binding strategy (triple-layer) =====
  function bindDirect() {
    const btn = document.getElementById('predictWpsBtn');
    if (!btn) return false;
    if (!btn.__fl_bound) {
      btn.addEventListener('click', predictWPS, { capture: true });
      btn.__fl_bound = true;
      console.log('[FinishLine] Bound direct click to #predictWpsBtn');
    }
    return true;
  }

  function bindDelegated() {
    if (document.__fl_delegate_bound) return;
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest && e.target.closest('#predictWpsBtn,[data-action="predict-wps"]');
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      console.log('[FinishLine] Delegated click captured');
      predictWPS();
    }, true);
    document.__fl_delegate_bound = true;
    console.log('[FinishLine] Delegated binder ready');
  }

  function observeRebind() {
    if (document.__fl_observer) return;
    const mo = new MutationObserver(() => bindDirect());
    mo.observe(document.body, { childList: true, subtree: true });
    document.__fl_observer = mo;
    console.log('[FinishLine] MutationObserver rebind enabled');
  }

  function initPredictBinding() {
    bindDirect();       // try direct
    bindDelegated();    // also delegated
    observeRebind();    // and auto-rebind on DOM swaps
  }

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPredictBinding, { once: true });
  } else {
    initPredictBinding();
  }

  // Quick console probe
  window.__FL_DIAG__ = () => ({
    btn: !!document.getElementById('predictWpsBtn'),
    resultsShow: !!(window.FLResults && window.FLResults.show),
    formCollect: !!(window.FLForm && window.FLForm.collect)
  });
})();
