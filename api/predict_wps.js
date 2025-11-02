import { setCors } from './_http.js';

export const config = { runtime: 'nodejs' };

function json(res, status, data) {
  setCors(res);
  res.status(status).json(data);
}

// Port of features.js functions (server-side)
function stdOdds(oddsRaw) {
  if (!oddsRaw) return null;
  const frac = String(oddsRaw).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2] || 1);
    const dec = a / b;
    return 1 / (dec + 1);
  }
  const num = Number(oddsRaw);
  if (!isFinite(num) || num <= 0) return null;
  return 1 / (num + 1);
}

function zscore(x, mean, sd) {
  if (x == null || !isFinite(x) || sd === 0) return 0;
  return (x - mean) / sd;
}

function rank(values) {
  const idx = values
    .map((v, i) => ({ v: v == null ? -Infinity : v, i }))
    .sort((a, b) => b.v - a.v)
    .map((o, rank) => ({ i: o.i, rank }));
  const out = Array(values.length).fill(null);
  idx.forEach(({ i, rank: r }) => (out[i] = r));
  return out;
}

function buildFeatureVector(entries, ctx) {
  const speed = entries.map(e => e.speedFig ?? null);
  const speedValid = speed.filter(n => n != null);
  const speedMean = speedValid.length > 0 ? speedValid.reduce((a, b) => a + b, 0) / speedValid.length : 0;
  const speedSd = speedValid.length > 1
    ? Math.sqrt(speedValid.reduce((a, b) => a + (b - speedMean) ** 2, 0) / speedValid.length)
    : 1;

  const speedRk = rank(speed.map(v => v == null ? -9999 : v));

  const oddsImp = entries.map(e => stdOdds(e.odds));
  const oddsValid = oddsImp.filter(n => n != null);
  const oddsMean = oddsValid.length > 0 ? oddsValid.reduce((a, b) => a + b, 0) / oddsValid.length : 0.5;
  const oddsSd = oddsValid.length > 1
    ? Math.sqrt(oddsValid.reduce((a, b) => a + (b - oddsMean) ** 2, 0) / oddsValid.length)
    : 0.1;

  const oddsRk = rank(oddsImp.map(v => v == null ? -9999 : -v));

  const distPenalty = (d) => {
    if (!isFinite(d)) return 0;
    if (d < 0.5) return -0.1;
    if (d > 1.5) return -0.1;
    return 0.05;
  };
  const distAdj = distPenalty(ctx?.distanceMiles ?? NaN);

  return entries.map((e, i) => ({
    speedFig_z: zscore(e.speedFig ?? null, speedMean, speedSd),
    speedFig_rank_inv: -(speedRk[i] ?? 99),
    odds_imp: oddsImp[i] ?? null,
    odds_rank_inv: -(oddsRk[i] ?? 99),
    dist_adj: distAdj,
  }));
}

function heuristicScore(feat) {
  const w = {
    speedFig_z: 0.55,
    speedFig_rank_inv: 0.25,
    odds_rank_inv: 0.12,
    odds_imp: 0.05,
    dist_adj: 0.03,
  };
  const sum = Object.entries(w).reduce((acc, [k, wv]) => acc + (feat[k] ?? 0) * wv, 0);
  return sum;
}

function calibrateProbs(scores) {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const scaled = scores.map(s => (max === min ? 0.5 : (s - min) / (max - min)));
  const T = 0.85;
  const exps = scaled.map(s => Math.exp(s / T));
  const Z = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / Z);
}

// Port of predictor.js predictWPS function
function predictWPS(entries, ctx) {
  const feats = buildFeatureVector(entries, ctx);
  const scores = feats.map(heuristicScore);
  const probs = calibrateProbs(scores);

  const order = probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).map(o => o.i);
  const picks = {
    win: { idx: order[0], prob: probs[order[0]] },
    place: { idx: order[1], prob: probs[order[1]] },
    show: { idx: order[2], prob: probs[order[2]] },
  };

  const winnerFeat = feats[picks.win.idx];
  const contribs = Object.entries(winnerFeat)
    .map(([k, v]) => ({ k, v: v || 0 }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 3)
    .map(o => o.k.replace(/_/g, ' '));

  return { picks, probs, reasons: { [entries[picks.win.idx].horse]: contribs } };
}

function parseDistance(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[^0-9/ .]/g, '').trim();
  if (!t) return null;

  // examples: "1 1/4" -> 1.25
  const parts = t.split(' ');
  let total = 0;
  for (const p of parts) {
    if (p.includes('/')) {
      const [a, b] = p.split('/');
      const f = parseFloat(a) / parseFloat(b || 1);
      if (isFinite(f)) total += f;
    } else {
      const n = parseFloat(p);
      if (isFinite(n)) total += n;
    }
  }
  return isFinite(total) && total > 0 ? total : null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? req.body : null;
    if (!body) return json(res, 400, { error: 'Empty body' });

    // Accept either "entries" or "horses"
    const entries = body.entries || body.horses || [];
    if (!Array.isArray(entries) || entries.length < 3) {
      return json(res, 400, { error: 'Need at least 3 valid entries' });
    }

    const meta = body.meta || {};
    const ctx = {
      track: meta.track || null,
      surface: meta.surface || null,
      distanceMiles: parseDistance(meta.distance || meta.distanceMiles),
    };

    // Sanitize entries for nulls
    const cleaned = entries.map(e => ({
      horse: String(e?.horse || e?.name || '').trim(),
      jockey: String(e?.jockey || '').trim(),
      trainer: String(e?.trainer || '').trim(),
      odds: String(e?.odds || '').trim(),
      speedFig: isFinite(Number(e?.speedFig)) ? Number(e.speedFig) : null,
    })).filter(e => e.horse && e.horse.length > 1);

    if (cleaned.length < 3) {
      return json(res, 400, { error: 'Need at least 3 valid horses (with name and odds)' });
    }

    console.log('[predict_wps] Analyzing with Deep Consensus v2', { entriesCount: cleaned.length, ctx });

    // Run predictor
    const result = predictWPS(cleaned, ctx);
    if (!result || !result.picks) {
      console.error('[predict_wps] Predictor returned no result', result);
      return json(res, 500, { error: 'Predictor returned no result' });
    }

    const { picks, probs, reasons } = result;
    const horsesOut = cleaned.map((h, i) => ({
      horse: h.horse,
      odds: h.odds,
      speedFig: h.speedFig,
      prob: Math.round((probs[i] || 0) * 1000) / 10,
    }));

    const winner = cleaned[picks.win.idx];
    const confidence = Math.max(3, Math.min(99, Math.round((picks.win.prob || 0) * 100)));

    return json(res, 200, {
      win: winner.horse,
      place: cleaned[picks.place.idx].horse,
      show: cleaned[picks.show.idx].horse,
      predictions: {
        win: { name: winner.horse, odds: winner.odds },
        place: { name: cleaned[picks.place.idx].horse, odds: cleaned[picks.place.idx].odds },
        show: { name: cleaned[picks.show.idx].horse, odds: cleaned[picks.show.idx].odds },
      },
      horses: horsesOut,
      reasons,
      confidence,
    });
  } catch (err) {
    console.error('[predict_wps] Error:', err);
    console.error('[predict_wps] Stack:', err?.stack);
    return json(res, 500, { error: 'Prediction failure', detail: String(err?.message || err) });
  }
}
