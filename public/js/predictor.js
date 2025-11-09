import { buildFeatureVector, heuristicScore, calibrateProbs } from './features.js';

export function predictWPS(entries, ctx) {
  const feats = buildFeatureVector(entries, ctx);
  const scores = feats.map(heuristicScore);
  const probs = calibrateProbs(scores);

  // Rank by probs for Win/Place/Show
  const order = probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).map(o => o.i);
  const picks = {
    win: { idx: order[0], prob: probs[order[0]] },
    place: { idx: order[1], prob: probs[order[1]] },
    show: { idx: order[2], prob: probs[order[2]] },
  };

  // Reasons: top 3 signals by absolute contribution for the winner
  const winnerFeat = feats[picks.win.idx];
  const contribs = Object.entries(winnerFeat)
    .map(([k, v]) => ({ k, v: v || 0 }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 3)
    .map(o => o.k.replace(/_/g, ' '));

  return { picks, probs, reasons: { [entries[picks.win.idx].horse]: contribs } };
}

