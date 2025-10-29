const FRACT_SEP = /[\/-]/;

function parseMlOdds(oddsRaw) {
  if (!oddsRaw) return null;
  const s = String(oddsRaw).trim().toLowerCase()
    .replace(/^ml\s*/,'')
    .replace(/\s/g,'');
  // Fraction like 10/1 or 9-2 -> numerator/denominator
  const m = s.match(FRACT_SEP) ? s.split(FRACT_SEP) : null;
  if (m && m.length === 2 && !isNaN(+m[0]) && !isNaN(+m[1]) && +m[1] !== 0) {
    const num = Math.abs(+m[0]); const den = Math.abs(+m[1]);
    // fair prob (US tote-ish): den/(num+den)
    const p = den / (num + den);
    return clamp01(p);
  }
  // Moneyline like +450 or -120
  if (/^[+-]?\d+$/.test(s)) {
    const ml = +s;
    if (ml > 0) return clamp01(100 / (ml + 100));
    if (ml < 0) return clamp01((-ml) / ((-ml) + 100));
  }
  // Decimal odds like 5.5
  if (!isNaN(+s) && +s > 1) {
    return clamp01(1 / +s);
  }
  return null;
}

function clamp01(x){ return Math.max(0, Math.min(1, +x || 0)); }

function featuresForHorse(h) {
  const name = (h?.name || '').trim();
  const jockey = (h?.jockey || '').trim();
  const trainer = (h?.trainer || '').trim();
  const pOdds = parseMlOdds(h?.odds);
  // very small priors so we always have a sensible fallback
  const base = pOdds ?? 0.10;
  return {
    name, jockey, trainer,
    mlOdds: h?.odds ?? '',
    impliedProb: clamp01(base),
    // simple handcrafted features; can be expanded later
    formBoost: name.length ? Math.min(0.05, name.length / 500) : 0,
    jockeyBoost: jockey ? 0.02 : 0,
    trainerBoost: trainer ? 0.02 : 0,
  };
}

module.exports = { parseMlOdds, featuresForHorse, clamp01 };
