export function stdOdds(oddsRaw) {
  // Accept '3/1', '9/2', '5', '2.5' --> return implied prob (0..1)
  if (!oddsRaw) return null;
  const frac = oddsRaw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const a = Number(frac[1]), b = Number(frac[2] || 1);
    const dec = a / b;
    return 1 / (dec + 1);
  }
  const num = Number(oddsRaw);
  if (!isFinite(num) || num <= 0) return null;
  // If it's an integer like 5, treat as 5/1; if decimal 2.5 treat as 2.5/1
  return 1 / (num + 1);
}

export function zscore(x, mean, sd) {
  if (x == null || !isFinite(x) || sd === 0) return 0;
  return (x - mean) / sd;
}

export function rank(values) {
  // Lower index = better rank
  const idx = values
    .map((v, i) => ({ v: v == null ? -Infinity : v, i }))
    .sort((a, b) => b.v - a.v) // higher better (e.g., speedFig)
    .map((o, rank) => ({ i: o.i, rank }));
  const out = Array(values.length).fill(null);
  idx.forEach(({ i, rank: r }) => (out[i] = r));
  return out;
}

export function buildFeatureVector(entries, ctx) {
  // ctx: { track, surface, distanceMiles }
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

  const oddsRk = rank(oddsImp.map(v => v == null ? -9999 : -v)); // lower implied prob = worse; invert so lower rank better

  const distPenalty = (d) => {
    if (!isFinite(d)) return 0;
    // Soft preference for 6f-9f when distance known (heuristic only)
    if (d < 0.5) return -0.1;
    if (d > 1.5) return -0.1;
    return 0.05;
  };
  const distAdj = distPenalty(ctx?.distanceMiles ?? NaN);

  return entries.map((e, i) => {
    const features = {
      speedFig_z: zscore(e.speedFig ?? null, speedMean, speedSd),
      speedFig_rank_inv: -(speedRk[i] ?? 99),
      odds_imp: oddsImp[i] ?? null,
      odds_rank_inv: -(oddsRk[i] ?? 99),
      dist_adj: distAdj,
    };
    return features;
  });
}

export function heuristicScore(feat) {
  // Weighted blend — speed matters most, odds helpful but not dominant
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

export function calibrateProbs(scores) {
  // Min-max then softmax temperature for smooth probabilities
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const scaled = scores.map(s => (max === min ? 0.5 : (s - min) / (max - min)));
  const T = 0.85;
  const exps = scaled.map(s => Math.exp(s / T));
  const Z = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / Z);
}

