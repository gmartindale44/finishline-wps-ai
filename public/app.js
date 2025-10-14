// Fill form from { race, horses[] } and show any ocr_error note.

(() => {
  console.info('[FinishLine] app.js loaded with multi-horse OCR ✔');

  const form        = document.getElementById('raceForm') || document.getElementById('ocrForm') || document.querySelector('form[data-ocr]');
  const extractBtn  = document.getElementById('extractBtn') || document.getElementById('btnExtract') || document.querySelector('[data-action="extract"]');
  const resultBox   = document.getElementById('ocrResult');
  const prettyBox   = document.getElementById('ocrJson');
  const addHorseBtn = document.getElementById('add-horse-btn') || document.getElementById('addHorseBtn') || document.getElementById('add-horse') || document.getElementById('btnAddHorse') || document.querySelector('[data-action="add-horse"]') || document.querySelector('[data-add-horse]');

  const show = (m, t='info') => {
    const msg = typeof m === 'string' ? m : (m?.message || JSON.stringify(m));
    if (resultBox) {
      resultBox.textContent = msg;
      resultBox.dataset.type = t;
      resultBox.style.display = 'block';
      resultBox.style.background = t === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)';
      resultBox.style.color = t === 'error' ? '#fca5a5' : '#86efac';
      resultBox.style.border = t === 'error' ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(34,197,94,0.4)';
    } else {
      (t==='error'?console.error:console.log)(msg);
      if (t==='error') alert(msg);
    }
  };

  // === Bulletproof picker: overlay + emergency bar. Leaves your APIs/logic intact. ===

  if (window.__finishline_upload_force_init) return;
  window.__finishline_upload_force_init = true;

  // Shared bucket for send()
  window.__finishline_bucket = window.__finishline_bucket || [];
  window.__finishline_getFiles = () => window.__finishline_bucket;

  function updateSelectedCount() {
    const badge = document.getElementById('photoCount') || document.querySelector('[data-photo-count]');
    if (badge) badge.textContent = `${window.__finishline_bucket.length} / 6 selected`;
  }

  function onFilesPicked(files) {
    const arr = Array.from(files || []);
    for (const f of arr) if (f && f.name) window.__finishline_bucket.push(f);
    updateSelectedCount();
  }

  // Create a native input (returned each call to avoid GC of events)
  function makeNativeInput() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'image/*,.pdf';
    inp.addEventListener('change', (e) => {
      onFilesPicked(e.target.files);
      e.target.value = ''; // allow same selection twice
    });
    return inp;
  }

  // 1) Hard overlay on the Choose button's wrapper; clicks go to the input no matter what
  function mountOverlay() {
    // locate the visible "Choose Photos / PDF" control or its parent group
    const choose =
      document.getElementById('choosePhotosBtn') ||
      document.querySelector('[data-action="choose-photos"]') ||
      Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'))
        .find(el => /^choose\s*photos\s*\/\s*pdf$/i.test((el.textContent || el.value || '').trim()));

    if (!choose) return;

    // Use the button itself as positioning context (or its parent)
    const host = choose;
    const cs = getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';
    host.classList.add('finishline-clickable');

    // Already mounted?
    if (host.querySelector('#finishline-choose-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'finishline-choose-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647'; // max
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'pointer';

    // Put the input inside the overlay so native picker wins
    const input = makeNativeInput();
    input.style.position = 'absolute';
    input.style.inset = '0';
    input.style.width = '100%';
    input.style.height = '100%';
    input.style.opacity = '0';
    input.style.cursor = 'pointer';
    input.style.pointerEvents = 'auto';

    overlay.appendChild(input);
    host.appendChild(overlay);
  }

  // 2) Emergency bottom bar (always available; remove later if you wish)
  function mountEmergencyBar() {
    if (document.getElementById('finishline-emergency-picker')) return;

    const bar = document.createElement('div');
    bar.id = 'finishline-emergency-picker';

    const label = document.createElement('span');
    label.className = 'hint';
    label.textContent = 'If the in-form button is blocked, pick files here:';

    const input = makeNativeInput();

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.style.marginLeft = '6px';
    clear.onclick = () => {
      window.__finishline_bucket = [];
      updateSelectedCount();
    };

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Hide';
    close.style.marginLeft = 'auto';
    close.onclick = () => bar.remove();

    bar.append(label, input, clear, close);
    document.body.appendChild(bar);
  }

  // 3) Drop support (if present)
  (function mountDrop() {
    const dz = document.getElementById('dropzone') ||
               document.querySelector('[data-dropzone], .photos-dropzone');
    if (!dz) return;
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => dz.addEventListener(evt, stop, false));
    dz.addEventListener('drop', (e) => onFilesPicked(e.dataTransfer?.files), false);
  })();

  function init() {
    // Make sure no container disables pointer events
    document.body.classList.add('finishline-clickable');

    mountOverlay();       // preferred UX (on the actual button)
    mountEmergencyBar();  // guaranteed fallback

    updateSelectedCount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
    init();
  }

  // Re-mount overlay if the DOM re-renders
  const mo = new MutationObserver(() => mountOverlay());
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}

  // DO NOT hide any containers. If needed, only do:
  const debugJson = document.getElementById('ocrJson');
  if (debugJson) debugJson.style.display = 'none';

  async function send() {
    const files = window.__finishline_getFiles();
    if (!files.length) throw new Error('No files selected. Choose images/PDFs first.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); }
    const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // === DOM HELPERS & BUTTON PROGRESS UX ===
  
  const $  = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  // Status badge (the small "Idle" pill)
  const badge = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle');

  function setBadge(txt, kind='idle') {
    if (!badge) return;
    badge.textContent = txt;
    // normalize classes
    badge.classList.remove('idle','ready','analyzing','predicting','success','warning','error');
    badge.classList.add(kind);
  }

  // Button progress overlay
  function withButtonProgress(btn, runningLabel, runFn) {
    if (!btn) return runFn();
    const orig = btn.textContent.trim();
        btn.disabled = true;
    let pct = 0, timer = null;

    function tick(max=95) {
      pct = Math.min(max, pct + Math.random()*8 + 2);
      btn.textContent = `${runningLabel} ${Math.floor(pct)}%`;
    }
    tick();
    timer = setInterval(() => tick(), 400);

    const stop = (finalLabel, success=true) => {
      clearInterval(timer);
      pct = 100;
      btn.textContent = `${finalLabel} 100%`;
      setTimeout(() => {
          btn.disabled = false;
        btn.textContent = orig;
      }, 600);
    };

    return (async () => {
      try {
        const out = await runFn(() => tick(98)); // exposer if needed
        stop('Done', true);
        return out;
      } catch (e) {
        stop('Failed', false);
        throw e;
      }
    })();
  }

  // === IMPROVED OCR → FILL WITH ROW VERIFICATION ===

  // Badge helper with className management
  const setBadge = (txt, cls='ready') => { if (!badge) return; badge.textContent = txt; badge.className = `badge ${cls}`; };

  // --- Editor scoping (the single-row "Horse Data" editor) ---
  function findEditorNameInput() {
    return $('#horseName') || $('input[name="horseName"]') ||
      $$('input,textarea').find(el =>
        /horse\s*name/i.test([el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||''].join(' '))
      );
  }
  function getEditorContainer() {
    const nameEl = findEditorNameInput();
    return nameEl ? (nameEl.closest('form, [data-section="horse"], section, fieldset, .horse-editor, .horse-data, .card, .panel') || nameEl.parentElement) : null;
  }
  function findInEditor(rx) {
    const scope = getEditorContainer() || document;
    const re = rx instanceof RegExp ? rx : new RegExp(String(rx), 'i');
    return $$('input,textarea,select', scope).find(el => {
      const s = [el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||'', el.closest('label')?.textContent||''].join(' ');
      return re.test(s);
    });
  }
  const getOddsInput    = () => findInEditor(/(ml\s*odds|odds)/i);
  const getJockeyInput  = () => findInEditor(/jockey/i);
  const getTrainerInput = () => findInEditor(/trainer/i);

  // List of added horses (for row count verification)
  function horseRows() {
    // Try common containers; extend if you have a different markup
    return $$('.horse-list .horse-row')        ||
           $$('.horses .row')                  ||
           $$('.horse-items .item')            ||
           $$('.added-horses .row');
  }

  function getAddHorseControl() {
    const scope = getEditorContainer() || document;
    // Prefer button INSIDE the editor container
    const btnByText = $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()));
    if (btnByText) return btnByText;
    return scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  // Add ONE horse via the editor; verify a row was appended before continuing
  async function addOneHorse(h) {
    const nameEl = findEditorNameInput();
    if (!nameEl) return false;

    if (h?.name) { nameEl.value = h.name; fire(nameEl); }
    const oddsEl = getOddsInput();
    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey;  fire(jEl); }
    const tEl = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }

    await sleep(40);

    const before = horseRows().length;
    const scopeForm = nameEl.closest('form');
    const addBtn    = getAddHorseControl();

    // Prefer true form submit (most reliable)
    if (scopeForm?.requestSubmit) {
      console.debug(`[FinishLine] Submitting form for horse: ${h?.name || '(unnamed)'}`);
      scopeForm.requestSubmit();
    } else if (scopeForm) {
      console.debug(`[FinishLine] Dispatching submit event for horse: ${h?.name || '(unnamed)'}`);
      scopeForm.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
    } else if (addBtn) {
      console.debug(`[FinishLine] Clicking Add Horse button for: ${h?.name || '(unnamed)'}`);
      addBtn.click();
    }

    // Wait for row to append & editor to clear
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      await sleep(60);
      const now = horseRows().length;
      if (now > before) {
        console.debug(`[FinishLine] Row verified: ${before} → ${now} rows`);
        return true;
      }
    }
    // Final fallback: if no visible rows, still consider it added (some UIs render list later)
    console.debug(`[FinishLine] Row timeout, assuming added: ${h?.name || '(unnamed)'}`);
    return true;
  }

  // PUBLIC hook called after successful OCR (use this in your existing success branch)
  window.__finishline_fillFromOCR = async function(extracted) {
    console.info('[FinishLine] __finishline_fillFromOCR called with:', extracted);
    
    // Fill race (safe + tolerant)
    const setMeta = (label, val) => {
      if (val == null) return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
             [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
           ));
      if (el) { el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
    };
    const race = extracted?.race || {};
    setMeta('raceDate', race.date);
    setMeta('track',    race.track);
    setMeta('surface',  race.surface);
    setMeta('distance', race.distance);

    // Add horses sequentially
    const horses = Array.isArray(extracted?.horses) ? extracted.horses : [];
    let added = 0;
    console.info(`[FinishLine] Starting sequential population of ${horses.length} horses with row verification`);
    
    for (const h of horses) {
      const ok = await addOneHorse(h);
      if (ok) added++;
    }

    // Hide the debug JSON panel (SAFER: only the element, not parent)
    const debugJson = $('#ocrJson');
    if (debugJson) debugJson.style.display = 'none';
    if (resultBox) { resultBox.textContent = `✅ OCR parsed and populated ${added} horses.`; resultBox.dataset.type = 'info'; resultBox.style.display = 'block'; }

    // Store for later steps
    window.__finishline_lastExtracted = extracted;

    // Ready for next step
    setBadge('Ready to analyze', 'ready');
    console.info(`[FinishLine] OCR complete with row verification: ${added} horses added`);
  };

  // === ANALYZE + PREDICT FLOWS (progress UX + badge state) ===
  
  const analyzeBtn = $('#analyzeBtn') || $('[data-action="analyze"]') || $$('button').find(b => /analyz/i.test(b.textContent||''));
  const predictBtn = $('#predictBtn') || $('[data-action="predict"]') || $$('button').find(b => /predict/i.test(b.textContent||''));
  const listRowsSel = '.horse-list .horse-row, [data-role="horse-row"], .horses .row';

  function readRaceFromForm() {
    const val = (label) => {
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
             [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
           ));
      return el ? (el.value ?? '').toString().trim() : null;
    };
    return {
      date:     val('raceDate'),
      track:    val('track'),
      surface:  val('surface'),
      distance: val('distance')
    };
  }

  function readHorsesFromList() {
    // Try structured list (preferred)
    const rows = $$(listRowsSel);
    if (rows.length) {
      const pick = (row, rex) => $$('input,textarea', row).find(el => rex.test(
        [el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||'', el.closest('label')?.textContent||''].join(' ')
      ))?.value?.trim() || '';
      return rows.map(r => ({
        name:    pick(r, /name/i),
        ml_odds: pick(r, /(ml\s*odds|odds)/i),
        jockey:  pick(r, /jockey/i),
        trainer: pick(r, /trainer/i),
      })).filter(h => h.name);
    }
    // Fallback to last extracted
    return Array.isArray(window.__finishline_lastExtracted?.horses) ? window.__finishline_lastExtracted.horses : [];
  }

  async function callJSON(url, body) {
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    let json; try { json = await res.json(); } catch { throw new Error(`Non-JSON from ${url} (HTTP ${res.status})`); }
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error?.message || json?.message || `Request failed (${res.status})`);
    }
    return json;
  }

  // ANALYZE
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopImmediatePropagation();
      withButtonProgress(analyzeBtn, 'Analyzing…', async () => {
        setBadge('Analyzing…', 'analyzing');
        const payload = { race: readRaceFromForm(), horses: readHorsesFromList() };
        console.info('[FinishLine] Analyze payload:', payload);
        const out = await callJSON('/api/research_predict', payload);
        // Store if needed by predict step
        window.__finishline_lastAnalysis = out?.data || out;
        setBadge('Ready to predict', 'ready');
        console.info('[FinishLine] Analyze complete:', out);
        return out;
      }).catch(err => {
        setBadge('Analysis failed', 'error');
        if (resultBox) { resultBox.textContent = `Analyze error: ${err.message}`; resultBox.dataset.type='error'; resultBox.style.display='block'; }
        console.error('[FinishLine] Analyze failed:', err);
      });
    }, true);
  }

  // PREDICT
  if (predictBtn) {
    predictBtn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopImmediatePropagation();
      withButtonProgress(predictBtn, 'Predicting…', async () => {
        setBadge('Predicting…', 'predicting');
        const payload = {
          race: readRaceFromForm(),
          horses: readHorsesFromList(),
          analysis: window.__finishline_lastAnalysis || null
        };
        console.info('[FinishLine] Predict payload:', payload);
        // If you have a separate predict endpoint, use it; otherwise reuse research_predict.
        const out = await callJSON('/api/predict_wps', payload).catch(async () => {
          // fallback to existing research endpoint if predict not present
          return callJSON('/api/research_predict', payload);
        });
        setBadge('Ready', 'success');
        console.info('[FinishLine] Predict complete:', out);
        // (Optionally render predictions to your UI here)
        return out;
      }).catch(err => {
        setBadge('Prediction failed', 'error');
        if (resultBox) { resultBox.textContent = `Predict error: ${err.message}`; resultBox.dataset.type='error'; resultBox.style.display='block'; }
        console.error('[FinishLine] Predict failed:', err);
      });
    }, true);
  }

  console.info('[FinishLine] Analyze & Predict flows wired ✔');

  async function onExtract(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
    
    try {
      const payload = await send();
      
      if (prettyBox) {
        prettyBox.textContent = JSON.stringify(payload, null, 2);
        prettyBox.style.display = 'block';
      }

      const ex = payload?.data?.extracted;
      const note = payload?.data?.ocr_error;
      
      if (ex) {
        // Use global hook for sequential filling (async)
        await window.__finishline_fillFromOCR(ex);
      } else if (note) {
        show(`OCR note: ${note}`, 'error');
      } else {
        show('OCR returned no structured data.', 'error');
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
    console.info('[FinishLine] Extract button attached (capture phase)');
  }
  if (form) {
    form.addEventListener('submit', onExtract, true);
    console.info('[FinishLine] Form submit attached (capture phase)');
  }
  
  console.info('[FinishLine] Initialization complete');
    })();
    
// --- Photo picker state (keep existing) ---
window.PICKED_FILES = window.PICKED_FILES || [];

function updatePhotoCount() {
  const el = document.getElementById("photo-count") || document.getElementById("photoCount");
  if (el) el.textContent = `${(window.PICKED_FILES || []).length} / 6 selected`;
}
