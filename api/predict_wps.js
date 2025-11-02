/* eslint-disable */
import { setCors } from './_http.js';

export const config = { runtime: 'nodejs' };

// Parse fractional or hyphen odds like "9/5", "5-2", "2/1", "EVEN", "1-1"
function parseOdds(raw) {
  if (!raw) return null;
  const t = String(raw).trim().toUpperCase();
  if (t === 'EVEN' || t === 'EVENS' || t === 'EV' || t === '1/1' || t === '1-1') {
    return 1; // 1/1
  }
  // support "A/B" or "A-B"
  const m = t.match(/^(\d+)\s*[/\-]\s*(\d+)$/);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!isFinite(num) || !isFinite(den) || den === 0) return null;
  return num / den; // e.g., 5/2 => 2.5
}

// Convert odds (o = num/den) to implied probability with calibration.
// Baseline p = 1/(o+1). Bookmaker bias favors favorites; we temper with gamma in (0,1).
function impliedProb(oddsRatio, gamma = 0.72) {
  const p = 1 / (oddsRatio + 1);
  // calibration: soften favorites a bit; boost mid-shots slightly
  return Math.pow(p, gamma);
}

// Rank horses by calibrated probability; pick W/P/S with safeguards.
function pickWPS(entries, options = {}) {
  const {
    minShowOddsRatio = 20,   // >20/1 excluded from P/S shortlist
    minPlaceOddsRatio = 12,  // >12/1 excluded from Place shortlist
    gamma = 0.72,
  } = options;

  // Build items with parsed odds + calibrated probs
  const items = entries
    .map((e, idx) => {
      const o = parseOdds(e.odds);
      const oValid = o !== null ? o : 20; // assume 20/1 if missing/unreadable
      const ip = impliedProb(oValid, gamma);
      return {
        idx,
        horse: e.horse,
        jockey: e.jockey || '',
        trainer: e.trainer || '',
        odds: e.odds,
        oddsRatio: oValid,
        ip,
      };
    });

  // Normalize probabilities to sum to 1 (post-calibration)
  const sum = items.reduce((a, b) => a + b.ip, 0) || 1;
  items.forEach(i => { i.pn = i.ip / sum; });

  // Sort best → worst by pn
  items.sort((a, b) => b.pn - a.pn);

  // Win = top
  const win = items[0];

  // Place shortlist: not the winner, reasonable odds (exclude extreme longshots)
  const placeCandidates = items.filter(i => i.idx !== win.idx && i.oddsRatio <= minPlaceOddsRatio);
  const place = (placeCandidates[0] || items[1] || win);

  // Show shortlist: exclude win & place, and filter very long shots
  const showCandidates = items.filter(i => i.idx !== win.idx && i.idx !== place.idx && i.oddsRatio <= minShowOddsRatio);
  const show = (showCandidates[0] || items.find(i => i.idx !== win.idx && i.idx !== place.idx) || items[2] || place);

  // Confidence: blend of winner prob and field dilution.
  // Intuition: confidence drops with large fields & close pn values.
  const fieldSize = Math.max(3, entries.length);
  const margin = Math.max(0, win.pn - (items[1]?.pn ?? 0));
  const base = win.pn;                       // ~0.2–0.6 typical
  const dilution = 1 / Math.sqrt(fieldSize); // 0.3 for ~11 horses
  const conf = Math.max(0.03, Math.min(0.99, (base * 0.75 + margin * 0.25) * 0.9 * dilution));

  return {
    win: { horse: win.horse, odds: win.odds },
    place: { horse: place.horse, odds: place.odds },
    show: { horse: show.horse, odds: show.odds },
    confidence: Math.round(conf * 100),
  };
}

function json(res, status, data) {
  setCors(res);
  res.status(status).json(data);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? req.body : null;
    if (!body || !Array.isArray(body.horses) || body.horses.length < 3) {
      return json(res, 400, { error: 'Need at least 3 horses to predict' });
    }

    // entries: [{horse, jockey, trainer, odds}]
    // Handle both {horse, ...} and {name, ...} formats
    const entries = body.horses.map(h => ({
      horse: (h.horse || h.name || '').trim(),
      jockey: (h.jockey || '').trim(),
      trainer: (h.trainer || '').trim(),
      odds: (h.odds || '').trim(),
    })).filter(e => e.horse && e.horse.length > 1);

    if (entries.length < 3) {
      return json(res, 400, { error: 'Need at least 3 valid horses (with name and odds)' });
    }

    // Always run deep (no accuracy dropdown)
    const result = pickWPS(entries, {
      gamma: 0.72,
      minPlaceOddsRatio: 12,
      minShowOddsRatio: 20,
    });

    return json(res, 200, {
      win: result.win.horse,
      place: result.place.horse,
      show: result.show.horse,
      predictions: {
        win: { name: result.win.horse, odds: result.win.odds || null },
        place: { name: result.place.horse, odds: result.place.odds || null },
        show: { name: result.show.horse, odds: result.show.odds || null },
      },
      confidence: result.confidence, // 3–99
    });
  } catch (err) {
    console.error('[predict_wps] Error:', err);
    return json(res, 500, { error: 'Prediction failure', detail: String(err && err.message || err) });
  }
}
