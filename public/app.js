(() => {
  if (window.__finishline_upload_pipeline_v8) return;
  window.__finishline_upload_pipeline_v8 = true;

  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const state = (window.__finishline ||= {});
  state.horses ||= [];
  state.race   ||= { date:'', track:'', surface:'', distance:'' };

  // ─────────────────────────────────────────────────────────────────────────────
  // UI: single-app renderer (replaces legacy static form)
  // ─────────────────────────────────────────────────────────────────────────────
  const ui = {
    root: null,
    mount() {
      this.root = $('#finishline-app');
      if (!this.root) return;
      this.root.innerHTML = this.template();
      this.bindStaticHandlers();
      this.render();
    },
    template() {
      return `
      <section class="fl-card">
        <header class="fl-header">
          <h1 class="fl-title">FinishLine WPS AI</h1>
          <span id="statusBadge" class="badge idle">Idle</span>
        </header>

        <div class="fl-grid">
          <div>
            <label class="fl-label">Race Date</label>
            <input id="raceDate" class="fl-input" placeholder="mm/dd/yyyy" value="${state.race.date||''}">
          </div>
          <div>
            <label class="fl-label">Track</label>
            <input id="track" class="fl-input" placeholder="e.g., Churchill Downs" value="${state.race.track||''}">
          </div>
          <div>
            <label class="fl-label">Surface</label>
            <select id="surface" class="fl-input">
              ${['Dirt','Turf','Synthetic'].map(s=>`<option ${state.race.surface===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="fl-label">Distance</label>
            <input id="distance" class="fl-input" placeholder="e.g., 1 1/4 miles" value="${state.race.distance||''}">
          </div>
        </div>

        <h2 class="fl-subtitle">Horse Data</h2>
        <div class="fl-row add-row">
          <input id="add-name" class="fl-input" placeholder="Horse Name">
          <input id="add-odds" class="fl-input fl-compact" placeholder="ML Odds (e.g., 5/2)">
          <input id="add-jockey" class="fl-input" placeholder="Jockey">
          <input id="add-trainer" class="fl-input" placeholder="Trainer">
          <button class="fl-btn add-horse-btn">Add Horse</button>
        </div>

        <div class="fl-table-wrap">
          <div class="fl-table-head">
            <div>#</div><div>Horse</div><div>ML Odds</div><div>Jockey</div><div>Trainer</div><div></div>
          </div>
          <div id="horseList" class="fl-table-body"></div>
        </div>

        <div class="fl-actions">
          <button id="btn-choose" class="fl-btn-secondary">Choose Photos / PDF</button>
          <button id="btn-analyze" class="fl-btn">Analyze Photos with AI</button>
          <button id="btn-predict" class="fl-btn accent">Predict W/P/S</button>
        </div>

        <div class="fl-note" id="ocrResult">Upload a sheet to auto-extract horses.</div>
      </section>`;
    },
    bindStaticHandlers() {
      // race meta
      const bind = (id, key) => {
        const el = $('#'+id);
        if (el) el.addEventListener('input', () => { state.race[key] = el.value.trim(); });
      };
      bind('raceDate','date'); bind('track','track'); bind('surface','surface'); bind('distance','distance');

      // file picker
      const btnChoose = $('#btn-choose');
      const fileInput = $('#fl-file-input');
      if (btnChoose && fileInput) {
        btnChoose.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', onFilesChosen);
      }
      // add horse
      const addBtn = $('.add-horse-btn');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          const name = $('#add-name')?.value?.trim();
          const ml_odds = $('#add-odds')?.value?.trim();
          const jockey = $('#add-jockey')?.value?.trim();
          const trainer = $('#add-trainer')?.value?.trim();
          if (!name) return;
          pushHorse({name, ml_odds, jockey, trainer});
          ['add-name','add-odds','add-jockey','add-trainer'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
        });
      }
      // analyze/predict
      const aBtn = $('#btn-analyze'); const pBtn = $('#btn-predict');
      if (aBtn && !aBtn.dataset.bound) { aBtn.dataset.bound='1'; aBtn.addEventListener('click', onAnalyze); }
      if (pBtn && !pBtn.dataset.bound) { pBtn.dataset.bound='1'; pBtn.addEventListener('click', onPredict); }
    },
    render() {
      // horses
      const list = $('#horseList'); if (!list) return;
      list.innerHTML = state.horses.map((h, i) => `
        <div class="fl-row">
          <div>${i+1}</div>
          <div>${esc(h.name)}</div>
          <div>${esc(h.ml_odds||'')}</div>
          <div>${esc(h.jockey||'')}</div>
          <div>${esc(h.trainer||'')}</div>
          <div><button data-rm="${i}" class="fl-mini danger">Remove</button></div>
        </div>
      `).join('') || `<div class="fl-empty">No horses yet. Upload a sheet or add manually.</div>`;
      // remove handlers
      $$('#horseList button[data-rm]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const idx = +btn.dataset.rm;
          state.horses.splice(idx,1);
          ui.render();
        });
      });
    }
  };

  // Escape html
  const esc = (s) => (s??'').toString().replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  // Kick UI
  ui.mount();

  // ─────────────────────────────────────────────────────────────────────────────
  // OCR: helpers (we keep your existing pipeline)
  // ─────────────────────────────────────────────────────────────────────────────
  const setHud = (msg) => console.log('[FinishLine]', msg);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  // Remove "required" on any race-info inputs (no blockers)
  (function relaxAllRequired() {
    const raceInfo = document.querySelector('[data-section="race-info"]')
                  || document.querySelector('#raceInfo')
                  || document;
    $$('input[required], select[required], textarea[required]', raceInfo).forEach(el => {
      el.removeAttribute('required');
      el.setCustomValidity?.('');
    });
  })();

  const photosInput = $('#photosInput');
  const chooseBtn   = $('#choosePhotosBtn');

  // Editor helpers (your live inputs)
  const editorScope = () =>
    document.querySelector('[data-horse-editor]') ||
    document.querySelector('.horse-editor') ||
    document;
  const findEditorNameInput = () =>
    $('[name="horseName"], input[name="horseName"], #horseName, input[placeholder*="Horse Name" i], .horse-name input', editorScope()) ||
    $('#horseName');
  const getOdds    = () => $('[name="mlOdds"], input[name="mlOdds"], #mlOdds, input[placeholder*="ML Odds" i]', editorScope());
  const getJockey  = () => $('[name="jockey"], #jockey, input[placeholder*="Jockey" i]', editorScope());
  const getTrainer = () => $('[name="trainer"], #trainer, input[placeholder*="Trainer" i]', editorScope());

  // Count rows across many DOMs
  const rowsCount = () => {
    const selectors = [
      '.horse-list .horse-row',
      '.horses .row',
      '.horse-items .item',
      '.added-horses .row',
      '[data-horse-row]',
      '.horse-row',
      '.horse-card',
      '#horsesList li',
      '.horse-list li',
      '.horses li',
      '[role="list"] [role="listitem"]',
    ];
    for (const sel of selectors) {
      const n = $$(sel).length;
      if (n) return n;
    }
    return 0;
  };

  // Find the real "Add Horse" button (based on your DOM)
  const addBtn = () => {
    const textMatch = (el) => /(^|\b)add\s*horse(\b|$)/i.test((el.textContent||el.value||'').trim());
    let btn =
      document.querySelector('[data-action="add-horse"]') ||
      document.getElementById('addHorseBtn') ||
      document.querySelector('.add-horse, button.add-horse, button.add-horse-btn, .add-horse-btn, .button.add-horse-btn');
    if (btn) return btn;
    let fallback = $$('button, a, input[type="button"], input[type="submit"]').find(textMatch);
    if (fallback) return fallback;
    const scope = editorScope();
    return $$('button, a, input[type="button"], input[type="submit"]', scope).find(textMatch) || null;
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Horses store + renderer (decoupled from missing legacy handlers)
  // ──────────────────────────────────────────────────────────────────────────
  const horsesListEl = $('#horsesList');
  const clearEditor = () => {
    const n = findEditorNameInput(); if (n) n.value = '';
    const o = getOdds();            if (o) o.value = '';
    const j = getJockey();          if (j) j.value = '';
    const t = getTrainer();         if (t) t.value = '';
    [findEditorNameInput(), getOdds(), getJockey(), getTrainer()].forEach(fire);
  };

  const normalizeHorse = (h) => {
    const name    = (h?.name || h?.horse || h?.title || '').toString().trim();
    const ml_odds = (h?.ml_odds || h?.odds || h?.['ML Odds'] || '').toString().trim();
    const jockey  = (h?.jockey || '').toString().trim();
    const trainer = (h?.trainer|| '').toString().trim();
    return name ? { name, ml_odds, jockey, trainer } : null;
  };

  const renderHorses = () => {
    if (!horsesListEl) return;
    horsesListEl.innerHTML = '';
    state.horses.forEach((h, idx) => {
      const row = document.createElement('div');
      row.className = 'horse-row';
      row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1.5fr 1.5fr auto;gap:8px;align-items:center;background:rgba(255,255,255,.03);padding:8px;border-radius:10px;';
      row.innerHTML = `
        <div><strong>${idx+1}.</strong> ${h.name}</div>
        <div>${h.ml_odds || ''}</div>
        <div>${h.jockey || ''}</div>
        <div>${h.trainer|| ''}</div>
        <button type="button" class="btn btn-secondary btn-sm" data-remove="${idx}">Remove</button>
      `;
      horsesListEl.appendChild(row);
    });
    horsesListEl.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-remove'));
        state.horses.splice(i,1);
        renderHorses();
      });
    });
  };

  const pushHorse = (h) => {
    const canon = normalizeHorse(h);
    if (!canon) return false;
    // dedupe by name
    const key = canon.name.toLowerCase();
    if (state.horses.some(x => x.name.toLowerCase() === key)) return false;
    state.horses.push(canon);
    ui.render();
    return true;
  };


  // 🔁 Inject horses into the original app's dataset so Analyze/Predict works
  const syncToLegacyStore = () => {
    try {
      if (window.FinishLine && Array.isArray(window.FinishLine.horses)) {
        window.FinishLine.horses = [...state.horses];
        if (typeof window.FinishLine.updateUI === 'function') window.FinishLine.updateUI();
      } else if (Array.isArray(window.horseEntries)) {
        window.horseEntries = [...state.horses];
      } else {
        window.horses = [...state.horses];
      }
      console.log('%c[FinishLine] Synced horses to main app store:', 'color:#8ff', state.horses);
    } catch (err) {
      console.warn('Sync to legacy store failed:', err);
    }
  };

  // Upload → OCR
  async function callOCR(files) {
    if (!files?.length) throw new Error('No files selected.');
    const fd = new FormData();
    for (const f of files) { fd.append('files', f); fd.append('photos', f); }   // tolerate both keys
    loud('POST → /api/photo_extract_openai_b64 with', files.length, 'file(s)');
    const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
    let json; try { json = await res.json(); } catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok || json?.ok === false) {
      const m = json?.error?.message || json?.message || `Upload failed (HTTP ${res.status}).`;
      throw new Error(m);
    }
    return json;
  }

  // Deep-scan horses in OCR JSON
  function collectHorses(payload) {
    const data = payload?.data || payload || {};
    const root = data.extracted || data.result || data.ocr || data || {};

    const looksLikeHorseObj = (o) => {
      if (!o || typeof o !== 'object') return false;
      const keys = Object.keys(o).map(k => k.toLowerCase());
      const hasNameish = ['name','horse','title','horse name'].some(k => keys.includes(k));
      const hasFields  = ['jockey','trainer','odds','ml_odds','ml odds','morning_line','morning line'].some(k => keys.includes(k));
      return hasNameish || hasFields;
    };
    const canon = (name, obj) => {
      const n   = (name || obj?.name || obj?.horse || obj?.title || obj?.Horse || obj?.['Horse Name'] || '').toString().trim();
      const odd = (obj?.ml_odds || obj?.odds || obj?.['ML Odds'] || obj?.['Odds'] || obj?.morning_line || obj?.['Morning Line'] || '').toString().trim();
      const joc = (obj?.jockey || obj?.Jockey || obj?.['Jockey Name'] || '').toString().trim();
      const tra = (obj?.trainer|| obj?.Trainer|| obj?.['Trainer Name']|| '').toString().trim();
      return n ? { name: n, ml_odds: odd, jockey: joc, trainer: tra } : null;
    };

    const out = [];
    const pushCanon = (name, obj) => { const c = canon(name, obj); if (c) out.push(c); };

    const seen = new WeakSet();
    const walk = (node) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        if (node.length && node.every(el => typeof el === 'object')) {
          if (node.some(looksLikeHorseObj)) {
            node.forEach(el => looksLikeHorseObj(el) && pushCanon(null, el));
          } else {
            node.forEach(walk);
          }
        } else {
          node.forEach(walk);
        }
        return;
      }
      const values = Object.values(node);
      const keys   = Object.keys(node);
      if (values.length && values.every(v => typeof v === 'object')) {
        const childLooksLikeHorse = values.some(looksLikeHorseObj);
        if (childLooksLikeHorse) {
          keys.forEach((k, i) => {
            const v = values[i];
            if (looksLikeHorseObj(v)) pushCanon(k, v);
          });
        }
      }
      if (looksLikeHorseObj(node)) pushCanon(null, node);
      for (const v of values) walk(v);
    };
    walk(root);

    const seenNames = new Set();
    return out.filter(h => {
      const key = h.name.toLowerCase();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
  }

  // Set race meta if present (non-blocking)
  function setRaceMeta(meta={}) {
    const track = $('[name="track"], #track, input[placeholder*="track" i]');
    const dist  = $('[name="distance"], #distance, input[placeholder*="miles" i]');
    if (track && meta.track)  { track.value = meta.track;  fire(track); }
    if (dist  && meta.distance){ dist.value  = meta.distance;fire(dist);  }
  }

  // Our add function now uses the local store/renderer
  async function addHorseRow(h) {
    const ok = pushHorse(h);
    clearEditor();
    syncToLegacyStore();
    return ok;
  }

  // Orchestrate OCR → add all horses
  async function processOCR(json) {
    const data   = json?.data || json;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses = collectHorses(json);
    setRaceMeta(extracted?.race || data?.race || {});
    let added = 0;
    for (const h of horses) { if (await addHorseRow(h)) added++; }
    const badge  = $('#statusBadge') || $('[data-status-badge]') || $('.badge');
    if (badge) { badge.textContent = 'Ready to analyze'; badge.className = 'badge ready'; }
    const result = $('#ocrResult') || $('[data-ocr-result]');
    if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type='info'; }
    setHud(`Parsed ${added}/${horses.length} horses.`);
    // UI now owns the list; legacy sync optional
  }

  // Bind single, canonical button
  (function bindChoose() {
    if (!chooseBtn || chooseBtn.dataset.bound) return;
    chooseBtn.dataset.bound = '1';
    chooseBtn.addEventListener('click', (e) => { e.preventDefault(); photosInput.click(); });
  })();

  // Trigger on change
  ;(function bindInput(){
    if (!photosInput || photosInput.dataset.bound) return;
    photosInput.dataset.bound = '1';
    photosInput.addEventListener('change', async () => {
      try {
        const files = Array.from(photosInput.files || []);
        if (!files.length) return;
        setHud(`Uploading ${files.length} file(s)…`);
        const json = await callOCR(files);
        await processOCR(json);
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err));
        setHud(`OCR error: ${msg}`);
        alert(`OCR error: ${msg}`);
      }
    });
  })();

  // Optional: basic drop support for the same single input
  ;(function bindDropzone(){
    const dz = $('#dropzone'); if (!dz) return;
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(ev => dz.addEventListener(ev, stop));
    dz.addEventListener('drop', async (e) => {
      try {
        const files = Array.from(e.dataTransfer?.files || []);
        if (!files.length) return;
        setHud(`Uploading ${files.length} file(s)…`);
        const json = await callOCR(files);
        await processOCR(json);
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err));
        setHud(`OCR error: ${msg}`);
        alert(`OCR error: ${msg}`);
      }
    });
  })();

  // Bind our own Add Horse button to the store/renderer
  (function bindAddButton(){
    // handled by ui.bindStaticHandlers()
  })();

  // ─────────────────────────────────────────────────────────────────────────────
  // ANALYZE & PREDICT — progress bars + payload = { race, horses }
  // (re-using earlier code; now sourced from UI state)
  // ─────────────────────────────────────────────────────────────────────────────
  const getRaceMetaFromForm = () => ({ ...state.race });

  const readHorsesFromNativeList = () => {
    // Not needed anymore; UI state is source of truth
    return [];
  };

  const collectForCompute = () => {
    return Array.isArray(state.horses) ? state.horses : [];
  };

  const postJSON = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
    return res.json();
  };

  const withProgress = async (btn, labelWorking, task) => {
    if (!btn) return task();
    const orig = btn.textContent;
    btn.disabled = true;
    let pct = 3;
    const tick = () => {
      pct = Math.min(97, pct + Math.random()*9);
      btn.textContent = `${labelWorking} ${Math.floor(pct)}%`;
    };
    const id = setInterval(tick, 220);
    try {
      const val = await task();
      pct = 100; btn.textContent = `${labelWorking} 100%`;
      return val;
    } finally {
      clearInterval(id);
      setTimeout(()=>{ btn.disabled = false; btn.textContent = orig; }, 350);
    }
  };

  const showBadge = (text, cls='ready') => {
    const badge  = $('#statusBadge') || $('[data-status-badge]') || $('.badge');
    if (badge) { badge.textContent = text; badge.className = `badge ${cls}`; }
  };

  const showResultToast = (msg) => {
    const result = $('#ocrResult') || $('[data-ocr-result]');
    if (result) { result.textContent = msg; result.dataset.type='info'; }
    setHud(msg);
  };

  async function onAnalyze() {
    const horses = collectForCompute();
    if (!horses.length) { alert('No horses to analyze yet.'); return; }
    const race = getRaceMetaFromForm();
    const btn = $('#btn-analyze');
    try {
      const json = await withProgress(btn, 'Analyzing', () =>
        postJSON('/api/research_predict', { race, horses })
      );
      window.__finishline_last_analysis = json;
      showResultToast('Analysis complete. Ready to predict.');
      showBadge('Ready to predict','ready');
    } catch (err) {
      alert('Analyze error: ' + (err?.message || String(err)));
    }
  }

  async function onPredict() {
    const horses = collectForCompute();
    if (!horses.length) { alert('No horses to predict yet.'); return; }
    const race = getRaceMetaFromForm();
    const btn = $('#btn-predict');
    try {
      const json = await withProgress(btn, 'Predicting', () =>
        postJSON('/api/predict_wps', { race, horses, analysis: window.__finishline_last_analysis || null })
      );
      window.__finishline_last_prediction = json;
      showResultToast('Prediction ready. Open console: __finishline_last_prediction');
      showBadge('Prediction ready','ready');
    } catch (err) {
      alert('Predict error: ' + (err?.message || String(err)));
    }
  }

  // File selection → auto-extract
  async function onFilesChosen(e) {
    const files = Array.from(e.target.files||[]);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach(f => fd.append('files', f, f.name));
    try {
      const res = await fetch('/api/photo_extract_openai_b64', { method:'POST', body: fd });
      const json = await res.json();
      if (!res.ok || json.ok===false) throw new Error(JSON.stringify(json?.error||json));
      await processOCR(json);
    } catch (err) {
      alert(`Upload/Extract error: ${err?.message||err}`);
    } finally {
      e.target.value = ''; // reset input
    }
  }
})();