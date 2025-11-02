// api/predict_wps.js
export const config = { runtime: 'nodejs' };

// --- CORS helper (adjust origin if you want to restrict) ---
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// --- Odds parsing: supports "3/1", "9-5", or plain number like "1.8" ---
function parseOddsFraction(frac) {
  if (!frac) return null;
  const s = String(frac).trim().toLowerCase();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (a > 0 && b > 0) return a / b;
  }
  if (s.includes('-')) {
    const [a, b] = s.split('-').map(Number);
    if (a > 0 && b > 0) return a / b;
  }
  const n = Number(s);
  if (!Number.isNaN(n) && n > 0) return n;
  return null;
}
function impliedProbFromOdds(frac) {
  const p = parseOddsFraction(frac);
  return p ? (1 / (1 + p)) : 0.5;
}

// --- Distance conversion (mirrors client) ---
function toMiles(distanceInput) {
  if (!distanceInput) return null;
  const raw = String(distanceInput).trim().toLowerCase();

  const f = raw.match(/(\d+(?:\.\d+)?)(\s*)f(?:urlong[s]?)?/);
  if (f) return parseFloat(f[1]) * 0.125;

  const mix = raw.match(/(\d+)\s+(\d+)\/(\d+)/);
  if (mix) return parseInt(mix[1], 10) + (parseInt(mix[2], 10) / parseInt(mix[3], 10));

  const dec = raw.match(/-?\d+(\.\d+)?/);
  return dec ? parseFloat(dec[0]) : null;
}

// --- Math helpers ---
function zScores(vs) {
  if (!vs.length) return [];
  const m = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sd = Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / vs.length) || 1;
  return vs.map(v => (v - m) / sd);
}
function normalizeRanks(arr) {
  const n = arr.length;
  const o = arr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const r = new Array(n);
  o.forEach((row, idx) => { r[row.i] = 1 - idx / (n - 1 || 1); });
  return r;
}

