import { finalizeWPS } from "./_openai.js";

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

    const { analysis, meta } = body || {};
    if (!analysis?.scores?.length) {
      return safeJson(res, 400, { ok: false, error: "Please analyze first" });
    }

    const out = await finalizeWPS({ scores: analysis.scores, meta });
    if (!out.ok) {
      return safeJson(res, 500, { ok: false, error: "Predict failed" });
    }

    return safeJson(res, 200, {
      ok: true,
      picks: out.picks,
      confidence: out.confidence,
      lowConfidence: out.lowConfidence,
      version: out.version
    });
  } catch (err) {
    console.error("[API ERROR predict]", err);
    return safeJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
