(() => {
  // Single, authoritative initializer
  if (window.__finishline_upload_pipeline_v8) return;
  window.__finishline_upload_pipeline_v8 = true;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fire  = (el) => { if (!el) return; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
  const hud = $('#ocrHud');
  const setHud = (msg) => { if (hud) hud.textContent = msg || ''; };
  const loud   = (...a) => { console.log('%c[FinishLine]', 'color:#7cf;font-weight:bold', ...a); };

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

  // Add one horse via your real UI
  async function addHorseRow(h) {
    const nameEl = findEditorNameInput(); if (!nameEl) return false;
    nameEl.value = h?.name || ''; fire(nameEl, 'input'); fire(nameEl);
    const o = getOdds();    if (o && (h?.ml_odds || h?.odds)) { o.value = h.ml_odds || h.odds; fire(o, 'input'); fire(o); }
    const j = getJockey();  if (j && h?.jockey)  { j.value = h.jockey;  fire(j, 'input'); fire(j); }
    const t = getTrainer(); if (t && h?.trainer) { t.value = h.trainer; fire(t, 'input'); fire(t); }
    await sleep(50);

    const before = rowsCount();
    const form   = nameEl.closest('form');
    let   btn    = addBtn();

    const tryClickAdd = async () => {
      btn = addBtn();
      if (!btn) return false;
      try { btn.scrollIntoView({ block: 'center', inline: 'center' }); btn.removeAttribute('disabled'); } catch {}
      btn.click();
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        await sleep(60);
        if (rowsCount() > before) return true;
        if ((findEditorNameInput()?.value || '').trim() === '') return true;
      }
      return false;
    };

    if (await tryClickAdd()) return true;
    if (form?.requestSubmit) form.requestSubmit();
    else if (form) form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
    await sleep(200);
    if (rowsCount() > before || (findEditorNameInput()?.value||'') === '') return true;
    const enter = (type) => nameEl.dispatchEvent(new KeyboardEvent(type, { bubbles:true, cancelable:true, key:'Enter', code:'Enter' }));
    enter('keydown'); enter('keypress'); enter('keyup');
    await sleep(250);
    if (rowsCount() > before || (findEditorNameInput()?.value||'') === '') return true;
    if (await tryClickAdd()) return true;
    return false;
  }

  // Orchestrate OCR → add all horses
  async function processOCR(json) {
    const data   = json?.data || json;
    const extracted = data?.extracted || data?.result || data?.ocr || {};
    const horses = collectHorses(json);
    setRaceMeta(extracted?.race || data?.race || {});
    let added = 0;
    for (const h of horses) { if (await addHorseRow(h)) added++; }
    const badge  = $('#statusBadge') || $('[data-status-badge]') || $('.badge.idle') || $('.idle');
    if (badge) { badge.textContent = 'Ready to analyze'; badge.className = 'badge ready'; }
    const result = $('#ocrResult') || $('[data-ocr-result]');
    if (result) { result.textContent = `OCR parsed and populated ${added} horse${added===1?'':'s'}.`; result.dataset.type='info'; }
    setHud(`Parsed ${added}/${horses.length} horses.`);
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
})();