// --- Robust body parse for Vercel Node ---
async function parseJSONBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fallthrough */ }
  }
  // Fallback: accumulate stream (older runtimes)
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const body = await parseJSONBody(req);
    const {
      horses = [],               // [{ name, odds, post? }]
      track = null,
      surface = null,
      distance_input = null,     // string: miles or furlongs
      speedFigs = {}             // { "Horse Name": 113 }
    } = body || {};

    if (!Array.isArray(horses) || horses.length < 3) {
      return res.status(400).json({ error: 'Need at least 3 horses' });
    }

    // Odds → implied probabilities → inverse rank (normalized 0–1)
    const oddsImpl = horses.map(h => impliedProbFromOdds(h?.odds));
    const oddsScore = normalizeRanks(oddsImpl);

    // Speed figs: fill missing with mean, then z-score → map to [0..1]
    const speedRaw = horses.map(h => {
      const nm = String(h?.name || '').toLowerCase();
      const key = Object.keys(speedFigs).find(k => String(k).toLowerCase() === nm);
      const val = key ? Number(speedFigs[key]) : NaN;
      return Number.isNaN(val) ? null : val;
    });
    const have = speedRaw.filter(v => v != null);
    const mean = have.length ? (have.reduce((a, b) => a + b, 0) / have.length) : 0;
    const filled = speedRaw.map(v => (v == null ? mean : v));
    const z = zScores(filled);                                 // can be negative/positive
    const speedScore = z.map(v => 0.5 + Math.max(Math.min(v, 2.5), -2.5) / 5); // clamp z to [-2.5,2.5] then scale → [0..1]

    // Bias: small bump for sprint/turf & sprint post position
    const miles = toMiles(distance_input);
    const sprint = (miles != null && miles < 1.0);
    const surf = String(surface || '').toLowerCase();

    const bias = horses.map((h, i) => {
      let b = 0.5;

      // very light surface-distance interplay
      if (surf.includes('turf') && sprint) b += (z[i] || 0) * 0.05;

      // surface bias for routes: dirt slight boost, turf slight penalty
      if (!sprint) {
        if (surf.includes('dirt')) b += 0.02;
        if (surf.includes('turf')) b -= 0.02;
      }

      // sprint post bias: slight inside preference, slight penalty outside
      const post = Number(h?.post);
      if (!Number.isNaN(post) && sprint) {
        if (post <= 4) b += 0.04;
        if (post >= 9) b -= 0.04;
      }

      return Math.max(0, Math.min(1, b));
    });

    // Dynamic weights
    const W = sprint ? { o: 0.40, s: 0.50, b: 0.10 } : { o: 0.40, s: 0.50, b: 0.10 };

    // Composite
    const comp = horses.map((h, i) =>
      W.o * oddsScore[i] + W.s * speedScore[i] + W.b * bias[i]
    );

    // Full ranking: all horses sorted by composite
    const fullRanking = comp
      .map((v, i) => ({ i, v, spd: speedScore[i] }))
      .sort((a, b) => (b.v - a.v) || (b.spd - a.spd));

    // Normalize composites to probabilities (softmax-like)
    const compSum = comp.reduce((a, b) => a + b, 0);
    const probs = comp.map(v => (compSum > 0 ? v / compSum : 1 / comp.length));

    // Build full ranking with reasons
    const ranking = fullRanking.map((o) => {
      const hs = horses[o.i] || {};
      const reasons = [];

      const ro = oddsScore[o.i] - 0.5;
      if (Math.abs(ro) > 0.05) reasons.push(`odds rank inv ${ro > 0 ? '+' : ''}${ro.toFixed(2)}`);

      const rz = z[o.i] || 0;
      if (Math.abs(rz) > 0.25) reasons.push(`speedFig z ${rz > 0 ? '+' : ''}${rz.toFixed(2)}`);

      if (sprint) reasons.push('dist adj');
      if (surf) reasons.push('surf adj');
      if (!Number.isNaN(Number(hs.post))) reasons.push('post adj');

      return {
        name: hs.name,
        post: hs.post || null,
        odds: hs.odds || '',
        comp: o.v,
        prob: probs[o.i],
        reasons,
      };
    });

    // Top 3 for W/P/S picks
    const ord = fullRanking.slice(0, 3);
    const slots = ['Win', 'Place', 'Show'];
    const picks = ord.map((o, idx) => {
      const hs = horses[o.i] || {};
      const reasons = [];

      const ro = oddsScore[o.i] - 0.5;
      if (Math.abs(ro) > 0.05) reasons.push(`odds rank inv ${ro > 0 ? '+' : ''}${ro.toFixed(2)}`);

      const rz = z[o.i] || 0;
      if (Math.abs(rz) > 0.25) reasons.push(`speedFig z ${rz > 0 ? '+' : ''}${rz.toFixed(2)}`);

      if (sprint) reasons.push('dist adj');
      if (surf) reasons.push('surf adj');
      if (!Number.isNaN(Number(hs.post))) reasons.push('post adj');

      return {
        slot: slots[idx],
        name: hs.name,
        odds: hs.odds || '',
        reasons
      };
    });

    // ─────────────────────────────────────────────────────────────
    // Exotic ticket generator with confidence estimates
    //   - We treat per-horse `prob` (soft) as independent-ish and
    //     build an approximate ticket probability:
    //       per-leg contribution = (sum(prob[leg horses not yet used])) / legSetSize
    //     Then multiply contributions across legs.
    //   - This is intentionally lightweight for serverless performance and
    //     acts as a relative strength indicator between variants.
    // ─────────────────────────────────────────────────────────────
    function legsToText(legs) {
      // legs: [ ['A'], ['B'], ['C','D'] ] -> "A / B / C,D"
      return legs.map(set => set.join(',')).join(' / ');
    }

    function computeTicketConfidence(legs, probMap) {
      // legs: array of arrays of names
      // probMap: { name -> prob }
      const used = new Set();
      let conf = 1.0;

      for (const set of legs) {
        // exclude already-used names to roughly enforce order/no-repeat
        const available = set.filter(n => !used.has(n));
        const denom = Math.max(1, available.length);
        let legMass = 0;

        for (const n of available) legMass += (probMap[n] || 0);

        // divide by choice count to reflect selection within the leg
        const legConf = Math.max(0, Math.min(1, legMass / denom));
        conf *= legConf;

        // greedily mark the highest-prob pick in this leg as "used" for next legs
        // (prevents double counting the same standout across legs)
        let best = null, bestP = -1;
        for (const n of available) {
          const p = probMap[n] || 0;
          if (p > bestP) { bestP = p; best = n; }
        }
        if (best) used.add(best);
      }

      // soften extremes
      return Math.max(0.01, Math.min(0.95, Math.pow(conf, 0.9)));
    }

    function buildExoticTicketsWithConfidence(ranking) {
      // ranking: [{ name, prob, ... }] sorted desc
      const top = ranking.map(r => r.name);
      const [H1, H2, H3, H4, H5, H6] = top;
      const names = [H1, H2, H3, H4, H5, H6].filter(Boolean);
      const probMap = Object.fromEntries(ranking.map(r => [r.name, r.prob || 0]));
      if (!names.length) return { trifecta: [], superfecta: [], superHighFive: [] };

      // Build as legs (arrays), then map to {text, confidence}
      const trifectaLegs = [
        [[H1], [H2], [H3, H4].filter(Boolean)],
        [[H1, H2, H3].filter(Boolean)] // BOX 3
      ].filter(legs => legs.every(set => set && set.length));

      const superfectaLegs = [
        [[H1], [H2], [H3, H4].filter(Boolean), [H3, H4, H5].filter(Boolean)],
        [[H1], [H1, H2].filter(Boolean), [H2, H3, H4].filter(Boolean), [H3, H4, H5].filter(Boolean)]
      ].filter(legs => legs.every(set => set && set.length));

      const h5a = [[H1], [H2], [H3], [H4, H5].filter(Boolean), [H4, H5, H6].filter(Boolean)];
      const h5b = [[H1], [H2, H3].filter(Boolean), [H2, H3, H4].filter(Boolean), [H4, H5].filter(Boolean), [H5, H6].filter(Boolean)];
      const superHighFiveLegs = [h5a, h5b].filter(legs => legs.every(set => set && set.length));

      function annotate(legsArr, labelForBox = null) {
        return legsArr.map(legs => {
          const text = (legs.length === 1 && labelForBox)
            ? `${labelForBox} ${legs[0].join(',')}`
            : legsToText(legs);
          const confidence = computeTicketConfidence(legs, probMap);
          return { text, confidence };
        });
      }

      const trifecta = [
        ...annotate(trifectaLegs.slice(0, 1) || []),
        ...annotate(trifectaLegs.slice(1) || [], 'BOX')
      ].filter(Boolean);

      const superfecta = annotate(superfectaLegs);
      const superHighFive = annotate(superHighFiveLegs);

      return { trifecta, superfecta, superHighFive };
    }

    // Build exotic tickets with confidence
    const tickets = buildExoticTicketsWithConfidence(ranking);

    // Confidence: mean composite ** 0.9, clamped 8%–85%
    const meanComp = ord.reduce((a, b) => a + b.v, 0) / (ord.length || 1);
    const confidence = Math.max(0.08, Math.min(0.85, Math.pow(meanComp, 0.9)));

    // ─────────────────────────────────────────────
    // Strategy suggestion (FinishLine AI Betting Strategy)
    // ─────────────────────────────────────────────
    const P1 = ranking[0]?.prob || 0;
    const P2 = ranking[1]?.prob || 0;
    const P3 = ranking[2]?.prob || 0;
    const gap12 = Math.max(0, P1 - P2);
    const gap23 = Math.max(0, P2 - P3);
    const top3Mass = P1 + P2 + P3;

    // Static "bet types by profit potential" table (copy-safe for UI)
    const betTypesTable = [
      { type: 'Trifecta Box (AI Top 3)', icon: '🔥', bestFor: 'Max profit', desc: 'Leverages AI\'s strength at identifying the 3 right horses even if order flips.' },
      { type: 'Across the Board',        icon: '🛡️', bestFor: 'Consistency', desc: 'Always collects if top pick finishes top 3. Ideal for low variance bankroll play.' },
      { type: 'Win Only',                icon: '🎯', bestFor: 'Confidence plays', desc: 'When AI confidence > 68%, Win-only yields clean edge.' },
      { type: 'Exacta Box (Top 3)',      icon: '⚖️', bestFor: 'Middle ground', desc: 'Works when AI has correct pair but misses trifecta.' },
    ];

    // Dynamic recommendation rules (simple & explainable)
    let recommended = 'Across the Board';
    let rationale = [];

    if (confidence >= 0.68 && gap12 >= 0.08) {
      recommended = 'Win Only';
      rationale.push('Top pick clear vs #2 (gap≥8%)', `Confidence ${Math.round(confidence*100)}%`);
    }
    if (top3Mass >= 0.72 && gap12 <= 0.06 && gap23 <= 0.06) {
      recommended = 'Trifecta Box (AI Top 3)';
      rationale = [`Top-3 mass ${(top3Mass*100).toFixed(0)}%`, 'Order risk high (gaps ≤6%)'];
    } else if (top3Mass >= 0.62 && gap12 <= 0.08) {
      // good for exacta box if top three dominate but #1 not a runaway
      if (recommended !== 'Trifecta Box (AI Top 3)') {
        recommended = 'Exacta Box (Top 3)';
        rationale = [`Top-3 mass ${(top3Mass*100).toFixed(0)}%`, 'Two-horse finish likely among Top 3'];
      }
    }
    // If confidence is modest but top3Mass still strong, ATB provides steady cashing.
    if (confidence < 0.58 && top3Mass >= 0.55) {
      recommended = 'Across the Board';
      rationale = [`Confidence ${Math.round(confidence*100)}%`, `Top-3 mass ${(top3Mass*100).toFixed(0)}%`];
    }

    const strategy = {
      recommended,
      rationale,
      betTypesTable,
      metrics: {
        confidence,
        top3Mass,
        gap12,
        gap23,
        top: ranking.slice(0, 6).map(r => ({ name: r.name, prob: r.prob, comp: r.comp }))
      }
    };

    // Ensure strategy is always present (double-check)
    const finalStrategy = strategy || {
      recommended: 'Across the Board',
      rationale: ['Default strategy (no metrics available)'],
      betTypesTable: [
        { type: 'Across the Board', icon: '🛡️', bestFor: 'Consistency', desc: 'Always collects if top pick finishes top 3. Ideal for low variance bankroll play.' },
        { type: 'Win Only', icon: '🎯', bestFor: 'Confidence plays', desc: 'When AI confidence > 68%, Win-only yields clean edge.' },
        { type: 'Trifecta Box (AI Top 3)', icon: '🔥', bestFor: 'Max profit', desc: 'Leverages AI\'s strength at identifying the 3 right horses even if order flips.' },
        { type: 'Exacta Box (Top 3)', icon: '⚖️', bestFor: 'Middle ground', desc: 'Works when AI has correct pair but misses trifecta.' },
      ],
      metrics: {
        confidence: confidence || 0.5,
        top3Mass: top3Mass || 0,
        gap12: gap12 || 0,
        gap23: gap23 || 0,
        top: ranking.slice(0, 6).map(r => ({ name: r.name, prob: r.prob || 0, comp: r.comp || 0 }))
      }
    };

    // Guarantee shape:
    const out = {
      picks: picks ?? null,
      strategy: finalStrategy ?? null,
      tickets: tickets ?? null,
      confidence: confidence ?? null,
      ranking: ranking ?? null,
      meta: { track, surface, distance_mi: miles }
    };
    return res.status(200).json(out);
  } catch (err) {
    console.error('[API] predict_wps failed', err);
    return res.status(500).json({ error: 'predict_wps failed', detail: String(err?.message || err) });
  }
}
