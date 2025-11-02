import { setCors } from './_http.js';
import { readFileSync } from 'fs';
import { join } from 'path';

export const config = { runtime: 'nodejs' };

function json(res, status, data) {
  setCors(res);
  res.status(status).json(data);
}

// Load priors
let priors = null;
function getPriors() {
  if (priors) return priors;
  try {
    const priorsPath = join(process.cwd(), 'public', 'data', 'priors.json');
    const data = readFileSync(priorsPath, 'utf8');
    priors = JSON.parse(data);
    return priors;
  } catch (e) {
    console.warn('[predict_wps] Could not load priors.json, using defaults');
    priors = {
      jockey: {},
      trainer: {},
      default: { jockey: 0.12, trainer: 0.12 },
    };
    return priors;
  }
}

// Name normalization
function normName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(st|jr|sr|iii|ii)\b/g, '')
    .trim();
}

// Parse distance to miles
function parseDistance(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[^0-9/ .]/g, '').trim();
  if (!t) return null;

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

// Z-score helper
function zscore(x, mean, sd) {
  if (x == null || !isFinite(x) || sd === 0 || !isFinite(sd)) return 0;
  return (x - mean) / sd;
}

// Inverse rank (lower rank = higher value)
function rank(values, inverse = false) {
  const indexed = values.map((v, i) => ({ v: v == null ? -Infinity : v, i }));
  indexed.sort((a, b) => (inverse ? a.v - b.v : b.v - a.v));
  const ranks = new Array(values.length).fill(null);
  indexed.forEach((item, pos) => {
    ranks[item.i] = pos;
  });
  return ranks;
}

