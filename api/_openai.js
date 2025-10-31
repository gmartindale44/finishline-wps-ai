export const config = { runtime: 'nodejs' };

// Dumb-but-safe scoring shim (until we wire real models or external APIs)
// Input: { horses: [{name, odds, jockey, trainer}], meta: {track, distance, surface} }
export async function scoreHorses({ horses = [], meta = {} }) {
  const normalizeOdds = (o) => {
    if (o == null) return 10;
    const s = String(o).trim();
    // Try fractional like "5/2"
    if (s.includes('/')) {
      const [a,b] = s.split('/').map(Number);
      if (a>0 && b>0) return a/b;
    }
    // Decimal or integer
    const n = Number(s);
    if (Number.isFinite(n) && n>0) return n;
    return 10;
  };

  const scored = horses.map((h, i) => {
    const o = normalizeOdds(h.odds);
    // crude score: lower odds slightly better, + small signal if jockey/trainer present
    const base = 1 / (o + 0.5);
    const jt = (h.jockey ? 0.05 : 0) + (h.trainer ? 0.05 : 0);
    const trackBoost = meta?.track ? 0.02 : 0;
    const distanceBoost = meta?.distance ? 0.02 : 0;
    const surfaceBoost = meta?.surface ? 0.02 : 0;
    const score = base + jt + trackBoost + distanceBoost + surfaceBoost;
    return { index: i, name: h.name?.trim() || `Horse ${i+1}`, odds: h.odds, score };
  });

  const sorted = [...scored].sort((a,b)=>b.score-a.score);
  const top = sorted.slice(0,3).map((h,ix)=>({
    position: ['win','place','show'][ix],
    name: h.name,
    odds: h.odds,
    score: Number(h.score.toFixed(4))
  }));

  const confidence = Math.max(0.1, Math.min(0.98, Number((sorted[0]?.score / (sorted[2]?.score || sorted[0]?.score || 1)).toFixed(2))));

  return {
    horses: scored,
    picks: top,
    confidence,
    meta,
    count: horses.length
  };
}
