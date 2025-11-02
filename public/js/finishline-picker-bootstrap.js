(function () {
  const state = (window.__fl_state = window.__fl_state || {
    pickedFiles: [],
    analyzed: false,
    parsedHorses: [],
  });

  function qAnalyze() {
    return document.querySelector('[data-fl-analyze]') || document.getElementById('analyze-btn') || document.querySelector('button.analyze');
  }

  function qPredict() {
    return document.querySelector('[data-fl-predict]') || document.getElementById('predict-btn') || document.querySelector('button.predict');
  }

  function enable(el, on = true) {
    if (!el) return;
    el.disabled = !on;
    el.classList.toggle('disabled', !on);
    el.setAttribute('aria-disabled', String(!on));
  }

  async function toB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function onAnalyze() {
    const analyzeBtn = qAnalyze();
    const predictBtn = qPredict();

    if (!state.pickedFiles || state.pickedFiles.length === 0) {
      alert('Please choose at least one image or PDF first.');
      return;
    }

    enable(analyzeBtn, false);

    try {
      const images = await Promise.all(state.pickedFiles.map(toB64));

      const r = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      });

      if (!r.ok) throw new Error(`OCR failed: ${r.status}`);

      const data = await r.json();

      state.parsedHorses = Array.isArray(data.horses) ? data.horses : [];
      state.analyzed = state.parsedHorses.length > 0;

      enable(predictBtn, state.analyzed);

      alert(
        state.analyzed
          ? `Analysis complete — ${state.parsedHorses.length} entries parsed and ready.`
          : 'No horses parsed from the file.'
      );
    } catch (e) {
      console.error(e);
      alert('OCR failed');
    } finally {
      enable(analyzeBtn, true);
    }
  }

  async function onPredict() {
    const predictBtn = qPredict();

    if (!state.analyzed || !state.parsedHorses.length) {
      alert('Please analyze first.');
      return;
    }

    enable(predictBtn, false);

    try {
      const r = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          horses: state.parsedHorses,
          // Optionally include meta if your form collects these:
          // meta: { track, surface, distance, date }
        }),
      });

      const data = await r.json();

      if (!r.ok) throw new Error(data?.error || `Predict failed: ${r.status}`);

      alert(
        data?.message ||
          `Predictions ready.\nWin: ${data?.win}\nPlace: ${data?.place}\nShow: ${data?.show}\nConfidence: ${data?.confidence ?? '—'}`
      );
    } catch (e) {
      console.error(e);
      alert(`Predict failed: ${e.message}`);
    } finally {
      enable(predictBtn, true);
    }
  }

  const analyzeBtn = qAnalyze();
  const predictBtn = qPredict();

  if (analyzeBtn) analyzeBtn.addEventListener('click', onAnalyze);
  if (predictBtn) predictBtn.addEventListener('click', onPredict);
})();
