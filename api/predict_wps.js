import { parseMlOdds } from './_utils/odds.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function softmax(xs) {
  const m = Math.max(...xs);
  const ex = xs.map(v => Math.exp(v - m));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map(v => v / sum);
}

function randn() {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch (err) { return res.status(400).json({ error: 'Invalid JSON' }); }
    }

    const { horses, meta } = body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: 'No horses provided' });
    }

    // Default weights
    const w1 = 1.0, w2 = 0.55, w3 = 0.15;

    // Process horses: normalize fields
    const processed = horses.map(h => ({
      name: String(h?.name || '').trim(),
      oddsML: String(h?.oddsML || h?.odds || '').trim() || null,
      oddsNum: h?.oddsNum ?? (h?.oddsML || h?.odds ? parseMlOdds(String(h?.oddsML || h?.odds)) : null),
      jockey: String(h?.jockey || '').trim() || null,
      trainer: String(h?.trainer || '').trim() || null,
      speedFig: h?.speedFig ?? null,
    })).filter(h => h.name);

    if (processed.length === 0) {
      return res.status(400).json({ error: 'No valid horses after processing' });
    }

    // Compute median speed figure
    const speedFigs = processed.map(h => h.speedFig).filter(x => x !== null);
    const medianSpeed = speedFigs.length > 0
      ? speedFigs.sort((a, b) => a - b)[Math.floor(speedFigs.length / 2)]
      : 100; // fallback median

    // Count name frequencies for popularity boost
    const jockeyCounts = {};
    const trainerCounts = {};
    processed.forEach(h => {
      if (h.jockey) jockeyCounts[h.jockey] = (jockeyCounts[h.jockey] || 0) + 1;
      if (h.trainer) trainerCounts[h.trainer] = (trainerCounts[h.trainer] || 0) + 1;
    });
    const maxJockeyCount = Math.max(...Object.values(jockeyCounts), 1);
    const maxTrainerCount = Math.max(...Object.values(trainerCounts), 1);

    // Compute features
    let hasValidOdds = false;
    const features = processed.map(h => {
      const f_odds = h.oddsNum ? (1 / h.oddsNum) : 0.04;
      if (h.oddsNum) hasValidOdds = true;
      
      const f_speed = h.speedFig ? (h.speedFig - medianSpeed) / 25 : 0;
      
      const jockeyFreq = h.jockey ? (jockeyCounts[h.jockey] || 0) / maxJockeyCount : 0;
      const trainerFreq = h.trainer ? (trainerCounts[h.trainer] || 0) / maxTrainerCount : 0;
      const f_popName = (jockeyFreq + trainerFreq) / 2;

      const rawScore = w1 * f_odds + w2 * f_speed + w3 * f_popName;
      
      return {
        name: h.name,
        rawScore,
        f_odds,
        f_speed,
        f_popName,
      };
    });

    // If no valid odds, add tiny random offsets so softmax still works
    if (!hasValidOdds) {
      features.forEach((f, i) => {
        f.rawScore += (Math.random() - 0.5) * 0.01;
      });
    }

    // Convert to probabilities via softmax
    const scores = features.map(f => f.rawScore);
    const probs = softmax(scores);

    // Monte Carlo: 10,000 iterations
    const TRIALS = 10000;
    const winCounts = new Array(processed.length).fill(0);
    const placeCounts = new Array(processed.length).fill(0);
    const showCounts = new Array(processed.length).fill(0);

    for (let t = 0; t < TRIALS; t++) {
      // Sample latent scores with noise
      const latent = scores.map(s => s + randn() * 0.18);
      // Rank by latent scores
      const ranked = latent
        .map((score, idx) => ({ idx, score }))
        .sort((a, b) => b.score - a.score)
        .map((r, rank) => ({ idx: r.idx, rank }));

      // Count wins (rank 0)
      ranked.filter(r => r.rank === 0).forEach(r => winCounts[r.idx]++);
      // Count places (rank <= 1)
      ranked.filter(r => r.rank <= 1).forEach(r => placeCounts[r.idx]++);
      // Count shows (rank <= 2)
      ranked.filter(r => r.rank <= 2).forEach(r => showCounts[r.idx]++);
    }

    // Convert counts to percentages
    const probsWithPcts = processed.map((h, idx) => ({
      name: h.name,
      winPct: (winCounts[idx] / TRIALS) * 100,
      plcPct: (placeCounts[idx] / TRIALS) * 100,
      shwPct: (showCounts[idx] / TRIALS) * 100,
      rawScore: features[idx].rawScore,
    }));

    // Sort by win probability for picks
    const sorted = [...probsWithPcts].sort((a, b) => b.winPct - a.winPct);
    
    const picks = {
      win: sorted[0]?.name || null,
      place: sorted[1]?.name || null,
      show: sorted[2]?.name || null,
      top3: sorted.slice(0, 3).map(h => h.name).filter(Boolean),
    };

    // Confidence: mean of winPct/plcPct/shwPct for picked horses
    const winP = sorted[0]?.winPct || 0;
    const plcP = sorted[1]?.plcPct || 0;
    const shwP = sorted[2]?.shwPct || 0;
    const confidence = (winP + plcP + shwP) / 300;

    const usedSpeed = speedFigs.length > 0;

    return res.status(200).json({
      ok: true,
      probs: probsWithPcts,
      picks,
      confidence: Math.max(0, Math.min(1, confidence)),
      meta: {
        trials: TRIALS,
        weights: { w1, w2, w3 },
        usedSpeed,
      },
    });

  } catch (err) {
    console.error('[predict_wps] error:', err);
    return res.status(500).json({ error: 'Prediction failed', details: err.message });
  }
}