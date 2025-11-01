// api/_openai.js

import OpenAI from "openai";

export const OPENAI_KEY_NAME = (process.env.FINISHLINE_OPENAI_API_KEY ? "FINISHLINE_OPENAI_API_KEY"
  : (process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "NONE"));

export function resolveOpenAIKey() {
  return process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
}

function client() {
  const key = resolveOpenAIKey();
  if (!key) {
    const e = new Error("OpenAI API key not configured. Checked FINISHLINE_OPENAI_API_KEY and OPENAI_API_KEY.");
    e.status = 500;
    throw e;
  }
  return new OpenAI({ apiKey: key });
}

const MODEL = process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o-mini"; // stable, JSON-friendly

function sysPrompt(meta) {
  const { track, distance, surface } = meta || {};
  return [
    "You are an assistant picking Win/Place/Show for a single thoroughbred race.",
    "Return STRICT JSON only (no prose). Fields: { picks:[{name,slot}], scores:[{name,score}], notes:string }",
    "Consider: ML odds, jockey & trainer quality, distance/surface fit, pace scenario, and risk.",
    `Track: ${track||"unknown"} | Distance: ${distance||"unknown"} | Surface: ${surface||"unknown"}.`,
    "Be conservative when uncertain; avoid longshot stacks unless justified.",
  ].join("\n");
}

export async function llmAnalyze({ horses, meta, temperature=0.1, seed=7 }) {
  const c = client();
  const sys = sysPrompt(meta);
  const user = {
    role: "user",
    content: JSON.stringify({
      horses: horses.map(h => ({
        name: h.name, odds: h.odds || h.ml_odds, jockey: h.jockey, trainer: h.trainer
      })),
      meta
    })
  };

  const resp = await c.chat.completions.create({
    model: MODEL,
    temperature,
    seed,
    response_format: { type: "json_object" },
    messages: [{ role:"system", content: sys }, user]
  });

  const raw = resp?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new Error("LLM returned non-JSON.");
    err.status = 502;
    err.data = { raw };
    throw err;
  }

  // Guard shape
  parsed.picks = Array.isArray(parsed.picks) ? parsed.picks : [];
  parsed.scores = Array.isArray(parsed.scores) ? parsed.scores : [];
  parsed.notes = typeof parsed.notes === "string" ? parsed.notes : "";

  return parsed;
}
