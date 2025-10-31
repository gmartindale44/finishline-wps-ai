import { scoreHorsesV2 } from "./_openai.js";

export const config = { runtime: 'nodejs' };

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeJson(res, status, obj) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

async function readJson(req, res) {
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString('utf8') || '{}';
    return JSON.parse(raw);
  } catch (e) {
    safeJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    return null;
  }
}

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.status(200).setHeader("Content-Type", "application/json");
      return res.end();
    }
    
    if (req.method !== "POST") {
      return safeJson(res, 405, { ok: false, error: "Method not allowed" });
    }

    const body = await readJson(req, res);
    if (!body) return;

    const { horses, meta } = body || {};
    if (!Array.isArray(horses) || horses.length === 0) {
      return safeJson(res, 400, { ok: false, error: "No horses provided" });
    }

    const analysis = await scoreHorsesV2({ horses, meta });
    if (!analysis.ok) {
      return safeJson(res, 500, { ok: false, error: "Analyze failed", detail: analysis });
    }

    return safeJson(res, 200, {
      ok: true,
      meta: meta || null,
      horseCount: horses.length,
      scores: analysis.scores,   // [{name, score, reason}]
      notes: analysis.notes,
      version: analysis.version
    });
  } catch (err) {
    console.error("[API ERROR analyze]", err);
    return safeJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
