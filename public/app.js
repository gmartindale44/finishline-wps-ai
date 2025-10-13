// Fill form from { race, horses[] } and show any ocr_error note.

(() => {
  console.info('[FinishLine] app.js loaded with multi-horse OCR ✔');

  const form        = document.getElementById('raceForm') || document.getElementById('ocrForm') || document.querySelector('form[data-ocr]');
  const extractBtn  = document.getElementById('extractBtn') || document.getElementById('btnExtract') || document.querySelector('[data-action="extract"]');
  const chooseBtn   = document.getElementById('choosePhotosBtn') || document.getElementById('btnChoosePhotos') || document.querySelector('[data-action="choose-photos"]');
  const fileInput   = document.getElementById('fileInput') || document.getElementById('photoFiles') || (() => {
    const el = document.createElement('input'); el.type='file'; el.multiple=true; el.id='fileInput'; el.style.display='none'; document.body.appendChild(el); return el;
  })();
  const resultBox   = document.getElementById('ocrResult');
  const prettyBox   = document.getElementById('ocrJson');
  const countBadge  = document.getElementById('photoCount') || document.getElementById('photo-count');
  const addHorseBtn = document.getElementById('add-horse-btn') || document.getElementById('addHorseBtn') || document.getElementById('add-horse') || document.getElementById('btnAddHorse') || document.querySelector('[data-action="add-horse"]') || document.querySelector('[data-add-horse]');

  const bucket = [];
  
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
  
  const addFiles = (list) => {
  if (!list) return;
    bucket.length = 0; // Clear and refill
    for (const f of list) if (f?.name) bucket.push(f);
    if (countBadge) countBadge.textContent = `${bucket.length} / 6 selected`;
    console.debug('[FinishLine] Added files:', bucket.map(f => ({name:f.name,size:f.size,type:f.type})));
  };
  
  if (chooseBtn && fileInput) {
    chooseBtn.addEventListener('click', e => {
      e.preventDefault();
        fileInput.click();
      });
    console.info('[FinishLine] Wired choose button');
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', e => addFiles(e.target.files));
    console.info('[FinishLine] File input listener attached');
  }

  // Drag & drop
  const dropzone = document.getElementById('drop-zone') || document.getElementById('photoDropzone') || document.querySelector('[data-dropzone]');
  if (dropzone) {
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      addFiles(e.dataTransfer?.files);
    });
    console.info('[FinishLine] Drag & drop attached');
  }

  async function send() {
    if (!bucket.length) throw new Error('No files selected. Choose images/PDFs first.');
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

  // === SCOPED EDITOR DISCOVERY ===
  
  function getHorseNameInput() {
    // prefer semantic ids/names first
    return $('#horseName') || $('input[name="horseName"]') ||
      $$('input,textarea').find(el =>
        /horse\s*name/i.test([el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||''].join(' '))
      );
  }
  function getEditorContainer() {
    const nameEl = getHorseNameInput();
    if (!nameEl) return null;
    return nameEl.closest('[data-section="horse"], section, fieldset, .card, .panel, .horse-editor, .horse-data') || nameEl.parentElement;
  }
  function findInEditor(rx) {
    const scope = getEditorContainer() || document;
    const re = rx instanceof RegExp ? rx : new RegExp(String(rx), 'i');
    return $$('input,textarea,select', scope).find(el => {
      const s = [el.placeholder||'', el.name||'', el.id||'', el.getAttribute('aria-label')||'', el.closest('label')?.textContent||''].join(' ');
      return re.test(s);
    });
  }
  const getMlOddsInput = () => findInEditor(/(ml\s*odds|odds)/i);
  const getJockeyInput = () => findInEditor(/jockey/i);
  const getTrainerInput= () => findInEditor(/trainer/i);
  function getAddHorseControl() {
    const scope = getEditorContainer() || document;
    // strictly inside the editor container
    return $$('button, a, input[type="button"], input[type="submit"]', scope)
      .find(el => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim()))
      || scope.querySelector('[data-action="add-horse"], #addHorseBtn, .add-horse, button.add-horse');
  }

  // === OCR → ADD HORSES SEQUENTIALLY VIA EDITOR ===
  
  async function addOneHorse(h) {
    const nameEl = getHorseNameInput();
    if (!nameEl) return false;

    if (h?.name)   { nameEl.value = h.name; fire(nameEl); }
    const oddsEl = getMlOddsInput();
    if (oddsEl && (h?.ml_odds || h?.odds)) { oddsEl.value = h.ml_odds || h.odds; fire(oddsEl); }
    const jEl = getJockeyInput();  if (jEl && h?.jockey)  { jEl.value = h.jockey; fire(jEl); }
    const tEl = getTrainerInput(); if (tEl && h?.trainer) { tEl.value = h.trainer; fire(tEl); }

    await sleep(50);
    const addBtn = getAddHorseControl();
    const form   = nameEl.closest('form');
    if (addBtn) addBtn.click();
    else if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit', { bubbles:true }));

    await sleep(110); // give your app time to append + clear
    return true;
  }

  // Public hook used in the OCR success path
  window.__finishline_fillFromOCR = async function(extracted) {
    console.info('[FinishLine] __finishline_fillFromOCR called with:', extracted);
    
    // --- Race meta (tolerant) ---
    const setMeta = (label, val) => {
      if (val == null) return;
      const el = document.getElementById(label)
        || document.querySelector(`[name="${label}"]`)
        || $$('input,select,textarea').find(x => new RegExp(label,'i').test(
             [x.placeholder||'', x.name||'', x.id||'', x.getAttribute('aria-label')||''].join(' ')
           ));
      if (el) { el.value = val; fire(el); }
    };
    const race = extracted?.race || {};
    setMeta('raceDate', race.date);
    setMeta('track',    race.track);
    setMeta('surface',  race.surface);
    setMeta('distance', race.distance);

    // --- Horses (sequential) ---
    const horses = Array.isArray(extracted?.horses) ? extracted.horses : [];
    let added = 0;
    for (const h of horses) { if (await addOneHorse(h)) added++; }

    if (resultBox) { resultBox.textContent = `✅ OCR parsed and populated ${added} horses.`; resultBox.dataset.type = 'info'; resultBox.style.display = 'block'; }

    // Store for later steps
    window.__finishline_lastExtracted = extracted;

    // Ready to analyze next
    setBadge('Ready to analyze', 'ready');
    console.info(`[FinishLine] OCR complete: ${added} horses added`);
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
