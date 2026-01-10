// pages/api/predict_wps.js
// WPS (Win/Place/Show) prediction endpoint

export const config = { runtime: 'nodejs' };

/* FL_CALIB_HELPERS */
import fs from 'fs';
import path from 'path';
import { parseDistance } from '../../lib/distance.js';
import { loadCalibrationThresholds } from '../../lib/calibrationThresholds.js';
const __CALIB_PATH = path.join(process.cwd(), 'data', 'model_params.json');
function __loadParams(){ try{ return JSON.parse(fs.readFileSync(__CALIB_PATH,'utf8')); }catch{ return {reliability:[],temp_tau:1.0,policy:{}}; } }
function __calConf(raw, rel){
  if(!rel?.length) return raw;
  const arr=[...rel].sort((a,b)=>a.c-b.c);
  if(raw<=arr[0].c) return arr[0].p;
  if(raw>=arr[arr.length-1].c) return arr[arr.length-1].p;
  for(let i=1;i<arr.length;i++){ const a=arr[i-1], b=arr[i]; if(raw<=b.c){ const t=(raw-a.c)/(b.c-a.c); return a.p*(1-t)+b.p*t; } }
  return raw;
}
function __soft(scores, tau=1.0){ const ex=scores.map(s=>Math.exp(s/Math.max(0.05,tau))); const Z=ex.reduce((a,b)=>a+b,0); return ex.map(v=>v/Z); }
function __tc(s){ return s ? s.replace(/\b\w/g,m=>m.toUpperCase()) : s; }

