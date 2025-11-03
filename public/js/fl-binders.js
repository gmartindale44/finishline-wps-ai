/* eslint-disable no-console */

(function () {
  const TAG = '[FL binders]';
  const log = (...a) => console.log(TAG, ...a);

  // GLOBAL STATE
  window.FLState = window.FLState || {
    phase: 'idle',   // idle | analyzing | ready | predicting
    parsed: false,
    picks: null,
    lastPayload: null,
  };

  // Helpers
  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  function findAnalyzeBtn() {
    return qs('[data-action="fl-analyze"]') ||
           qsa('button,[role="button"]').find(b => (b.innerText||'').toLowerCase().includes('analyze'));
  }
  
  function findPredictBtn() {
    return qs('[data-action="predict-wps"]') ||
           qsa('button,[role="button"]').find(b => (b.innerText||'').toLowerCase().includes('predict w/p/s'));
  }
  
  function disable(el, v) {
    if (!el) return;
    if (v) { 
      el.setAttribute('disabled','true'); 
      el.classList.add('is-disabled'); 
    } else { 
      el.removeAttribute('disabled'); 
      el.classList.remove('is-disabled'); 
    }
  }

  // --- Fallback extract of horses/odds from the grid ---
  function readGridTop3() {
    // Try common row containers; adapt if your app uses another selector
    const rows = qsa('[data-row], .horse-row, .grid [role="row"], .grid .row, .horse-grid .row');
    const items = rows.map(r => {
      const txt = (r.innerText||'').trim().replace(/\s+/g,' ');
      // crude odds capture: e.g., "7/2", "3/1", "15/1"
      const mOdds = txt.match(/(\d+)\s*\/\s*(\d+)/);
      const odds = mOdds ? (parseInt(mOdds[1],10)/parseInt(mOdds[2],10)) : Number.POSITIVE_INFINITY;
      const name = txt.split('  ')[0] || txt.split(' - ')[0] || txt.split('\n')[0] || txt;
      return { name: name.trim(), oddsStr: mOdds ? mOdds[0] : null, odds };
    }).filter(x => x.name);
    if (!items.length) return null;
    items.sort((a,b) => a.odds - b.odds);
    return items.slice(0,3).map((it, i) => ({ rank: i+1, name: it.name, odds: it.oddsStr }));
  }

  // --- Analyze pipeline (real analyzer → fallback) ---
  async function doAnalyze() {
    const btnA = findAnalyzeBtn();
    try {
      window.FLState.phase = 'analyzing';
      disable(btnA, true);

      // If your app has a real analyzer, call it first:
      if (typeof window.FLRunAnalyze === 'function') {
        const picks = await Promise.resolve(window.FLRunAnalyze()).catch(()=>null);
        if (Array.isArray(picks) && picks.length >= 3) {
          window.FLState.picks = picks.slice(0,3);
          window.FLState.parsed = true;
          window.FLState.phase = 'ready';
          document.dispatchEvent(new CustomEvent('fl:parsed', { detail: { picks: window.FLState.picks }}));
          return true;
        }
      }

      // Fallback: parse from the visible grid
      const top3 = readGridTop3();
      if (!top3 || top3.length < 3) throw new Error('Could not parse horses/odds from grid.');
      window.FLState.picks = top3;
      window.FLState.parsed = true;
      window.FLState.phase = 'ready';
      document.dispatchEvent(new CustomEvent('fl:parsed', { detail: { picks: top3 }}));
      log('Analyze fallback picks:', top3);
      return true;
    } catch (e) {
      console.error(TAG, 'Analyze failed', e);
      window.FLState.phase = 'idle';
      alert('Analyze failed: ' + e.message);
      return false;
    } finally {
      disable(btnA, false);
    }
  }

  // --- Predict pipeline (calls API; uses Strategy/Exotics fallbacks already in place) ---
  async function doPredict() {
    const btnP = findPredictBtn();
    try {
      disable(btnP, true);
      window.FLState.phase = 'predicting';

      // If no picks yet, try to analyze first
      if (!window.FLState.parsed || !Array.isArray(window.FLState.picks) || window.FLState.picks.length < 3) {
        const ok = await doAnalyze();
        if (!ok) throw new Error('Analyze did not complete.');
      }

      const payload = {
        picks: window.FLState.picks.slice(0,3),
        meta: { source: 'binder', ts: Date.now() }
      };
      window.FLState.lastPayload = payload;

      const res = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      // Strategy/exotics fallbacks already handled by results renderer from previous patch
      if (window.FLResults && typeof window.FLResults.show === 'function') {
        window.FLResults.show(data);
      } else {
        console.warn(TAG, 'Renderer missing; data:', data);
        alert('Predictions computed, but the renderer is unavailable. See console.');
      }

      window.FLState.phase = 'ready';
    } catch (e) {
      console.error(TAG, 'Predict failed', e);
      window.FLState.phase = 'ready';
      alert('Predict failed: ' + e.message);
    } finally {
      disable(btnP, false);
    }
  }

  // --- binders (robust; rebind on DOM changes) ---
  function bind() {
    const a = findAnalyzeBtn();
    if (a && !a.__flBound) {
      a.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); doAnalyze(); }, true);
      a.__flBound = true;
      log('Analyze bound');
    }
    const p = findPredictBtn();
    if (p && !p.__flBound) {
      p.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); doPredict(); }, true);
      p.__flBound = true;
      log('Predict bound');
    }
  }

  new MutationObserver(() => bind()).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', bind);
  bind();
})();

