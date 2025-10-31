import OpenAI from "openai";

// Validate API key before creating client
if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY environment variable");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// JSON completion helper (stable, compact)
export async function jsonCompletion({ system, user, temperature = 0.2 }) {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "Missing OPENAI_API_KEY", parseError: false };
  }

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });
    const txt = resp.choices?.[0]?.message?.content?.trim() || "{}";
    try {
      return JSON.parse(txt);
    } catch (parseErr) {
      return { ok: false, error: "Parse failed", parseError: true, raw: txt.substring(0, 200) };
    }
  } catch (err) {
    return { ok: false, error: "OpenAI API failed", detail: String(err?.message || err), parseError: false };
  }
}

// Minimal feature engineering from current rows/meta
export function deriveFeatures(h, meta = {}) {
  const oddsTxt = (h?.odds ?? "").toString().trim(); // e.g., "5/1"
  let mlDecimal = null;
  if (oddsTxt.includes("/")) {
    const [a,b] = oddsTxt.split("/");
    const frac = Number(a) / Number(b);
    if (Number.isFinite(frac)) mlDecimal = frac + 1;
  } else {
    const num = Number(oddsTxt);
    if (Number.isFinite(num)) mlDecimal = num + 1;
  }

  return {
    name: h?.name?.trim() || "",
    odds_text: oddsTxt || null,
    ml_decimal: mlDecimal,
    jockey: h?.jockey || null,
    trainer: h?.trainer || null,
    post: Number.isFinite(h?.post) ? h.post : null,
    surface: meta?.surface || null,
    distance: meta?.distance || null,
    track: meta?.track || null
  };
}

// Stage A: score all horses with reasons (0–100)
export async function scoreHorsesV2({ horses, meta }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const rows = (horses || []).map(h => deriveFeatures(h, meta));

  const system = `
You are a cautious handicapper. Return JSON only (no prose).

Consider, in order: crowd odds signal, trainer/jockey hints, surface/distance/track fit, post bias (if present).

Be concise: numbers + short reasons. Format:

{
  "scores": [{"name":"...", "score":0-100, "reason":"short"}],
  "notes":"1 sentence overall",
  "version":"A2"
}`;
  const user = JSON.stringify({ meta, horses: rows });
  const result = await jsonCompletion({ system, user, temperature: 0.2 });

  if (!result.ok || result.parseError || result.error) {
    throw new Error(`OpenAI response invalid: ${result.error || "Unknown error"}`);
  }

  const scored = (result?.scores || [])
    .filter(s => s?.name)
    .map(s => ({ ...s, score: Math.max(0, Math.min(100, Number(s.score) || 0)) }))
    .sort((a,b) => b.score - a.score);

  if (!scored.length) return { ok:false, error:"No scores", raw: result };
  return { ok:true, version: result?.version || "A2", notes: result?.notes || "", scores: scored };
}

// Stage B: finalize W/P/S using top candidates from Stage A
export async function finalizeWPS({ scores, meta }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const topPack = (scores || []).slice(0, Math.min(8, scores?.length || 0));

  const system = `
Return JSON only. Low randomness. Choose Win/Place/Show from candidates using Stage A scores.

If overall confidence < 0.55, set lowConfidence=true.

Format:

{
  "win":{"name":"...","prob":0-1},
  "place":{"name":"...","prob":0-1},
  "show":{"name":"...","prob":0-1},
  "confidence":0-1,
  "lowConfidence":boolean,
  "version":"B2"
}`;
  const user = JSON.stringify({ meta, candidates: topPack });

  const out = await jsonCompletion({ system, user, temperature: 0.1 });

  if (!out.ok || out.parseError || out.error) {
    throw new Error(`OpenAI response invalid: ${out.error || "Unknown error"}`);
  }

  const clamp = x => Math.max(0, Math.min(1, Number(x)||0));

  return {
    ok:true,
    picks: {
      win:   { name: out?.win?.name   || topPack[0]?.name, prob: clamp(out?.win?.prob) },
      place: { name: out?.place?.name || topPack[1]?.name, prob: clamp(out?.place?.prob) },
      show:  { name: out?.show?.name  || topPack[2]?.name, prob: clamp(out?.show?.prob) },
    },
    confidence: clamp(out?.confidence),
    lowConfidence: !!out?.lowConfidence,
    version: out?.version || "B2"
  };
}