// Shadow-mode decision helper (read-only; does NOT affect real strategy)
function buildShadowDecision({ thresholds, predicted, meta }) {
  // meta can contain: { winConfidence, placeConfidence, showConfidence, fieldSize }
  const fieldSize = meta?.fieldSize ?? null;
  const winConf = meta?.winConfidence ?? null;
  const placeConf = meta?.placeConfidence ?? null;
  const showConf = meta?.showConfidence ?? null;

  const winAllowed =
    !!predicted?.win &&
    winConf != null &&
    winConf >= thresholds.win.minConfidence &&
    (fieldSize == null || fieldSize <= thresholds.win.maxFieldSize);

  const placeAllowed =
    !!predicted?.place &&
    placeConf != null &&
    placeConf >= thresholds.place.minConfidence &&
    (fieldSize == null || fieldSize <= thresholds.place.maxFieldSize);

  const showAllowed =
    !!predicted?.show &&
    showConf != null &&
    showConf >= thresholds.show.minConfidence &&
    (fieldSize == null || fieldSize <= thresholds.show.maxFieldSize);

  return {
    strategyName: thresholds.strategyName || 'v1_shadow_only',
    version: thresholds.version ?? 1,
    fieldSize,
    confidences: {
      win: winConf,
      place: placeConf,
      show: showConf,
    },
    allow: {
      win: winAllowed,
      place: placeAllowed,
      show: showAllowed,
    },
  };
}

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
  // Set headers
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Handler-Identity', 'PREDICT_WPS_OK');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: `Expected POST, received ${req.method}` });
  }

  // Server-side PayGate check (non-blocking in monitor mode)
  try {
    const { checkPayGateAccess } = await import('../../lib/paygate-server.js');
    const accessCheck = checkPayGateAccess(req);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        ok: false,
        error: 'PayGate locked',
        message: 'Premium access required. Please unlock to continue.',
        code: 'paygate_locked',
        reason: accessCheck.reason
      });
    }
  } catch (paygateErr) {
    // Non-fatal: log but allow request (fail-open for safety)
    console.warn('[predict_wps] PayGate check failed (non-fatal):', paygateErr?.message);
  }

  try {
    const body = await parseJSONBody(req);
    
    // Normalize distance if client didn't provide normalized values
    if (!body.distance_furlongs || !body.distance_meters) {
      const norm = parseDistance(body.distance || body.distance_input || '');
      if (norm) {
        body.distance_furlongs = norm.distance_furlongs;
        body.distance_meters = norm.distance_meters;
        // Keep pretty label for display
        if (!body.distance && body.distance_input) {
          body.distance = norm.pretty;
        }
      }
    }
    const {
      horses = [],               // [{ name, odds, post? }]
      track = null,
      surface = null,
      distance_input = null,     // string: miles or furlongs (pretty label)
      distance_furlongs = null,  // float: normalized furlongs
      distance_meters = null,    // integer: normalized meters
      speedFigs = {}             // { "Horse Name": 113 }
    } = body || {};

    if (!Array.isArray(horses) || horses.length < 3) {
      return res.status(400).json({ ok: false, error: 'Need at least 3 horses' });
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
    // Prefer normalized distance_furlongs if available, otherwise convert legacy distance_input
    const miles = distance_furlongs != null 
      ? distance_furlongs / 8  // Convert furlongs to miles
      : toMiles(distance_input);
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

    // ADDITIVE: Compute Harville place/show probabilities (if enabled)
    let probs_win = null;
    let probs_place = null;
    let probs_show = null;
    const enableHarville = process.env.ENABLE_HARVILLE_PROBS !== 'false'; // default true
    if (enableHarville) {
      try {
        const { harvilleFromWinProbs } = await import('../../lib/harville.js');
        const harvilleResult = harvilleFromWinProbs(probs, true); // use Stern adjustment
        probs_win = harvilleResult.winProbs; // use returned win probs (original normalized, not Stern-adjusted)
        probs_place = harvilleResult.placeProbs;
        probs_show = harvilleResult.showProbs;
      } catch (err) {
        console.warn('[predict_wps] Harville computation failed (using null):', err?.message || err);
        // Fail gracefully - leave probs_win/place/show as null
      }
    }

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

      const entry = {
        name: hs.name,
        post: hs.post || null,
        odds: hs.odds || '',
        comp: o.v,
        prob: probs[o.i],
        reasons,
      };
      
      // ADDITIVE: Add Harville probabilities to each ranking entry (if available)
      if (enableHarville && probs_win && probs_place && probs_show) {
        entry.prob_win = probs_win[o.i] || 0;
        entry.prob_place = probs_place[o.i] || 0;
        entry.prob_show = probs_show[o.i] || 0;
      }
      
      return entry;
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
    
    // ADDITIVE: Compute top3_mass clarity fields (if enabled)
    const enableTop3MassClarity = process.env.ENABLE_TOP3_MASS_CLARITY !== 'false'; // default true
    let top3_mass_raw = null;
    let top3_mass_calibrated = null;
    let top3_mass_method = 'legacy';
    if (enableTop3MassClarity) {
      // Raw top3 mass from ranking probabilities (0-1 range, convert to 0-100)
      const rawTop3Sum = P1 + P2 + P3;
      top3_mass_raw = Math.round(Math.max(0, Math.min(100, rawTop3Sum * 100)));
    }

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

    // ADDITIVE: Derive raceId from track/date/raceNo (same format as predmeta keys)
    const deriveRaceId = () => {
      const date = body.date || body.dateIso || null;
      const raceNo = body.raceNo || body.race || null;
      const trackName = track || null;
      
      if (!date || !raceNo || !trackName) return null;
      
      // Normalize track (same logic as predmeta write in safeWritePredmeta)
      const normalizeTrack = (t) => {
        if (!t) return "";
        return String(t)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ")
          .replace(/[^a-z0-9\s]/g, "")
          .replace(/\s+/g, " ");
      };
      
      const normalizeDate = (d) => {
        if (!d) return "";
        const str = String(d).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        try {
          const parsed = new Date(str);
          if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
          }
        } catch {}
        return "";
      };
      
      const normTrack = normalizeTrack(trackName);
      const normDate = normalizeDate(date);
      const normRaceNo = String(raceNo).trim();
      
      if (normTrack && normDate && normRaceNo) {
        return `${normDate}|${normTrack}|${normRaceNo}`;
      }
      return null;
    };
    
    const raceId = deriveRaceId();
    
    // ADDITIVE: Generate server-side timestamp
    const asOf = new Date().toISOString();

    // Calibration post-processor (gracefully no-ops if model_params.json is missing)
    let calibratedResponse = {
      picks,
      confidence,
      ranking,
      tickets,
      strategy: finalStrategy,
      meta: { 
        track, 
        surface, 
        distance_mi: miles,
        distance_furlongs: distance_furlongs || null,
        distance_meters: distance_meters || null,
        // ADDITIVE: Add asOf and raceId to meta
        asOf,
        raceId
      },
      // ADDITIVE: Add Harville probability arrays to response (if enabled)
      ...(enableHarville && probs_win && probs_place && probs_show ? {
        probs_win,
        probs_place,
        probs_show
      } : {})
    };
    
    try {
      const __p = __loadParams();
      const __raw = confidence; // already 0..1 range
      const __cal = __calConf(Math.max(0, Math.min(1, __raw)), __p.reliability);
      const __mass = __soft([0, -1, -2], __p.temp_tau || 1.0);
      
      const __top3 = picks.slice(0, 3).map((p, i) => ({
        ...p,
        prob: Math.round(Math.max(0.0001, __mass[i]) * __cal * 100)
      }));
      
      const __top3_mass = __top3.reduce((a, h) => a + (h.prob || 0), 0);
      const __perc = Math.round(__cal * 100);
      
      let __band = '60-64';
      if (__perc >= 65 && __perc < 70) __band = '65-69';
      else if (__perc >= 70 && __perc < 75) __band = '70-74';
      else if (__perc >= 75) __band = '75-79';
      
      const __policy = (__p.policy && __p.policy[__band]) || {};
      const __reco = __tc(__policy.recommended || finalStrategy?.recommended || 'across the board');
      
      // ADDITIVE: Set top3_mass clarity fields after calibration
      const enableTop3MassClarity = process.env.ENABLE_TOP3_MASS_CLARITY !== 'false'; // default true
      let top3_mass_calibrated = null;
      let top3_mass_method = 'legacy';
      if (enableTop3MassClarity) {
        top3_mass_calibrated = Math.round(__top3_mass);
        // Determine method: if calibrated and model is calib-v1, check if calibrated differs from raw
        const rawTop3Sum = (ranking[0]?.prob || 0) + (ranking[1]?.prob || 0) + (ranking[2]?.prob || 0);
        const rawTop3Pct = Math.round(rawTop3Sum * 100);
        if (__p.reliability && __p.reliability.length && calibratedResponse.meta?.model === 'calib-v1') {
          // If calibrated differs materially (> 5 points) from raw, use "calib_template"
          if (Math.abs(top3_mass_calibrated - rawTop3Pct) > 5) {
            top3_mass_method = 'calib_template';
          } else {
            top3_mass_method = 'raw_sum';
          }
        } else {
          top3_mass_method = 'raw_sum';
        }
      }
      
      calibratedResponse = {
        ...calibratedResponse,
        picks: __top3,
        confidence: __perc,
        top3_mass: Math.round(__top3_mass),
        ...(enableTop3MassClarity ? {
          top3_mass_raw: Math.round((P1 + P2 + P3) * 100),
          top3_mass_calibrated,
          top3_mass_method
        } : {}),
        strategy: {
          ...finalStrategy,
          recommended: __reco,
          band: __band,
          policy_stats: __policy.stats || null
        },
        meta: {
          ...calibratedResponse.meta,
          calibrated: !!(__p.reliability && __p.reliability.length),
          model: 'calib-v1'
        }
      };
    } catch (calibErr) {
      console.warn('[predict_wps] Calibration error (using raw response):', calibErr?.message || calibErr);
      // Fallback to original response if calibration fails
    }

    // Shadow-mode decision (read-only; does not affect picks or strategy)
    const thresholds = loadCalibrationThresholds();
    const shadowMeta = {
      // Currently we only have a single confidence and top3_mass; per-leg confidences are null
      winConfidence: null,
      placeConfidence: null,
      showConfidence: null,
      fieldSize: Array.isArray(horses) ? horses.length : null,
    };
    const shadowDecision = buildShadowDecision({
      thresholds,
      predicted: {
        win: calibratedResponse.picks?.[0]?.name || null,
        place: calibratedResponse.picks?.[1]?.name || null,
        show: calibratedResponse.picks?.[2]?.name || null,
      },
      meta: shadowMeta,
    });
    
    // Fire-and-forget Redis logging (non-blocking, no-op if Redis disabled)
    (async () => {
      try {
        const { redisPushSafe, dayKey } = await import('../../lib/redis.js');
        const k = dayKey('fl:predictions');
        const picksStr = picks && picks.length ? picks.map(p => p.name || p.slot || '').filter(Boolean).join('-') : null;
        await redisPushSafe(k, {
          ts: Date.now(),
          track: track || null,
          surface: surface || null,
          distance: distance_input || null,
          picks: picksStr,
          confidence: calibratedResponse.confidence ?? null,
          top3_mass: calibratedResponse.top3_mass ?? null,
          strategy: calibratedResponse.strategy?.recommended || null,
          shadowDecision: {
            strategyName: shadowDecision.strategyName,
            version: shadowDecision.version,
            allow: shadowDecision.allow,
            fieldSize: shadowDecision.fieldSize,
          },
        });
      } catch (_) {
        // Ignore all errors - this is fire-and-forget
      }
    })();

    // Helper function to safely write predmeta with debugging
    async function safeWritePredmeta(payload) {
      const debugResult = {
        enabled: false,
        mode: null,
        key: null,
        written: false,
        error: null,
      };
      
      try {
        // Check persistence enabled (treat as string "true")
        const persistEnabledRaw = process.env.FINISHLINE_PERSISTENCE_ENABLED || '';
        const persistEnabled = String(persistEnabledRaw).toLowerCase() === 'true';
        debugResult.enabled = persistEnabled;
        
        // Skip if not enabled
        if (!persistEnabled) {
          return debugResult;
        }
        
        // Check Redis env vars
        const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
        if (!hasRedis) {
          debugResult.error = 'Redis env vars missing';
          return debugResult;
        }
        
        const { setex } = await import('../../lib/redis.js');
        
        const date = payload.date || null;
        const raceNo = payload.raceNo || null;
        const normTrack = payload.track || '';
        const timestamp = payload.created_at_ms || Date.now();
        
        // Determine key and mode
        let targetKey = null;
        let mode = null;
        let ttl = 0;
        
        if (date && raceNo) {
          // Permanent key
          const joinKey = `${date}|${normTrack}|${raceNo}`;
          targetKey = `fl:predmeta:${joinKey}`;
          mode = 'permanent';
          ttl = 3888000; // 45 days
        } else {
          // Pending key
          targetKey = `fl:predmeta:pending:${timestamp}`;
          mode = 'pending';
          ttl = 7200; // 2 hours
        }
        
        debugResult.mode = mode;
        debugResult.key = targetKey;
        
        // Write predmeta key
        await setex(targetKey, ttl, JSON.stringify(payload));
        debugResult.written = true;
        
        // Always write debug key (6 hours TTL = 21600 seconds)
        const debugKey = 'fl:predmeta:last_write';
        const debugPayload = {
          ts: timestamp,
          persistEnabledRaw: String(persistEnabledRaw),
          track: normTrack,
          date: date || null,
          raceNo: raceNo || null,
          keyWritten: targetKey,
          confidence_pct: payload.confidence_pct || null,
          t3m_pct: payload.t3m_pct || null,
          mode,
        };
        await setex(debugKey, 21600, JSON.stringify(debugPayload));
        
      } catch (err) {
        debugResult.error = err?.message || String(err);
        // Log one line error (key name only, no env vars/tokens)
        console.warn("[predmeta] write failed", debugResult.key, debugResult.error);
      }
      
      return debugResult;
    }
    
    // Persist prediction metadata (confidence/T3M) for join key lookup
    // If date/raceNo available: persist to permanent key
    // If date/raceNo missing: persist to temporary pending key
    let predmetaDebug = { enabled: false, mode: null, key: null, written: false, error: null };
    
    // Await predmeta write (with timeout to avoid blocking too long)
    const predmetaWritePromise = (async () => {
      try {
        const date = body.date || body.dateIso || null;
        const raceNo = body.raceNo || body.race || null;
        
        // Skip if track missing
        if (!track) {
          predmetaDebug.error = 'track missing';
          return;
        }
        
        // Normalize track name (same as verify_race.js)
        const normalizeTrack = (t) => {
          if (!t) return "";
          return String(t)
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ")
            .replace(/[^a-z0-9\s]/g, "")
            .replace(/\s+/g, " ");
        };
        
        // Normalize date to YYYY-MM-DD
        const normalizeDate = (d) => {
          if (!d) return "";
          const str = String(d).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
          try {
            const parsed = new Date(str);
            if (!isNaN(parsed.getTime())) {
              return parsed.toISOString().slice(0, 10);
            }
          } catch {}
          return "";
        };
        
        const normTrack = normalizeTrack(track);
        if (!normTrack) {
          predmetaDebug.error = 'track normalization failed';
          return;
        }
        
        // Extract predicted picks from picks array
        const predictedWin = picks && picks.length > 0 ? (picks[0]?.name || picks[0]?.slot || "") : "";
        const predictedPlace = picks && picks.length > 1 ? (picks[1]?.name || picks[1]?.slot || "") : "";
        const predictedShow = picks && picks.length > 2 ? (picks[2]?.name || picks[2]?.slot || "") : "";
        
        // Extract top3_list from ranking (ordered top 3 horses)
        const top3List = (calibratedResponse.ranking || []).slice(0, 3)
          .map(r => r?.name || "")
          .filter(Boolean);
        
        // Derive confidence_pct and t3m_pct from correct sources
        // confidence: already in 0-100 range from calibratedResponse
        const confidencePct = typeof calibratedResponse.confidence === 'number' && Number.isFinite(calibratedResponse.confidence)
          ? calibratedResponse.confidence
          : null;
        
        // t3m_pct: use strategy.metrics.top3Mass (fractional 0-1) * 100
        const top3MassFrac = calibratedResponse.strategy?.metrics?.top3Mass;
        const t3mPct = typeof top3MassFrac === 'number' && Number.isFinite(top3MassFrac)
          ? Math.round(top3MassFrac * 100)
          : null;
        
        // Persist if we have at least confidence_pct (prefer persisting even if t3m missing)
        if (!Number.isFinite(confidencePct)) {
          predmetaDebug.error = 'confidence_pct not finite';
          return;
        }
        
        const now = new Date();
        const created_at = now.toISOString();
        const timestamp = Date.now();
        
        // Compute horses fingerprint (simple hash from ordered horse names)
        const horsesFingerprint = (() => {
          if (!Array.isArray(horses) || horses.length === 0) return "";
          const names = horses
            .map(h => String(h?.name || h?.slot || "").trim().toLowerCase())
            .filter(Boolean);
          if (names.length === 0) return "";
          const combined = names.join("|");
          let hash = 0;
          for (let i = 0; i < combined.length; i++) {
            hash = ((hash << 5) - hash) + combined.charCodeAt(i);
            hash = hash & hash;
          }
          return Math.abs(hash).toString(16).slice(0, 12).padStart(12, '0');
        })();
        
        // Prepare predmeta payload
        const normDate = date ? normalizeDate(date) : null;
        const normRaceNo = raceNo ? String(raceNo).trim() : null;
        
        const predmetaPayload = {
          track: normTrack,
          confidence_pct: confidencePct,
          t3m_pct: t3mPct,
          predicted_win: predictedWin,
          predicted_place: predictedPlace,
          predicted_show: predictedShow,
          top3_list: top3List,
          created_at,
          created_at_ms: timestamp,
          model_version: calibratedResponse.meta?.model || "",
          calibration_id: calibratedResponse.strategy?.recommended || "",
          distance: distance_input || null,
          surface: surface || null,
          distance_furlongs: calibratedResponse.meta?.distance_furlongs || null,
          distance_meters: calibratedResponse.meta?.distance_meters || null,
          runners_count: horses ? horses.length : 0,
          horses_fingerprint: horsesFingerprint || null,
          ...(normDate && normRaceNo ? { date: normDate, raceNo: normRaceNo } : {}),
        };
        
        // Write via helper (includes debug key)
        predmetaDebug = await safeWritePredmeta(predmetaPayload);
        
      } catch (err) {
        predmetaDebug.error = err?.message || String(err);
        console.warn("[predmeta] write failed", predmetaDebug.key || 'unknown', predmetaDebug.error);
      }
    })();
    
    // Wait for predmeta write with timeout (max 1 second, then proceed)
    try {
      await Promise.race([
        predmetaWritePromise,
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
    } catch {
      // Ignore timeout - proceed with response
    }

    // ADDITIVE: Store prediction snapshot in Redis (if enabled, raceId available, and qualifies)
    // Option A: high-signal only - only write snapshots when allowAny OR confidenceHigh
    // Track snapshot debug info for response
    const { getRedisFingerprint } = await import('../../lib/redis_fingerprint.js');
    const redisFingerprint = getRedisFingerprint();
    
    const snapshotDebug = {
      enablePredSnapshots: process.env.ENABLE_PRED_SNAPSHOTS === 'true',
      redisConfigured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      redisFingerprint: redisFingerprint, // Safe fingerprint (no secrets)
      redisClientType: "REST API (lib/redis.js)", // For diagnostics
      snapshotAttempted: false,
      snapshotKey: null,
      snapshotWriteOk: null,
      snapshotWriteError: null,
      shouldSnapshot: false,
      allowAny: false,
      confidenceHigh: false,
      // Debug: show why snapshot was/wasn't attempted
      gatingReason: null, // Will be set below
    };
    
    const enablePredSnapshots = snapshotDebug.enablePredSnapshots;
    const redisConfigured = snapshotDebug.redisConfigured;
    
    // Determine if this prediction qualifies for snapshot (high-signal only)
    const allow = shadowDecision?.allow || {};
    const allowAny = !!(allow?.win || allow?.place || allow?.show);
    const confidenceHigh = (typeof calibratedResponse.confidence === 'number' ? calibratedResponse.confidence : 0) >= 80;
    const shouldSnapshot = !!(enablePredSnapshots && redisConfigured && raceId && (allowAny || confidenceHigh));
    
    // Update debug fields (force booleans, no nulls)
    snapshotDebug.shouldSnapshot = shouldSnapshot;
    snapshotDebug.allowAny = allowAny;
    snapshotDebug.confidenceHigh = confidenceHigh;
    snapshotDebug.snapshotAttempted = shouldSnapshot;
    
    // Debug: explain why snapshot was/wasn't attempted
    if (!shouldSnapshot) {
      if (!enablePredSnapshots) {
        snapshotDebug.gatingReason = "ENABLE_PRED_SNAPSHOTS not true";
      } else if (!redisConfigured) {
        snapshotDebug.gatingReason = "Redis not configured";
      } else if (!raceId) {
        snapshotDebug.gatingReason = "raceId is null (missing date/raceNo/track)";
      } else if (!allowAny && !confidenceHigh) {
        snapshotDebug.gatingReason = "No bets allowed and confidence < 80%";
      } else {
        snapshotDebug.gatingReason = "Unknown (shouldSnapshot logic)";
      }
    } else {
      snapshotDebug.gatingReason = allowAny ? "Bet allowed" : "Confidence >= 80%";
    }
    
    if (shouldSnapshot) {
      snapshotDebug.snapshotKey = `fl:predsnap:${raceId}:${asOf}`;
      
      try {
        const { setex } = await import('../../lib/redis.js');
        const snapshotKey = snapshotDebug.snapshotKey;
        
        // Store minimal snapshot payload (enough for verification)
        const snapshotPayload = {
          picks: calibratedResponse.picks,
          ranking: calibratedResponse.ranking,
          confidence: calibratedResponse.confidence,
          top3_mass: calibratedResponse.top3_mass,
          meta: {
            ...calibratedResponse.meta,
            asOf,
            raceId
          },
          strategy: calibratedResponse.strategy || null,
          // Store top-level fields for convenience
          snapshot_asOf: asOf,
          snapshot_raceId: raceId
        };
        
        // TTL: 7 days (604800 seconds) - await inline for reliability
        await setex(snapshotKey, 604800, JSON.stringify(snapshotPayload));
        snapshotDebug.snapshotWriteOk = true;
      } catch (err) {
        // Non-fatal: log but don't block response (fail-open)
        snapshotDebug.snapshotWriteOk = false;
        snapshotDebug.snapshotWriteError = err?.message || String(err);
        console.warn('[predict_wps] Snapshot write failed (non-fatal):', snapshotDebug.snapshotWriteError);
      }
    }

    return res.status(200).json({
      ok: true,
      ...calibratedResponse,
      shadowDecision,
      calibrationThresholds: {
        strategyName: thresholds.strategyName,
        version: thresholds.version,
      },
      predmeta_debug: predmetaDebug,
      // ADDITIVE: Snapshot debug info (non-sensitive)
      snapshot_debug: snapshotDebug,
    });
  } catch (err) {
    console.error('[predict_wps] Error:', err);
    return res.status(500).json({ ok: false, error: 'prediction_error', message: String(err?.message || err) });
  }
}

