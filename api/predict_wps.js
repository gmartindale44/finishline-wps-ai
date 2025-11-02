/* eslint-disable */
import { setCors } from './_http.js';

export const config = { runtime: 'nodejs' };

// Parse distance string to miles (e.g., "1 1/4 miles" -> 1.25)
function parseDistanceMiles(distanceStr) {
  if (!distanceStr || typeof distanceStr !== 'string') return null;
  const s = distanceStr.trim().toLowerCase();
  
  // Handle fractional miles: "1 1/4 miles" or "1.25 miles"
  const fracMatch = s.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)\s*miles?/);
  if (fracMatch) {
    const whole = Number(fracMatch[1]);
    const num = Number(fracMatch[2]);
    const den = Number(fracMatch[3]);
    if (den > 0) return whole + (num / den);
  }
  
  // Handle decimal: "1.25 miles"
  const decMatch = s.match(/(\d+\.?\d*)\s*miles?/);
  if (decMatch) return Number(decMatch[1]);
  
  // Handle furlongs: "6f" or "6 furlongs" (1 furlong = 1/8 mile)
  const furlongMatch = s.match(/(\d+\.?\d*)\s*f/);
  if (furlongMatch) return Number(furlongMatch[1]) / 8;
  
  return null;
}

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
    
    // Accept either {horses, meta} or {entries, notes, meta} format
    const entries = (body?.entries || body?.horses || []).map(h => ({
      horse: (h.horse || h.name || '').trim(),
      jockey: (h.jockey || '').trim(),
      trainer: (h.trainer || '').trim(),
      odds: (h.odds || '').trim(),
      speedFig: typeof h.speedFig === 'number' ? h.speedFig : (h.speedFig ? Number(h.speedFig) : null),
    })).filter(e => e.horse && e.horse.length > 1);

    if (entries.length < 3) {
      return json(res, 400, { error: 'Need at least 3 valid horses (with name and odds)' });
    }

    // Build context from meta
    const meta = body.meta || {};
    const distanceMiles = parseDistanceMiles(meta.distance);
    const ctx = {
      track: meta.track || '',
      surface: meta.surface || '',
      distanceMiles,
    };

    // Import and use new predictor (client-side will also use it, but we compute server-side for consistency)
    // For now, use enhanced pickWPS logic that considers speed figures
    const result = pickWPSEnhanced(entries, ctx);

    return json(res, 200, {
      win: result.win.horse,
      place: result.place.horse,
      show: result.show.horse,
      predictions: {
        win: { name: result.win.horse, odds: result.win.odds || null, speedFig: result.win.speedFig || null },
        place: { name: result.place.horse, odds: result.place.odds || null, speedFig: result.place.speedFig || null },
        show: { name: result.show.horse, odds: result.show.odds || null, speedFig: result.show.speedFig || null },
      },
      horses: entries.map((e, i) => ({
        horse: e.horse,
        odds: e.odds,
        speedFig: e.speedFig,
        prob: result.probs?.[i] || null,
      })),
      reasons: result.reasons || {},
      confidence: result.confidence, // 3–99
    });
  } catch (err) {
    console.error('[predict_wps] Error:', err);
    return json(res, 500, { error: 'Prediction failure', detail: String(err && err.message || err) });
  }
}

// Enhanced pickWPS that considers speed figures and context (simplified version of predictor.js logic)
function pickWPSEnhanced(entries, ctx) {
  // Simple feature-based scoring (matching client-side predictor.js logic)
  const speed = entries.map(e => e.speedFig ?? null);
  const speedValid = speed.filter(n => n != null);
  const speedMean = speedValid.length > 0 ? speedValid.reduce((a, b) => a + b, 0) / speedValid.length : 0;
  const speedSd = speedValid.length > 1
    ? Math.sqrt(speedValid.reduce((a, b) => a + (b - speedMean) ** 2, 0) / speedValid.length)
    : 1;

  const oddsImp = entries.map(e => {
    const o = parseOdds(e.odds);
    if (o === null) return null;
    return 1 / (o + 1);
  });
  const oddsValid = oddsImp.filter(n => n != null);
  const oddsMean = oddsValid.length > 0 ? oddsValid.reduce((a, b) => a + b, 0) / oddsValid.length : 0.5;
  const oddsSd = oddsValid.length > 1
    ? Math.sqrt(oddsValid.reduce((a, b) => a + (b - oddsMean) ** 2, 0) / oddsValid.length)
    : 0.1;

  const distAdj = ctx.distanceMiles != null
    ? (ctx.distanceMiles < 0.5 || ctx.distanceMiles > 1.5 ? -0.1 : 0.05)
    : 0;

  // Build scores
  const scores = entries.map((e, i) => {
    const speedZ = speedSd > 0 ? ((e.speedFig ?? speedMean) - speedMean) / speedSd : 0;
    const oddsImpVal = oddsImp[i] ?? oddsMean;
    const oddsZ = oddsSd > 0 ? (oddsImpVal - oddsMean) / oddsSd : 0;
    
    // Weighted blend
    const score = (speedZ * 0.55) + (-oddsZ * 0.12) + (distAdj * 0.03);
    return score;
  });

  // Calibrate to probabilities
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const scaled = scores.map(s => (max === min ? 0.5 : (s - min) / (max - min)));
  const T = 0.85;
  const exps = scaled.map(s => Math.exp(s / T));
  const Z = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / Z);

  // Rank by probability
  const order = probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).map(o => o.i);

  const winIdx = order[0];
  const placeIdx = order[1];
  const showIdx = order[2];

  // Reasons for winner
  const winnerFeat = {
    'speed fig z': speedSd > 0 ? ((entries[winIdx].speedFig ?? speedMean) - speedMean) / speedSd : 0,
    'odds rank': -oddsZ,
    'distance fit': distAdj,
  };
  const contribs = Object.entries(winnerFeat)
    .filter(([k, v]) => Math.abs(v) > 0.01)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(o => o[0]);

  const confidence = Math.max(3, Math.min(99, Math.round(probs[winIdx] * 100)));

  return {
    win: { horse: entries[winIdx].horse, odds: entries[winIdx].odds, speedFig: entries[winIdx].speedFig },
    place: { horse: entries[placeIdx].horse, odds: entries[placeIdx].odds, speedFig: entries[placeIdx].speedFig },
    show: { horse: entries[showIdx].horse, odds: entries[showIdx].odds, speedFig: entries[showIdx].speedFig },
    probs,
    reasons: { [entries[winIdx].horse]: contribs },
    confidence,
  };
}
