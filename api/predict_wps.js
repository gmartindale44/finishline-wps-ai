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

    // Build exotic ticket variants
    const top6 = fullRanking.slice(0, 6);
    const top6Names = top6.map(o => horses[o.i]?.name || '').filter(Boolean);

    function ticketConfidence(legs, probs, fullRanking) {
      let conf = 1;
      legs.forEach((leg) => {
        const legProbs = leg.map(name => {
          const rankEntry = fullRanking.find(r => horses[r.i]?.name === name);
          return rankEntry ? probs[rankEntry.i] : 0;
        });
        if (legProbs.length > 0) {
          const legMax = Math.max(...legProbs);
          const legSize = leg.length;
          conf *= (legMax / legSize);
        }
      });
      return Math.max(0, Math.min(1, conf));
    }

    // Trifecta variants
    const trifecta = [];
    if (top6Names.length >= 3) {
      trifecta.push({
        legs: [[top6Names[0]], [top6Names[1]], [top6Names[2], top6Names[3]]],
        label: `${top6Names[0]} / ${top6Names[1]} / ${top6Names[2]},${top6Names[3]}`,
      });
      trifecta.push({
        legs: [[top6Names[0], top6Names[1], top6Names[2]]],
        label: `BOX ${top6Names[0]}-${top6Names[1]}-${top6Names[2]}`,
      });
    }

    // Superfecta variants
    const superfecta = [];
    if (top6Names.length >= 5) {
      superfecta.push({
        legs: [[top6Names[0]], [top6Names[1]], [top6Names[2], top6Names[3]], [top6Names[3], top6Names[4], top6Names[5]]],
        label: `${top6Names[0]} / ${top6Names[1]} / ${top6Names[2]},${top6Names[3]} / ${top6Names[3]},${top6Names[4]},${top6Names[5]}`,
      });
      superfecta.push({
        legs: [[top6Names[0]], [top6Names[0], top6Names[1]], [top6Names[1], top6Names[2], top6Names[3]], [top6Names[3], top6Names[4], top6Names[5]]],
        label: `${top6Names[0]} / ${top6Names[0]},${top6Names[1]} / ${top6Names[1]},${top6Names[2]},${top6Names[3]} / ${top6Names[3]},${top6Names[4]},${top6Names[5]}`,
      });
    }

    // Super High Five variants
    const superHighFive = [];
    if (top6Names.length >= 6) {
      superHighFive.push({
        legs: [[top6Names[0]], [top6Names[1]], [top6Names[2]], [top6Names[3], top6Names[4]], [top6Names[4], top6Names[5]]],
        label: `${top6Names[0]} / ${top6Names[1]} / ${top6Names[2]} / ${top6Names[3]},${top6Names[4]} / ${top6Names[4]},${top6Names[5]}`,
      });
      superHighFive.push({
        legs: [[top6Names[0]], [top6Names[1], top6Names[2]], [top6Names[1], top6Names[2], top6Names[3]], [top6Names[4]], [top6Names[5]]],
        label: `${top6Names[0]} / ${top6Names[1]},${top6Names[2]} / ${top6Names[1]},${top6Names[2]},${top6Names[3]} / ${top6Names[4]} / ${top6Names[5]}`,
      });
    }

    // Add confidence to tickets
    const tickets = {
      trifecta: trifecta.map(t => ({
        ...t,
        confidence: ticketConfidence(t.legs, probs, fullRanking),
      })),
      superfecta: superfecta.map(t => ({
        ...t,
        confidence: ticketConfidence(t.legs, probs, fullRanking),
      })),
      superHighFive: superHighFive.map(t => ({
        ...t,
        confidence: ticketConfidence(t.legs, probs, fullRanking),
      })),
    };

    // Confidence: mean composite ** 0.9, clamped 8%–85%
    const meanComp = ord.reduce((a, b) => a + b.v, 0) / (ord.length || 1);
    const confidence = Math.max(0.08, Math.min(0.85, Math.pow(meanComp, 0.9)));

    return res.status(200).json({
      picks,
      confidence,
      ranking,
      tickets,
      meta: { track, surface, distance_mi: miles }
    });
  } catch (err) {
    console.error('[predict_wps] Error:', err);
    return res.status(500).json({ error: 'prediction_error', message: String(err?.message || err) });
  }
}
