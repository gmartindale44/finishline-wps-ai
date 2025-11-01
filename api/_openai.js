import OpenAI from 'openai';

export function resolveOpenAIKey(){
  const key = process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if(!key) throw new Error('Missing OpenAI API key (FINISHLINE_OPENAI_API_KEY or OPENAI_API_KEY)');
  return key;
}

// Export which env name we actually used (handy in logs)
export const OPENAI_KEY_NAME = process.env.FINISHLINE_OPENAI_API_KEY
  ? 'FINISHLINE_OPENAI_API_KEY'
  : (process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : '(none)');

function getClient() {
  const key = resolveOpenAIKey();
  if (!key) {
    const e = new Error(
      `Missing OpenAI API key. Checked FINISHLINE_OPENAI_API_KEY and OPENAI_API_KEY (used: ${OPENAI_KEY_NAME}).`
    );
    e.status = 500;
    throw e;
  }
  return new OpenAI({ apiKey: key });
}

async function jsonCompletion({ system, user, model = 'gpt-4o-mini' }) {
  const client = getClient();
  try {
    const r = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) }
      ],
      temperature: 0.2,
    });

    const txt = r?.choices?.[0]?.message?.content ?? '';
    try {
      const parsed = JSON.parse(txt);
      return { ok: true, data: parsed };
    } catch (parseErr) {
      return { ok: false, error: 'Parse failed', raw: txt, detail: String(parseErr) };
    }
  } catch (err) {
    return { ok: false, error: 'OpenAI API failed', detail: String(err?.message || err) };
  }
}

// Convert "5/1" → implied probability
export function fracOddsToProb(oddsStr){
  if(!oddsStr) return null;
  const m = String(oddsStr).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if(!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if(!b) return null;
  return b / (a + b);
}

function z(n){ return Number.isFinite(n) ? n : 0; }

function softmax(list){
  const max = Math.max(...list);
  const exps = list.map(v=>Math.exp(v-max));
  const sum = exps.reduce((a,b)=>a+b,0) || 1;
  return exps.map(v=>v/sum);
}

/**
 * scoreHorses: deterministic + researched features.
 * Inputs: {horses, meta, factorsMap}
 * Returns: {scores: [{name, score, breakdown}], picks: {win, place, show}, confidence}
 */
export async function scoreHorses({ horses, meta, factorsMap }){
  // Weights — start conservative; we can tweak later
  const W = {
    ml_implied:        0.45,
    trainer_win_pct:   0.10,
    jockey_win_pct:    0.10,
    last3_form:        0.18,
    distance_record:   0.07,
    surface_record:    0.07,
    post_bias_bonus:   0.03,
  };

  const rows = horses.map(h=>{
    const f = factorsMap.get(h.name) || {};
    const mlProb = fracOddsToProb(h.odds || h.ml_odds);

    // last3 → smaller is better; convert to score in [0,1]
    const last3 = Array.isArray(f.last3_finishes)?f.last3_finishes:[];
    const formVals = last3
      .map(v => Number.isFinite(v) ? Math.max(0, 12 - v)/11 : 0.5); // win(1)=>1.0, 12th=>~0
    const formScore = formVals.length ? (formVals.reduce((a,b)=>a+b,0)/formVals.length) : 0.5;

    const distRec = f.distance_record || {};
    const surfRec = f.surface_record  || {};
    const distScore = (z(distRec.wins) + 0.5*z(distRec.places) + 0.3*z(distRec.shows)) / Math.max(1, z(distRec.starts));
    const surfScore = (z(surfRec.wins) + 0.5*z(surfRec.places) + 0.3*z(surfRec.shows)) / Math.max(1, z(surfRec.starts));

    const trainer = (f.trainer_win_pct ?? 10) / 100; // default conservative
    const jockey  = (f.jockey_win_pct  ?? 10) / 100;

    let postBonus = 0;
    if(f.post_bias?.favors_inside && /^(1|2|3)/.test(h.post||'')) postBonus = 0.10;
    if(f.post_bias?.favors_outside && /^(9|10|11|12|13|14|15|16|17)/.test(h.post||'')) postBonus = 0.10;

    const featureScore =
      W.ml_implied      * (mlProb ?? 0.08) +
      W.trainer_win_pct * trainer +
      W.jockey_win_pct  * jockey  +
      W.last3_form      * formScore +
      W.distance_record * distScore +
      W.surface_record  * surfScore +
      W.post_bias_bonus * postBonus;

    return {
      name: h.name,
      raw: featureScore,
      breakdown:{
        ml_implied: mlProb ?? null, trainer, jockey, formScore, distScore, surfScore, postBonus
      }
    };
  });

  // Normalize + softmax to get probabilities
  const raw = rows.map(r=>r.raw);
  const probs = softmax(raw);
  const scored = rows.map((r,i)=>({ ...r, score: probs[i] }));

  // Pick W/P/S
  const sorted = [...scored].sort((a,b)=>b.score-a.score);
  const wp = sorted[0]?.name || null;
  const pl = sorted[1]?.name || null;
  const sh = sorted[2]?.name || null;

  // Confidence: margin between #1 and #4 (or #3)
  const margin = (sorted[0]?.score??0) - (sorted[3]?.score ?? sorted[2]?.score ?? 0);
  const confidence = Math.max(0, Math.min(0.99, margin + (sorted[0]?.score??0)/2 ));

  return {
    scores: scored,
    picks: { win: wp, place: pl, show: sh },
    confidence: Number(confidence.toFixed(2))
  };
}

export async function finalizeWPS({ scores = [], meta = {} }) {
  if (!Array.isArray(scores) || scores.length === 0) {
    const e = new Error('No scores to finalize');
    e.status = 400;
    throw e;
  }

  const system = `You finalize W/P/S from model scores. Return STRICT JSON:
  {
    "predictions": {"win":"", "place":"", "show":""},
    "confidence": 0.0,
    "notes": ""
  }`;

  const user = { scores, meta };

  const res = await jsonCompletion({ system, user });
  if (!res.ok) {
    const e = new Error(res.error || 'LLM finalize failed');
    e.status = 502;
    e.detail = res.detail || res.raw;
    throw e;
  }

  const data = res.data || {};
  if (!data?.predictions || typeof data?.confidence !== 'number') {
    const e = new Error('Response missing predictions/confidence');
    e.status = 502;
    e.detail = data;
    throw e;
  }

  return data;
}
