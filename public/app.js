(function () {
  // Utilities
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function setBadge(text) {
    const b = $('#statusBadge');
    if (b) b.textContent = text;
  }

  function attachHandlers() {
    const chooseBtn = $('#chooseBtn');
    const analyzeBtn = $('#analyzeBtn');
    const predictBtn = $('#predictBtn');
    const fileInput = $('#fileInput');

    if (chooseBtn && fileInput) {
      chooseBtn.addEventListener('click', () => fileInput.click());
    }

    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', analyzeWithAI);
    }

    if (predictBtn) {
      predictBtn.addEventListener('click', predictWPS);
    }
  }

  async function analyzeWithAI() {
    try {
      const fileInput = $('#fileInput');
      if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        alert('Choose a photo or PDF first.');
        return;
      }

      setBadge('Analyzing...');
      const form = new FormData();
      form.append('file', fileInput.files[0]);

      // POST to server
      const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: form });

      // Be robust to non-JSON (debug text)
      const raw = await res.text();
      console.group('AI Extraction Response');
      console.log('Raw response:', raw);
      console.groupEnd();

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        // fallback: if backend printed debug text instead of JSON
        payload = { ok: false, error: 'Non-JSON response', raw };
      }

      if (!res.ok) {
        const msg = payload?.error || `${res.status} ${res.statusText}`;
        setBadge('Idle');
        return alert(`Analyze error: ${msg}`);
      }

      // Some stubs return ok: true with sample race/horses
      if (payload?.ok !== true) {
        setBadge('Idle');
        return alert(`Analyze error: ${payload?.error || 'Unknown backend error'}`);
      }

      // Fill the form & list
      fillFormFromExtraction(payload);
      setBadge('Ready to predict');
    } catch (err) {
      console.error(err);
      setBadge('Idle');
      alert(`Analyze error: ${err?.message || err}`);
    }
  }

  function fillFormFromExtraction(payload) {
    const race = payload?.race ?? {};
    const horses = Array.isArray(payload?.horses) ? payload.horses : [];

    const fields = {
      date: $('#raceDate'),
      track: $('#raceTrack'),
      surface: $('#raceSurface'),
      distance: $('#raceDistance'),
    };

    console.group('Detected form fields');
    console.log(fields);
    console.groupEnd();

    if (fields.date) fields.date.value = race.date ?? '';
    if (fields.track) fields.track.value = race.track ?? '';
    if (fields.surface) fields.surface.value = race.surface ?? '';
    if (fields.distance) fields.distance.value = race.distance ?? '';

    const list = $('#horseList');
    if (!list) {
      console.warn('No #horseList container found.');
      return;
    }
    list.innerHTML = ''; // clear previous entries

    horses.forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'horse-row flex items-center justify-between py-1';
      row.dataset.index = i.toString();

      // Build a small row. You can replace with inputs if needed.
      row.innerHTML = `
        <div class="truncate">${i + 1}. <strong>${h.name || ''}</strong></div>
        <div class="opacity-80">${h.odds || ''}</div>
        <div class="opacity-80">${h.jockey || ''}</div>
        <div class="opacity-80">${h.trainer || ''}</div>
      `;
      list.appendChild(row);
    });

    console.table(race);
    console.table(horses);
  }

  async function predictWPS() {
    setBadge('Predicting...');
    try {
      const body = collectCurrentFormAsJSON();
      const res = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      console.group('Predict WPS');
      console.log('Request:', body);
      console.log('Response:', data);
      console.groupEnd();

      if (!res.ok) {
        setBadge('Idle');
        return alert(`Predict error: ${data?.error || res.statusText}`);
      }

      alert(data?.msg || 'Prediction complete (stub).');
      setBadge('Idle');
    } catch (err) {
      console.error(err);
      setBadge('Idle');
      alert(`Predict error: ${err?.message || err}`);
    }
  }

  function collectCurrentFormAsJSON() {
    const horses = [];
    // If you later switch to editable rows, read from inputs.
    $$('#horseList .horse-row').forEach((row) => {
      const parts = row.textContent.split('|').map((s) => s.trim());
      // Simple shape; feel free to improve parsing.
      horses.push({ raw: row.textContent, parts });
    });

    return {
      race: {
        date: $('#raceDate')?.value || '',
        track: $('#raceTrack')?.value || '',
        surface: $('#raceSurface')?.value || '',
        distance: $('#raceDistance')?.value || '',
      },
      horses,
    };
  }

  // Boot once DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    attachHandlers();
    setBadge('Idle');
    console.info('FinishLine WPS AI: handlers attached');
  });
})();