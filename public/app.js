(function () {
  // ---------- Small helpers ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const log = (...a) => console.log('[WPS]', ...a);
  const warn = (...a) => console.warn('[WPS]', ...a);
  const err = (...a) => console.error('[WPS]', ...a);

  function setBadge(t) { const b = $('#statusBadge'); if (b) b.textContent = t; }

  // ---------- Parsing helpers (fallback when API returns a text blob) ----------
  function parseRaceFromText(text) {
    // Naive extraction from OCR text; adjust patterns as needed
    const date = (text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i) || [,''])[1];
    const track = (text.match(/\b(Churchill Downs|Saratoga|Belmont|Keeneland|Santa Anita|Del Mar)\b/i) || [,''])[1];
    const surface = (text.match(/\b(Dirt|Turf|Synthetic)\b/i) || [,''])[1];
    const distance = (text.match(/\b(\d+\s*\/\s*\d+\s*miles|\d+\s*miles|\d+\s*\/\s*\d+\s*mi|\d+\s*mi)\b/i) || [,''])[1];
    return { date, track, surface, distance };
  }

  function parseHorsesFromText(text) {
    // Look for lines like "1. Clarita" and try to collect name/odds/jockey/trainer from nearby lines
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const horses = [];
    let cur = null;

    for (const ln of lines) {
      const m = ln.match(/^(\d+)\.\s*(.+)$/);  // e.g. "1. Clarita"
  if (m) {
        if (cur) horses.push(cur);
        cur = { name: m[2] || '' };
        continue;
      }
      if (!cur) continue;
      // naive heuristics for odds / jockey / trainer
      if (/^\d+\/\d+$/.test(ln) || /^\d+\/\d+\s*-\s*\d+\/\d+$/.test(ln) || /^\d+\/\d+(\s*\(\d+\))?$/.test(ln)) {
        cur.odds = cur.odds || ln;
      } else if (/jockey|jock|luis|ortiz|saez|smith|prat|gall/i.test(ln) && !cur.jockey) {
        cur.jockey = ln;
      } else if (/trainer|pletcher|baffert|brown|asmussen|mott|coxe/i.test(ln) && !cur.trainer) {
        cur.trainer = ln;
      }
    }
    if (cur) horses.push(cur);
    return horses;
  }

  // ---------- Rendering ----------
  function renderHorses(horses) {
    const rows = $('#horseRows');
    if (!rows) return warn('No #horseRows container found');
    rows.innerHTML = '';

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

  // Fill inputs and horses from a structured payload OR fallback text
  function fillFormFromExtraction(payload) {
    log('fillFormFromExtraction payload:', payload);

    // 1) Structured first
    let race = payload?.race || {};
    let horses = Array.isArray(payload?.horses) ? payload.horses : [];

    // 2) Fallback: try payload.text or payload.raw
    const blob = payload?.text || payload?.raw || payload?.content || '';
    if ((!race?.date && !race?.track && !race?.surface && !race?.distance) && blob) {
      race = { ...parseRaceFromText(blob) };
    }
    if ((!horses?.length) && blob) {
      horses = parseHorsesFromText(blob);
    }

    // 3) Fill the race inputs by ID
    const f = {
      date: $('#raceDate'),
      track: $('#raceTrack'),
      surface: $('#raceSurface'),
      distance: $('#raceDistance'),
    };
    if (f.date) f.date.value = race.date || f.date.value || '';
    if (f.track) f.track.value = race.track || f.track.value || '';
    if (f.surface) f.surface.value = race.surface || f.surface.value || '';
    if (f.distance) f.distance.value = race.distance || f.distance.value || '';

    // 4) Render the horses in #horseRows
    renderHorses(horses);

    // 5) Hide any raw debug blob area if present
    const dbg = $('#analysisOutput');
    if (dbg) dbg.style.display = 'none';
    setBadge('Ready to predict');
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
      const body = {
        race: {
          date: $('#raceDate')?.value || '',
          track: $('#raceTrack')?.value || '',
          surface: $('#raceSurface')?.value || '',
          distance: $('#raceDistance')?.value || '',
        },
        horses: $$('#horseRows .horse-row').map((r) => ({ text: r.textContent.trim() })),
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

  // ---------- Wire up (call these from your existing handlers) ----------
  document.addEventListener('DOMContentLoaded', () => {
    log('DOMContentLoaded: attaching handlers');
    attachHandlers();
    setBadge('Idle');
    healthCheck();
  });
})();