// Z-score of inverse rank
function zInvRank(values) {
  const ranks = rank(values, true); // lower rank (smaller value) = better for odds
  const rankMean = ranks.reduce((a, b) => a + (b == null ? 0 : b), 0) / ranks.length;
  const rankSd = Math.sqrt(ranks.reduce((a, b) => a + (b == null ? rankMean : (b - rankMean)) ** 2, 0) / ranks.length) || 1;
  return ranks.map(r => zscore(r, rankMean, rankSd));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? req.body : null;
    if (!body) return json(res, 400, { error: 'Empty body' });

    const features = body.features || {};
    const useDistance = body.useDistance !== false;
    const useSurface = body.useSurface !== false;
    const usePriors = body.usePriors !== false;

    if (!features || typeof features !== 'object' || Object.keys(features).length === 0) {
      return json(res, 400, { error: 'No features provided' });
    }

    // Convert features object to array
    const entries = Object.values(features);
    if (entries.length < 3) {
      return json(res, 400, { error: 'Need at least 3 horses' });
    }

    const priorsData = getPriors();

    // Build per-horse signal components
    const scoresA = []; // Odds model
    const scoresB = []; // Speed model
    const scoresC = []; // J/T priors
    const scoresD = []; // Distance/Surface fit

    // A) Odds model
    const implied = entries.map(e => e.implied ?? null);
    const oddsZInv = zInvRank(implied);
    entries.forEach((e, i) => {
      scoresA.push(oddsZInv[i] ?? 0);
    });

    // B) Speed model
    const speed = entries.map(e => e.speed ?? null);
    const speedValid = speed.filter(s => s != null);
    const speedMean = speedValid.length > 0 ? speedValid.reduce((a, b) => a + b, 0) / speedValid.length : 0;
    const speedSd = speedValid.length > 1
      ? Math.sqrt(speedValid.reduce((a, b) => a + (b - speedMean) ** 2, 0) / speedValid.length)
      : 1;
    entries.forEach((e, i) => {
      scoresB.push(zscore(e.speed ?? null, speedMean, speedSd));
    });

    // C) J/T priors
    entries.forEach((e) => {
      const jockeyNorm = normName(e.jockey || '');
      const trainerNorm = normName(e.trainer || '');
      const pj = priorsData.jockey[jockeyNorm] ?? priorsData.default.jockey;
      const pt = priorsData.trainer[trainerNorm] ?? priorsData.default.trainer;
      scoresC.push(0.5 * pj + 0.5 * pt);
    });

    // D) Distance/Surface fit
    const distAdj = useDistance && body.distance ? 0.05 : 0;
    const surfAdj = useSurface && body.surface ? 0.05 : 0;
    const scoreD = distAdj + surfAdj;
    entries.forEach(() => scoresD.push(scoreD));

    // Coverage-aware weights
    const hasA = scoresA.some(s => s !== 0);
    const hasB = scoresB.some(s => s !== 0);
    const hasC = usePriors && scoresC.some(s => s > 0);
    const hasD = useDistance || useSurface;

    const totalWeight = (hasA ? 0.35 : 0) + (hasB ? 0.35 : 0) + (hasC ? 0.20 : 0) + (hasD ? 0.10 : 0);

    if (totalWeight < 0.1) {
      return json(res, 400, {
        error: 'insufficient_features',
        reason: 'Not enough usable signals—try adding Speed/PP photo or enable priors.',
      });
    }

    // Normalize weights
    const wA = hasA ? 0.35 / totalWeight : 0;
    const wB = hasB ? 0.35 / totalWeight : 0;
    const wC = hasC ? 0.20 / totalWeight : 0;
    const wD = hasD ? 0.10 / totalWeight : 0;

    // Combine scores
    const finalScores = entries.map((e, i) => {
      return wA * scoresA[i] + wB * scoresB[i] + wC * scoresC[i] + wD * scoresD[i];
    });

    // Softmax with temperature
    const T = 0.35;
    const min = Math.min(...finalScores);
    const max = Math.max(...finalScores);
    const scaled = finalScores.map(s => (max === min ? 0.5 : (s - min) / (max - min)));
    const exps = scaled.map(s => Math.exp(s / T));
    const Z = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / Z);

    // Rank by probability
    const order = probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).map(o => o.i);

    const winIdx = order[0];
    const placeIdx = order[1];
    const showIdx = order[2];

    const winner = entries[winIdx];
    const place = entries[placeIdx];
    const show = entries[showIdx];

    // Confidence calculation
    const signalCount = (hasA ? 1 : 0) + (hasB ? 1 : 0) + (hasC ? 1 : 0) + (hasD ? 1 : 0);
    const coverage = signalCount / (4 * entries.length);
    const medianProb = [...probs].sort((a, b) => a - b)[Math.floor(probs.length / 2)];
    const consensus = probs[winIdx] - medianProb > 0 ? (probs[winIdx] - medianProb) / probs[winIdx] : 0;
    const confidence = Math.round(100 * (0.5 * coverage + 0.5 * consensus));

    // Compute factor deltas for winner
    const meanA = scoresA.reduce((a, b) => a + b, 0) / scoresA.length;
    const meanB = scoresB.reduce((a, b) => a + b, 0) / scoresB.length;
    const meanC = scoresC.reduce((a, b) => a + b, 0) / scoresC.length;
    const meanD = scoresD[0] || 0;

    const winnerDeltas = {
      'odds rank inv': scoresA[winIdx] - meanA,
      'odds imp': (entries[winIdx].implied ?? 0) - (implied.reduce((a, b) => a + (b ?? 0), 0) / implied.length),
      'speedFig z': scoresB[winIdx] - meanB,
      'speedFig rank inv': 0, // TODO: implement if needed
      'jockey prior': scoresC[winIdx] - meanC,
      'trainer prior': scoresC[winIdx] - meanC, // Combined in scoreC
      'dist adj': scoresD[winIdx] - meanD,
      'surface adj': scoresD[winIdx] - meanD, // Combined in scoreD
    };

    const reasons = Object.entries(winnerDeltas)
      .filter(([k, v]) => Math.abs(v) >= 0.15)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 5)
      .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`);

    return json(res, 200, {
      win: winner.name,
      place: place.name,
      show: show.name,
      predictions: {
        win: { name: winner.name, odds: winner.odds || null },
        place: { name: place.name, odds: place.odds || null },
        show: { name: show.name, odds: show.odds || null },
      },
      horses: entries.map((e, i) => ({
        name: e.name,
        horse: e.name,
        odds: e.odds,
        speedFig: e.speed,
        prob: Math.round(probs[i] * 1000) / 10,
      })),
      reasons: { [winner.name]: reasons },
      confidence: Math.max(3, Math.min(99, confidence)),
    });
  } catch (err) {
    console.error('[predict_wps] Error:', err);
    console.error('[predict_wps] Stack:', err?.stack);
    return json(res, 500, { error: 'Prediction failure', detail: String(err?.message || err) });
  }
}
