(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function log(...args) { console.log('[WPS]', ...args); }
  function warn(...args) { console.warn('[WPS]', ...args); }
  function err(...args) { console.error('[WPS]', ...args); }

  function setBadge(text) {
    const b = $('#statusBadge');
    if (b) b.textContent = text;
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
      setBadge('Ready to predict');
      } catch (e) {
      err('Analyze exception:', e);
      setBadge('Idle');
      alert(`Analyze error: ${e?.message || e}`);
    }
  }

  function fillFormFromExtraction(payload) {
    const race = payload?.race ?? {};
    const horses = Array.isArray(payload?.horses) ? payload.horses : [];
    log('Filling form with:', { race, horsesCount: horses.length });

    const fields = {
      date: $('#raceDate'),
      track: $('#raceTrack'),
      surface: $('#raceSurface'),
      distance: $('#raceDistance'),
    };
    log('Detected fields:', fields);

    if (fields.date) fields.date.value = race.date ?? '';
    if (fields.track) fields.track.value = race.track ?? '';
    if (fields.surface) fields.surface.value = race.surface ?? '';
    if (fields.distance) fields.distance.value = race.distance ?? '';

    const list = $('#horseList');
    if (!list) return warn('No #horseList');
    list.innerHTML = '';
    horses.forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'horse-row py-1 flex items-center justify-between';
      row.innerHTML = `
        <div class="truncate">${i + 1}. <strong>${h.name || ''}</strong></div>
        <div class="opacity-80">${h.odds || ''}</div>
        <div class="opacity-80">${h.jockey || ''}</div>
        <div class="opacity-80">${h.trainer || ''}</div>
      `;
      list.appendChild(row);
    });
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
        horses: $$('#horseList .horse-row').map((r) => ({ text: r.textContent.trim() })),
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

  document.addEventListener('DOMContentLoaded', () => {
    log('DOMContentLoaded: attaching handlers');
    attachHandlers();
    setBadge('Idle');
    healthCheck();
  });
})();