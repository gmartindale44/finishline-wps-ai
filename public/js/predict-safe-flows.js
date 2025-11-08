import { predictWPS } from './predictor.js';

function normalizeFallback(parsed = {}) {
  const horses = Array.isArray(parsed.horses) ? parsed.horses : [];
  const meta = parsed.meta || {};
  const payload = parsed.payload || {};
  return { horses, meta, payload, features: parsed.features || {}, horsesForDisplay: parsed.horsesForDisplay || horses };
}

export const SafeFlows = {
  async analyze({ useApi = false, fallback } = {}) {
    const fallbackParsed = normalizeFallback(fallback);
    if (useApi) {
      try {
        const res = await fetch('/api/analyze', { method: 'POST' });
        if (!res.ok) throw new Error(`analyze http ${res.status}`);
        const data = await res.json();
        return normalizeFallback(data);
      } catch (err) {
        console.warn('[SafeFlows] analyze API failed, using fallback:', err);
      }
    }

    if (window.FL_DOM_PARSER?.parse) {
      try {
        const parsed = window.FL_DOM_PARSER.parse();
        if (parsed) return normalizeFallback(parsed);
      } catch (err) {
        console.warn('[SafeFlows] DOM parser failed:', err);
      }
    }

    return fallbackParsed;
  },

  async predict(parsed) {
    if (!parsed || !parsed.payload) {
      throw new Error('SafeFlows.predict requires parsed payload');
    }
    const res = await fetch('/api/predict_wps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.payload),
    });
    if (!res.ok) {
      throw new Error(`predict http ${res.status}`);
    }
    return await res.json();
  },

  async predictClientOnly(parsed) {
    const fallback = normalizeFallback(parsed);
    const horses = fallback.horses || [];
    if (horses.length < 3) {
      return {
        picks: [],
        confidence: 0.5,
        top3_mass: 0.45,
        tickets: null,
        strategy: null,
        reasons: {},
      };
    }

    try {
      const ctx = fallback.meta || {};
      const heur = predictWPS(horses, ctx);
      const toName = (idx) => horses[idx]?.name || `Runner ${idx + 1}`;
      const winIdx = heur.picks.win.idx;
      const placeIdx = heur.picks.place.idx;
      const showIdx = heur.picks.show.idx;
      const probs = heur.probs || [];
      const confidence = probs[winIdx] || 0.66;
      const top3Mass = probs.slice(0, 3).reduce((acc, p) => acc + p, 0);

      const reasons = {};
      if (heur.reasons) {
        const winnerName = toName(winIdx);
        reasons[winnerName] = heur.reasons[winnerName] || heur.reasons[winnerName?.toLowerCase?.()] || [];
      }

      return {
        picks: [
          { slot: 'Win', name: toName(winIdx) },
          { slot: 'Place', name: toName(placeIdx) },
          { slot: 'Show', name: toName(showIdx) },
        ],
        confidence,
        top3_mass: top3Mass,
        tickets: null,
        strategy: null,
        reasons,
      };
    } catch (err) {
      console.warn('[SafeFlows] predictClientOnly fallback failed:', err);
      return {
        picks: [],
        confidence: 0.5,
        top3_mass: 0.45,
        tickets: null,
        strategy: null,
        reasons: {},
      };
    }
  },

  async loadCalibration() {
    try {
      const res = await fetch('/data/calibration_v1.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`calibration http ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[SafeFlows] calibration load failed:', err);
      return { version: 'fallback', policy: {}, bin_metrics: [] };
    }
  },
};

if (typeof window !== 'undefined') {
  window.SafeFlows = SafeFlows;
}


