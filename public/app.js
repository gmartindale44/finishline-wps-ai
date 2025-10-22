(function () {
  // ---------- DOM helpers ----------
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const log = (...a) => console.log('[WPS]', ...a);
  const warn = (...a) => console.warn('[WPS]', ...a);
  const err = (...a) => console.error('[WPS]', ...a);

  function ensureHorseRowsContainer() {
    let rows = $('#horseRows');
    if (rows) return rows;

    // Find the Add Horse button's row; insert right after it
    const addRow = $('#horseRows') || document.querySelector('#addHorse')?.closest?.('div');
    const host = addRow?.parentElement || document.querySelector('section,div') // fallback
    rows = document.createElement('div');
    rows.id = 'horseRows';
    rows.className = 'space-y-1 mt-2';
    // Insert before the button row? or right after single-row inputs:
    const horseDataBlock = document.querySelector('#horseRows')?.parentElement
      || document.querySelector('#horse-data, .horse-data, .horse-block') 
      || host;
    (horseDataBlock || document.body).insertBefore(rows, (document.querySelector('#chooseBtn') || document.querySelector('#analyzeBtn')));
    return rows;
  }

  function hideLegacyDump() {
    const junk = $('#legacyDump') || document.querySelector('#analysisOutput, #output, #result, textarea, pre');
    if (junk) junk.style.display = 'none';
  }

  function setBadge(text) {
    const b = $('#statusBadge');
    if (b) b.textContent = text;
  }

  // ---------- Robust fallback parsers ----------
  function parseRaceFromText(text) {
    const date     = (text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i) || [,''])[1];
    const track    = (text.match(/\b(Churchill Downs|Saratoga|Belmont|Keeneland|Santa Anita|Del Mar)\b/i) || [,''])[1];
    const surface  = (text.match(/\b(Dirt|Turf|Synthetic)\b/i) || [,''])[1];
    const distance = (text.match(/\b(\d+\s*\/\s*\d+\s*miles|\d+\s*miles|\d+\s*\/\s*\d+\s*mi|\d+\s*mi)\b/i) || [,''])[1];
    return { date, track, surface, distance };
  }

  // Fallback horse parser that ALWAYS produces rows for "1. Name" lines.
  // Odds/jockey/trainer are best-effort.
  function parseHorsesFromText(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const horses = [];
    let cur = null;

    const pushCur = () => { if (cur && cur.name) horses.push(cur); cur = null; };

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const m = ln.match(/^(\d+)\.\s*(.+)$/);  // "1. Clarita"
      if (m) {
        pushCur();
        cur = { name: m[2], odds: '', jockey: '', trainer: '' };
        continue;
      }
      if (!cur) continue;

      // odds guess
      if (!cur.odds && /(\d+\/\d+)(\s*-\s*\d+\/\d+)?/.test(ln)) {
        cur.odds = ln;
        continue;
      }
      // jockey trainer guesses
      if (!cur.jockey && /(jockey|^luis|^irad|^jose|saez|prat|rosario|smith)/i.test(ln)) {
        cur.jockey = ln.replace(/^jockey[:\s-]*/i, '');
        continue;
      }
      if (!cur.trainer && /(trainer|pletcher|baffert|brown|asmussen|mott|cox)/i.test(ln)) {
        cur.trainer = ln.replace(/^trainer[:\s-]*/i, '');
        continue;
      }
    }
    pushCur();
  return horses;
}

  // ---------- Rendering ----------
  function renderHorses(horses) {
    const rows = ensureHorseRowsContainer();
    rows.innerHTML = '';
    if (!horses || !horses.length) return;

    horses.forEach((h, i) => {
      const el = document.createElement('div');
      el.className = 'horse-row flex items-center justify-between py-1 border-b border-white/10';
      el.innerHTML = `
        <div class="flex-1 truncate">${i + 1}. <strong>${h.name || ''}</strong></div>
        <div class="w-24 text-right opacity-80">${h.odds || ''}</div>
        <div class="w-48 text-right opacity-80 truncate">${h.jockey || ''}</div>
        <div class="w-48 text-right opacity-80 truncate">${h.trainer || ''}</div>
      `;
      rows.appendChild(el);
    });
  }

  // ---------- Orchestrator ----------
  function fillFormFromExtraction(payload) {
    hideLegacyDump();

    // Primary: structured payload
    let race   = payload?.race || {};
    let horses = Array.isArray(payload?.horses) ? payload.horses : [];

    // Fallback: plain text blob
    const blob = payload?.text || payload?.raw || payload?.content || payload?.ocr || '';
    if ((!race?.date && !race?.track && !race?.surface && !race?.distance) && blob) {
      race = parseRaceFromText(blob);
    }
    if ((!horses?.length) && blob) {
      horses = parseHorsesFromText(blob);
    }

    // Fill race inputs
    const f = {
      date:     $('#raceDate'),
      track:    $('#raceTrack'),
      surface:  $('#raceSurface'),
      distance: $('#raceDistance'),
    };
    if (f.date)     f.date.value     = race.date     || f.date.value     || '';
    if (f.track)    f.track.value    = race.track    || f.track.value    || '';
    if (f.surface)  f.surface.value  = race.surface  || f.surface.value  || '';
    if (f.distance) f.distance.value = race.distance || f.distance.value || '';

    // Render horses in structured rows
    renderHorses(horses);

    // Badge
    setBadge('Ready to predict');
  }

  // ---------- Predict should read from #horseRows, not any textarea ----------
  function collectHorsesFromUI() {
    const rows = $$('#horseRows .horse-row');
    if (!rows.length) return [];
    return rows.map((row) => {
      const cols = row.querySelectorAll('div');
      const name    = cols[0]?.textContent.replace(/^\d+\.\s*/, '').trim() || '';
      const odds    = cols[1]?.textContent.trim() || '';
      const jockey  = cols[2]?.textContent.trim() || '';
      const trainer = cols[3]?.textContent.trim() || '';
      return { name, odds, jockey, trainer };
    });
  }

  async function healthCheck() {
    try {
      const r = await fetch('/api/health');
      const t = await r.text();
      log('Health:', r.status, t);
        } catch (e) {
      warn('Health check failed:', e);
    }
  }

  function attachHandlers() {
    const chooseBtn = $('#chooseBtn');
    const analyzeBtn = $('#analyzeBtn');
    const predictBtn = $('#predictBtn');
    const fileInput = $('#fileInput');

    if (chooseBtn && fileInput) {
      chooseBtn.addEventListener('click', () => {
        log('Choose clicked -> opening file dialog');
        fileInput.click();
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        log('File selected:', !!f, f ? { name: f.name, type: f.type, size: f.size } : null);
        if (f) {
          // Auto-run analyze as soon as a file is chosen
          analyzeWithAI();
          } else {
          warn('No file selected');
        }
      });
    }

    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', analyzeWithAI);
    }

    if (predictBtn) {
      predictBtn.addEventListener('click', predictWPS);
    }

    // Prevent Enter key from trying to submit a form and reloading page
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
  }

  async function analyzeWithAI() {
    const fileInput = $('#fileInput');
    const file = fileInput?.files?.[0];
    if (!file) {
      alert('Please choose a photo or PDF first.');
      return;
    }

    try {
      setBadge('Analyzing...');
      const form = new FormData();
      form.append('file', file);
      log('Posting to /api/photo_extract_openai_b64 with file:', { name: file.name, type: file.type, size: file.size });

      const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: form });
            const raw = await res.text();
      log('Raw response:', res.status, raw);

            let data;
      try { data = JSON.parse(raw); } catch { data = { ok: false, error: 'Non-JSON response', raw }; }

      if (!res.ok) {
        setBadge('Idle');
        return alert(`Analyze failed: ${data?.error || res.statusText}`);
      }
      if (data?.ok !== true) {
        setBadge('Idle');
        return alert(`Analyze error: ${data?.error || 'Unknown backend error'}`);
      }

      fillFormFromExtraction(data);
          } catch (e) {
      err('Analyze exception:', e);
      setBadge('Idle');
      alert(`Analyze error: ${e?.message || e}`);
    }
  }

  async function predictWPS() {
    setBadge('Predicting...');
    try {
      const horses = collectHorsesFromUI();
      log('[Predict] horses:', horses);
      
      const body = {
        race: {
          date: $('#raceDate')?.value || '',
          track: $('#raceTrack')?.value || '',
          surface: $('#raceSurface')?.value || '',
          distance: $('#raceDistance')?.value || '',
        },
        horses: horses,
      };
      log('Predict request body:', body);
      const res = await fetch('/api/predict_wps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
      log('Predict response:', res.status, data);
        
        if (!res.ok) {
        setBadge('Idle');
        return alert(`Predict error: ${data?.error || res.statusText}`);
      }
      alert(data?.msg || 'Prediction complete (stub).');
      setBadge('Idle');
    } catch (e) {
      err('Predict exception:', e);
      setBadge('Idle');
      alert(`Predict error: ${e?.message || e}`);
    }
  }

  // ---------- Wire up ----------
  document.addEventListener('DOMContentLoaded', () => {
    log('DOMContentLoaded: attaching handlers');
    attachHandlers();
    setBadge('Idle');
    healthCheck();
  });
})();