import OpenAI from 'openai';

export function resolveOpenAIKey() {
  const key =
    process.env.FINISHLINE_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  return key.trim();
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

export async function scoreHorses({ horses = [], meta = {} }) {
  if (!Array.isArray(horses) || horses.length === 0) {
    const e = new Error('No horses provided');
    e.status = 400;
    throw e;
  }

  const system = `You are a handicapping assistant. Return STRICT JSON with keys:
  - "scores": array of { "horse": string, "win": number, "place": number, "show": number }
  - "features": optional debugging info
  DO NOT include prose, only JSON.`;

  const user = { horses, meta };

  const res = await jsonCompletion({ system, user });
  if (!res.ok) {
    const e = new Error(res.error || 'LLM scoring failed');
    e.status = 502;
    e.detail = res.detail || res.raw;
    throw e;
  }

  const data = res.data || {};
  if (!Array.isArray(data.scores)) {
    const e = new Error('Response missing scores[]');
    e.status = 502;
    e.detail = data;
    throw e;
  }

  data.horseCount = horses.length;
  return data;
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
