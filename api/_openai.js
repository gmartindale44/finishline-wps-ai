import OpenAI from "openai";
import { impliedFromOdds, normalizeProbs } from "./research.js";

export function resolveOpenAIKey() {
  const k = process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OpenAI key not found (FINISHLINE_OPENAI_API_KEY or OPENAI_API_KEY)');
  return k;
}

export async function scoreHorses({ horses = [], meta = {}, research = {}, accuracy = 'deep' }) {
  const client = new OpenAI({ apiKey: resolveOpenAIKey() });
  // Build strong, *grounded* system message that forces JSON and on-list names only.
  // Also provide baseline probabilities to anchor the model.
  const names = horses.map(h => h.name);
  const baseMap = {};
  horses.forEach(h => baseMap[h.name] = impliedFromOdds(h.odds || h.ml_odds));
  const baseline = normalizeProbs(names, baseMap);

  const sys = [
    'You are a disciplined horse-racing model.',
    'Only use the horses provided. Output strict JSON matching the schema.',
    'Start from baseline probabilities (implied from odds) and only adjust modestly.',
    'Be conservative on longshots unless strong corroboration exists.',
  ].join(' ');

  const schema = {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            win: { type: "number" },
            place: { type: "number" },
            show: { type: "number" }
          },
          required: ["name","win","place","show"]
        }
      }
    },
    required: ["scores"]
  };

  const user = {
    role: "user",
    content: JSON.stringify({
      horses,
      meta,
      baseline,
      researchSnippet: research?.notes?._joined || "",
      rules: {
        only_names: names,
        json_required: true
      }
    })
  };

  async function onePass() {
    const r = await client.chat.completions.create({
      model: process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_schema", json_schema: { name: "wps", schema, strict: true } },
      temperature: 0.1,
      messages: [
        { role: "system", content: sys },
        user
      ]
    });
    return r.choices?.[0]?.message?.content || "{}";
  }

  function repair(raw) {
    try { JSON.parse(raw); return raw; } catch {
      // very small, local repair if the model strayed
      const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const slice = raw.slice(start, end + 1);
        try { JSON.parse(slice); return slice; } catch {}
      }
      return '{"scores":[]}';
    }
  }

  // Multi-pass consensus (3 passes)
  const results = [];
  for (let i = 0; i < 3; i++) {
    const txt = await onePass();
    const fixed = repair(txt);
    const json = JSON.parse(fixed);
    results.push(json);
  }

  // Merge by averaging
  const acc = {};
  for (const names of horses.map(h=>h.name)) {
    acc[names] = { win:0, place:0, show:0, c:0 };
  }
  for (const r of results) {
    for (const s of (r.scores||[])) if (acc[s.name]) {
      acc[s.name].win += s.win; acc[s.name].place += s.place; acc[s.name].show += s.show; acc[s.name].c++;
    }
  }
  const merged = Object.entries(acc).map(([name,v])=>({
    name,
    win: v.c? v.win/v.c : baseline[name],
    place: v.c? v.place/v.c : baseline[name]*0.75,
    show: v.c? v.show/v.c : baseline[name]*0.55,
  }));

  // Final clamp + renorm on win line (for confidence calc)
  const sumWin = merged.reduce((s,m)=>s+m.win,0) || 1;
  merged.forEach(m=> m.win = m.win / sumWin);
  merged.sort((a,b)=>b.win - a.win);
  const confidence = Math.max(0, Math.min(1, (merged[0].win - (merged[1]?.win||0)) * 1.6));

  return {
    scores: merged,
    meta: { confidence }
  };
}

export async function finalizeWPS({ scores = [] }) {
  // pick top 3 by win prob as final Win/Place/Show
  const sorted = [...scores].sort((a,b)=>b.win-a.win).slice(0,3);
  return {
    win: sorted[0]?.name || null,
    place: sorted[1]?.name || null,
    show: sorted[2]?.name || null,
    confidence: Math.round(((sorted[0]?.win || 0) - (sorted[1]?.win || 0)) * 100),
  };
}
