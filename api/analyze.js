import { scoreHorsesV2 } from "./_openai.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req, res) {
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString('utf8') || '{}';
    return JSON.parse(raw);
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return null;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = await readJson(req, res);
    if (!body) return;

    const { horses, meta } = body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: "No horses provided" });
    }

    const analysis = await scoreHorsesV2({ horses, meta });
    if (!analysis.ok) return res.status(500).json({ error:"Analyze failed", detail:analysis });

    return res.status(200).json({
      ok:true,
      meta: meta || null,
      horseCount: horses.length,
      scores: analysis.scores,   // [{name, score, reason}]
      notes: analysis.notes,
      version: analysis.version
    });
  } catch (err) {
    console.error("[API ERROR analyze]", err);
    return res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
}
