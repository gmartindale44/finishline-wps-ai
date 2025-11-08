import { mountTrackCombobox } from './track-combobox.js';

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

  // Helper: pulse effect on completion
  function pulse(el) {
    if (!el) return;
    el.classList.add('is-complete');
    setTimeout(() => el.classList.remove('is-complete'), 1600);
  }

  // Helper: mount working badge next to button
  function mountWorkingBadge(el) {
    if (!el) return { show: () => {}, hide: () => {} };
    const id = 'fl-working-badge';
    let badge = document.getElementById(id);
    if (!badge) {
      badge = document.createElement('span');
      badge.id = id;
      badge.className = 'working-badge';
      badge.innerHTML = '<span class="working-dot"></span> Working…';
      badge.style.display = 'none';
      el.insertAdjacentElement('afterend', badge);
    }
    return {
      show: () => { badge.style.display = 'inline-flex'; },
      hide: () => { badge.style.display = 'none'; }
    };
  }

  async function onAnalyze() {
    const analyzeBtn = qAnalyze();
    const predictBtn = qPredict();

    if (!state.pickedFiles || state.pickedFiles.length === 0) {
      toast('Please choose at least one image or PDF first.', 'warn');
      return;
    }

    const badge = mountWorkingBadge(analyzeBtn);
    await withBusy(analyzeBtn, async () => {
      badge.show();
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
        pulse(analyzeBtn);
      } catch (e) {
        console.error('[Analyze]', e);
        toast(`Analyze failed: ${e.message}`, 'error');
      } finally {
        badge.hide();
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
        const rawDistance = (document.getElementById('race-distance')?.value || '').trim();
        const normDistance = window.FL_parseDistance ? window.FL_parseDistance(rawDistance) : null;
        
        const meta = {
          track: (document.getElementById('race-track')?.value || '').trim(),
          surface: (document.getElementById('race-surface')?.value || '').trim(),
          distance: normDistance ? normDistance.pretty : rawDistance,
          date: (document.getElementById('race-date')?.value || '').trim(),
        };
        
        // Add normalized distance fields if parsed
        if (normDistance) {
          meta.distance_furlongs = normDistance.distance_furlongs;
          meta.distance_meters = normDistance.distance_meters;
        }

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
        
        // Add normalized distance fields if available
        if (meta.distance_furlongs != null) {
          payload.distance_furlongs = meta.distance_furlongs;
        }
        if (meta.distance_meters != null) {
          payload.distance_meters = meta.distance_meters;
        }

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
            if (window.FLResults?.show) {
              window.FLResults.show({ error: true, message: 'Prediction response parse error. Please try again.' });
            } else {
              showToast('Prediction response parse error – check console.');
            }
            return;
          }
        } catch (fetchErr) {
          console.error('[Predict] Fetch error:', fetchErr);
          if (window.FLResults?.show) {
            window.FLResults.show({ error: true, message: 'Prediction failed (connection error). Please check your internet connection.' });
          } else {
            showToast('Prediction failed (connection error).');
          }
          return;
        }

        if (!r.ok || data?.error) {
          console.warn('[Predict] Error response:', data);
          const errorMsg = data?.error || data?.detail || data?.message || data?.reason || `HTTP ${r.status}` || 'Prediction failed';
          if (window.FLResults?.show) {
            window.FLResults.show({ error: true, message: errorMsg });
          } else {
            showToast(`Prediction failed: ${errorMsg}`);
          }
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
              confidence: confPct / 100, // Convert to 0-1 range for results-panel
              horses: horsesForDisplay,
              reasons: reasons,
              tickets: data.tickets || null,
              strategy: data.strategy || null,
              picks: data.picks || picks || null,
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
        pulse(predictBtn);
        
        // Auto-log prediction to Redis (fire-and-forget)
        (async () => {
          try {
            const race = {
              track: (document.getElementById('race-track')?.value || '').trim(),
              date: (document.getElementById('race-date')?.value || '').trim(),
              postTime: (document.getElementById('race-time')?.value || document.getElementById('post-time')?.value || '').trim(),
              raceNo: (document.getElementById('race-no')?.value || '').trim() || '',
              surface: (document.getElementById('race-surface')?.value || '').trim(),
              distance: (document.getElementById('race-distance')?.value || '').trim()
            };
            
            const picks = {
              win: winPick?.name || winName || '',
              place: placePick?.name || placeName || '',
              show: showPick?.name || showName || ''
            };
            
            const top3_mass = data.top3_mass || data.top3Mass || null;
            const strategy = data.strategy?.recommended || '';
            
            const logResp = await fetch("/api/log_prediction", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                track: race.track,
                date: race.date,
                postTime: race.postTime,
                raceNo: race.raceNo,
                picks,
                confidence: confPct / 100, // Convert back to 0-1 for storage
                top3_mass: top3_mass ? (typeof top3_mass === 'number' ? top3_mass / 100 : parseFloat(top3_mass) / 100) : null,
                strategy
              })
            });
            
            // Store race key for potential archiving later
            if (logResp.ok) {
              try {
                const logData = await logResp.json();
                if (logData.ok && logData.race_id) {
                  window.__fl_state = window.__fl_state || {};
                  window.__fl_state.lastPendingKey = `fl:pred:${logData.race_id}`;
                }
              } catch (_) {
                // Ignore JSON parse errors
              }
            }
          } catch (_) {
            // Ignore all errors - fire-and-forget
          }
        })();
        
        // Tiny "Logged" toast if flags are enabled (non-breaking)
        if (window.FL_FLAGS) {
          try {
            const toastEl = document.createElement('div');
            toastEl.textContent = 'Logged ✅';
            toastEl.style.cssText = 'position:fixed;bottom:80px;right:20px;padding:6px 12px;background:rgba(0,255,120,0.2);color:#cfffdf;border-radius:6px;font-size:12px;z-index:10001;border:1px solid rgba(0,255,120,0.4);';
            document.body.appendChild(toastEl);
            setTimeout(() => {
              try { toastEl.remove(); } catch (_) {}
            }, 1500);
          } catch (_) {
            // Ignore if toast creation fails
          }
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

  // === New Race Reset Functionality ===
  
  async function archiveLastPendingIfAny() {
    const key = window.__fl_state?.lastPendingKey;
    if (!key) return;
    
    try {
      await fetch('/api/close_race', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ race_key: key, status: 'archived' })
      }).catch(() => {});
      window.__fl_state.lastPendingKey = null;
    } catch (err) {
      console.debug('[NewRace] Archive skip:', err?.message || err);
    }
  }

  function resetAppState() {
    // Clear file inputs
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach(input => {
      input.value = '';
    });

    // Clear preview/thumbnails
    const previewContainers = document.querySelectorAll('[data-fl-preview], #fl-preview, .preview-container');
    previewContainers.forEach(container => {
      container.innerHTML = '';
    });

    // Clear parsed horses containers
    const parsedContainers = document.querySelectorAll('#fl-parsed-horses, .horse-list, [data-horse-list]');
    parsedContainers.forEach(container => {
      container.innerHTML = '';
    });

    // Clear horse rows
    const horseRows = document.querySelectorAll('.horse-row, [data-horse-row]');
    horseRows.forEach(row => {
      // Clear inputs in the row
      const inputs = row.querySelectorAll('input, select, textarea');
      inputs.forEach(input => {
        if (input.type !== 'button') {
          input.value = '';
        }
      });
    });

    // Reset to single empty row if needed
    const container = document.getElementById('horse-rows') || document.querySelector('.rows');
    if (container) {
      const existingRows = container.querySelectorAll('.horse-row, [data-horse-row]');
      if (existingRows.length === 0) {
        // Trigger add row to create one empty row
        const addBtn = document.getElementById('add-row-btn') || document.querySelector('[data-add-horse]');
        if (addBtn) {
          addBtn.click();
        }
      }
    }

    // Reset global state (preserve lastPendingKey and flags)
    window.__fl_state = {
      phase: 'idle',
      parsedHorses: [],
      picks: null,
      lastRaceId: null,
      lastPendingKey: window.__fl_state?.lastPendingKey || null,
      pickedFiles: [],
      analyzed: false,
      speedFigs: {},
      surface: null,
      distance_input: null,
      track: null,
      features: {}
    };

    // Clear UI elements
    // Confidence bar
    const confPct = document.getElementById('fl-conf-pct');
    const confBar = document.getElementById('fl-conf-bar');
    if (confPct) confPct.textContent = '0%';
    if (confBar) {
      confBar.style.width = '0%';
      confBar.style.background = '#00e6a8'; // neutral green
    }

    // Hide/clear signal badge
    const signalBadge = document.getElementById('fl-signal');
    if (signalBadge) signalBadge.style.display = 'none';

    // Disable Predict button
    if (predictBtn) {
      predictBtn.disabled = true;
      predictBtn.classList.add('disabled');
    }

    // Remove working badges
    const workingBadges = document.querySelectorAll('.working-badge, [id="fl-working-badge"]');
    workingBadges.forEach(badge => badge.remove());

    // Close/hide Results modal and clear content (but preserve root container)
    if (window.FLResults?.hide) {
      window.FLResults.hide();
    }
    const resultsRoot = document.getElementById('fl-results-root');
    if (resultsRoot) {
      // Clear content but preserve root container
      const tabContents = resultsRoot.querySelectorAll('.fl-tab-content');
      tabContents.forEach(tab => {
        if (tab.id === 'fl-tab-predictions') {
          const badges = tab.querySelectorAll('.fl-badge');
          badges.forEach(b => b.innerHTML = '');
        }
        if (tab.id === 'fl-tab-exotics') {
          const exoticsContent = tab.querySelector('#fl-exotics-content');
          if (exoticsContent) exoticsContent.innerHTML = '';
        }
        if (tab.id === 'fl-tab-strategy') {
          const strategyWrap = tab.querySelector('[data-fl-strategy], #fl-strategy');
          if (strategyWrap) strategyWrap.innerHTML = '';
        }
      });
      // Do NOT remove the root container - just hide the panel
      const panel = resultsRoot.querySelector('.fl-results');
      if (panel) {
        panel.classList.remove('fl-results--open', 'fl-results--pinned');
      }
    }

    // Reset chips
    const chips = document.querySelectorAll('[data-chip]');
    chips.forEach(chip => {
      chip.className = 'chip chip--idle';
      chip.textContent = 'Idle';
    });

    // Reset file label
      const fileLabel = document.getElementById('file-selected-label');
      const chooseBtn = document.querySelector('[data-fl-file-btn]');
      if (chooseBtn) {
        const normalized = 'Choose Photos';
        if (chooseBtn.textContent && /photos\s*\/\s*pdf/i.test(chooseBtn.textContent)) {
          chooseBtn.textContent = normalized;
        }
        const aria = chooseBtn.getAttribute('aria-label');
        if (aria && /pdf/i.test(aria)) {
          chooseBtn.setAttribute('aria-label', normalized);
        }
        const title = chooseBtn.getAttribute('title');
        if (title && /pdf/i.test(title)) {
          chooseBtn.setAttribute('title', normalized);
        }
      }
    if (fileLabel) fileLabel.textContent = 'No file selected';

    // Reset form inputs
    const trackInput = document.getElementById('race-track');
    const surfaceSelect = document.getElementById('race-surface');
    const distanceInput = document.getElementById('race-distance');
    const dateInput = document.getElementById('race-date');
    if (trackInput) trackInput.value = '';
    if (surfaceSelect) surfaceSelect.value = 'Dirt';
    if (distanceInput) distanceInput.value = '';
    if (dateInput) dateInput.value = '';

    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onNewRace() {
    try {
      await archiveLastPendingIfAny();
    } catch (err) {
      console.debug('[NewRace] Archive skip:', err?.message || err);
    }
    resetAppState();
    const newRaceBtn = document.querySelector('#fl-new-race');
    if (newRaceBtn) pulse(newRaceBtn);
  }

  // Wire up click handler
  document.addEventListener('click', (e) => {
    if (e.target?.id === 'fl-new-race' || e.target.closest('#fl-new-race')) {
      e.preventDefault();
      onNewRace();
    }
  });

  // Wire up keyboard shortcut (N key)
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Only trigger if not typing in an input/textarea
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      onNewRace();
    }
  });

  // Mount track combobox on DOM ready
  function initTrackCombobox() {
    const trackInput = document.getElementById('race-track') || document.querySelector('input[name="track"], #track, [data-fl-field="track"]');
    if (trackInput && !trackInput.closest('.fl-combobox')) {
      mountTrackCombobox(trackInput, {
        onChange: (val) => {
          // Normalize into global state if used
          if (window.__fl_state) {
            window.__fl_state.track = val || '';
          }
        }
      });
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTrackCombobox);
  } else {
    initTrackCombobox();
  }
})();
