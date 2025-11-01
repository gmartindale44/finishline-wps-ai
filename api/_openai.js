import OpenAI from "openai";
import { impliedFromOdds, normalizeProbs } from "./research.js";

export const OPENAI_KEY_NAME = 'FINISHLINE_OPENAI_API_KEY';

export function resolveOpenAIKey() {
  // Prefer project key, fallback to default OPENAI_API_KEY
  const key = process.env[OPENAI_KEY_NAME] || process.env.OPENAI_API_KEY;
  if (!key || typeof key !== 'string' || key.trim().length < 20) {
    const tried = [OPENAI_KEY_NAME, 'OPENAI_API_KEY'].filter(Boolean).join(', ');
    const hint =
      'Missing OpenAI API key. Ensure the key is set for BOTH Production & Preview in Vercel → Settings → Environment Variables.';
    const note = `Tried: ${tried}`;
    throw new Error(`${hint} ${note}`);
  }
  return key.trim();
}

export function client() {
  return new OpenAI({ apiKey: resolveOpenAIKey() });
}

export async function scoreHorses({ horses = [], meta = {}, research = {}, accuracy = 'deep', mode = {} }) {
  const client = new OpenAI({ apiKey: resolveOpenAIKey() });
  // Build strong, *grounded* system message that forces JSON and on-list names only.
  // Also provide baseline probabilities to anchor the model.
  const names = horses.map(h => h.name);
  const baseMap = {};
  horses.forEach(h => baseMap[h.name] = impliedFromOdds(h.odds || h.ml_odds));
  const baseline = normalizeProbs(names, baseMap);
  
  // Support mode.deep and mode.consensus_passes (default: 3 passes for deep mode)
  const isDeep = mode?.deep !== false && (accuracy === 'deep' || mode?.deep === true);
  const passes = isDeep ? (mode?.consensus_passes || 3) : 1;

  const sys = [
    'You are a disciplined horse-racing model.',
    'Only use the horses provided. Output strict JSON matching the schema.',
    'Start from baseline probabilities (implied from odds) and only adjust modestly.',
    'Be conservative on longshots unless strong corroboration exists.',
  ].join(' ');

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
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

  // Multi-pass consensus (N passes based on mode)
  const results = [];
  for (let i = 0; i < passes; i++) {
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

  // Calculate consensus agreement (how similar are the passes?)
  let agreement = 1.0;
  if (results.length > 1) {
    // Compare top picks across passes
    const topPicks = results.map(r => {
      const sorted = [...(r.scores || [])].sort((a,b)=>b.win-a.win);
      return sorted.slice(0, 3).map(s => s.name);
    });
    // Simple agreement: count how many times top pick matches
    const topMatchCount = topPicks.filter(p => p[0] === topPicks[0][0]).length;
    agreement = topMatchCount / passes;
  }

  return {
    scores: merged,
    meta: { confidence },
    consensus: isDeep ? { passes, agreement: Number(agreement.toFixed(2)) } : null
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

/**
 * Vision extraction for racing entries tables (not horse photos).
 * Accepts: base64 image/PDF page(s). Returns normalized horses[].
 */
export async function extractEntriesFromImages({ files, meta = {} }) {
  const c = client();
  // Prefer a small, fast, vision-capable model that supports json_schema.
  const model = process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o-mini";

  // Build the content array for vision (multiple images or pdf pages already b64)
  const contents = [];
  for (const f of files) {
    if (!f?.data || !f?.mime) continue;
    contents.push({ type: "image_url", image_url: { url: `data:${f.mime};base64,${f.data}` } });
  }
  if (contents.length === 0) {
    return { horses: [], meta, notes: ["no_files_supplied"] };
  }

  // JSON schema forces a consistent response
  const schema = {
    name: "entries",
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {
        horses: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              name: { type: "string" },
              odds: { type: "string" },      // keep original fractional string like "5/1" or "EVS"
              jockey: { type: "string" },
              trainer: { type: "string" }
            },
            required: ["name"]
          }
        },
        notes: { type: "array", items: { type: "string" } }
      },
      required: ["horses"]
    }
  };

  const sys = [
    "You extract RACING ENTRIES from screenshots or PDFs of entries tables.",
    "These are NOT photos of horses. Expect columns like: Horse, ML Odds, Jockey, Trainer.",
    "Return the CLEANEST possible list; each object is one horse.",
    "Normalize fields:",
    "- name: trim whitespace/caps sensibly; drop entry numbers, emojis, glyphs.",
    "- odds: keep the visible odds string (e.g., '5/1', '15/1', 'Evens', 'EVS').",
    "  Convert common variants to canonical strings: 'EVS','Evens' -> '1/1'.",
    "  If odds missing, set odds to an empty string.",
    "- jockey/trainer: trim; if missing, use empty string.",
    "Ignore results tables. Only extract the entries list.",
  ].join(" ");

  const msg = [
    { role: "system", content: sys },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract entries (horse, odds, jockey, trainer). Return JSON only." },
        ...contents
      ]
    }
  ];

  const resp = await c.chat.completions.create({
    model,
    messages: msg,
    temperature: 0.2,
    response_format: { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema, strict: false } },
  });

  let raw = "{}";
  try {
    raw = resp?.choices?.[0]?.message?.content || "{}";
  } catch (e) {
    console.error("⚠️ No message content from model:", e);
  }

  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("⚠️ JSON parse error:", err, "raw:", raw.slice(0, 200));
    parsed = { horses: [] };
  }
  const horses = Array.isArray(parsed.horses) ? parsed.horses : [];

  // Post-normalize (dedupe by name, fix common OCR odds mistakes)
  const seen = new Set();
  const norm = (s="") => s.replace(/\s+/g, " ").trim();
  const fixOdds = (v="") => {
    const t = v.trim().toUpperCase();
    if (!t) return "";
    if (t === "EVS" || t === "EVENS") return "1/1";
    // Fix OCR 'l/1' -> '1/1', 'I/1' -> '1/1', 'S/I' -> '5/1'
    const m = t.replace(/[IL]/g, "1").replace("S/1", "5/1").replace("O/1", "0/1");
    return m;
  };
  const out = [];
  for (const h of horses) {
    const name = norm(h.name || "");
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      odds: fixOdds(h.odds || ""),
      jockey: norm(h.jockey || ""),
      trainer: norm(h.trainer || "")
    });
  }
  return { horses: out, meta, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
}

// Minimal OpenAI client (no SDK dependency assumptions)
export async function openaiJSON({ url, body }) {
  const apiKey = resolveOpenAIKey();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

// Turn parsed text into normalized horse rows: [{name, odds, jockey, trainer}]
export function normalizeHorsesFromText(lines) {
  // very forgiving parser: "Name | ML | Jockey | Trainer" or with spaces
  const out = [];
  for (const raw of lines) {
    const line = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!line) continue;
    // try: split by pipe first, else collapse multiple spaces
    let cols = line.includes('|')
      ? line.split('|').map(s => s.trim())
      : line.split(/\s{2,}/).map(s => s.trim());
    // Heuristics: expect at least "name" + something
    const [name, odds, jockey, trainer] = [
      cols[0] || '',
      cols[1] || '',
      cols[2] || '',
      cols[3] || '',
    ].map(s => s.trim());
    if (name && name.length > 1) {
      out.push({ name, odds, jockey, trainer });
    }
  }
  return out;
}
