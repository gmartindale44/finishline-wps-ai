import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY });

// Simple calibration constants (tune if needed)
const BLEND_ML_WEIGHT = 0.6;   // Morning line implied prob weight
const BLEND_LLM_WEIGHT = 0.4;  // LLM score weight

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function pickTop3(scored) {
  const sorted = [...scored].sort((a, b) => b.final - a.final);
  const [win, place, show] = sorted;
  return {
    win: win ? { name: win.name, score: win.final } : null,
    place: place ? { name: place.name, score: place.final } : null,
    show: show ? { name: show.name, score: show.final } : null
  };
}

function toPrompt(horses, meta) {
  const lines = horses.map(h => `- ${h.name} | ML: ${h.ml || 'N/A'} | Jockey: ${h.jockey || 'N/A'} | Trainer: ${h.trainer || 'N/A'}`);
  return `
You are a handicapping assistant. Given a race card (name, morning-line odds, jockey, trainer) and meta (track, surface, distance), return a JSON object with fields:

{
  "scores": [{"name":"Horse A","llm":0.0}, ...],   // llm score 0..1 for each horse, higher is better
  "notes": "brief reasoning in one line"
}

Only return JSON. No prose.

META:
- Track: ${meta?.track || 'N/A'}
- Surface: ${meta?.surface || 'N/A'}
- Distance: ${meta?.distance || 'N/A'}

HORSES:
${lines.join('\n')}
`;
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Bad JSON from model');
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch (err) {
        console.error('[analyze] Bad JSON:', err);
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const { horses, meta } = body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: 'No horses provided' });
    }

    // Build LLM prompt
    const prompt = toPrompt(horses, meta || {});

    // Call OpenAI (fast + inexpensive)
    const chat = await openai.chat.completions.create({
      model: process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You rate horses for W/P/S. Prefer consistent recent form inferred from ML & connections, but keep JSON-only output." },
        { role: "user", content: prompt }
      ]
    });

    const raw = chat.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse(raw);
    const llmScores = new Map((parsed?.scores || []).map(s => [String(s.name).trim().toLowerCase(), Number(s.llm) || 0]));

    // Blend ML implied with LLM score
    const scored = horses.map(h => {
      const nameKey = String(h.name).trim().toLowerCase();
      const llm = Math.max(0, Math.min(1, llmScores.get(nameKey) ?? 0));
      const ml = (h.ml_implied ?? null);
      const mlWeight = (typeof ml === 'number' && ml >= 0 && ml <= 1) ? ml : 0.0;
      const final = BLEND_ML_WEIGHT * mlWeight + BLEND_LLM_WEIGHT * llm;
      return { name: h.name, llm, ml: mlWeight, final };
    });

    // If everything zero (bad parse), fall back to LLM scores alone
    const allZero = scored.every(s => s.final === 0);
    const fallback = allZero ? scored.map(s => ({ ...s, final: s.llm })) : scored;

    const picks = pickTop3(fallback);
    // crude confidence: spread between top1 and median
    const finals = fallback.map(x => x.final).sort((a, b) => a - b);
    const median = finals[Math.floor(finals.length / 2)];
    const top = Math.max(...finals);
    const confidence = Math.max(0, Math.min(1, top - median)); // 0..1-ish

    return res.status(200).json({
      picks,
      confidence,
      notes: parsed?.notes || null
    });

  } catch (err) {
    console.error('[analyze] error:', err);
    return res.status(500).json({ error: 'analyze_failed', detail: String(err?.message || err) });
  }
}