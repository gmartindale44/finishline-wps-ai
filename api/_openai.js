import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ANALYZE_MODEL = process.env.ANALYZE_MODEL || 'gpt-4o-mini';
const PREDICT_MODEL = process.env.PREDICT_MODEL || 'gpt-4o-mini';

export async function scoreHorses({ horses, meta }) {
  // Single-shot structured JSON analysis (no web crawl; we weight features)
  const prompt = `
You are a handicapping assistant. Score each horse (0–100) for likely Win, Place, Show
given race metadata and horse rows. Be conservative; do not make up missing facts.
Return JSON with:
{
  "horses": [
    {"name":"...", "scores":{"win":n,"place":n,"show":n}, "signals":["..."] }
  ],
  "confidence": number 0-1,
  "notes": ["..."]
}
Meta: ${JSON.stringify(meta)}
Rows: ${JSON.stringify(horses)}
Scoring weights:
- ML odds (inverse) 25%
- Jockey recent form (proxied by known names / generic prior) 15%
- Trainer signal 15%
- Name overlap hints + position in list (weak prior) 5%
- Surface/Distance heuristic match 15%
- Field parity & uncertainty 25%
Only use information present in inputs; if unknown, keep neutral.
  `.trim();

  const r = await client.chat.completions.create({
    model: ANALYZE_MODEL,
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const text = r.choices?.[0]?.message?.content || "{}";
  let data;
  try { data = JSON.parse(text); }
  catch { data = { horses: [], confidence: 0.35, notes: ["Parser fallback"] }; }

  return data;
}

export async function chooseWPS({ analysis, horses, meta }) {
  // Turn analysis into picks with a small diversity prior
  const prompt = `
Select Win/Place/Show from this analysis. Prefer higher win-score,
but diversify across tickets when win-scores are within 5 points.
Return JSON:
{"win":{"name":"..."},"place":{"name":"..."},"show":{"name":"..."},"confidence":0-1,"notes":["..."]}
Meta: ${JSON.stringify(meta)}
Horses: ${JSON.stringify(horses)}
Analysis: ${JSON.stringify(analysis)}
`.trim();

  const r = await client.chat.completions.create({
    model: PREDICT_MODEL,
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const text = r.choices?.[0]?.message?.content || "{}";
  let data;
  try { data = JSON.parse(text); }
  catch { data = { win:null, place:null, show:null, confidence:0.3, notes:["Parser fallback"] }; }

  return data;
}
