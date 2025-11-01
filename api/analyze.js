// api/analyze.js

import { llmAnalyze } from "./_openai.js";
import { scoreDeterministic } from "./_scoring.js";

export const config = { runtime: "nodejs" };

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FINISHLINE_ALLOWED_ORIGINS || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normName(s){ return String(s||"").trim(); }

function buildConsensus(listOfAnalyses, horses) {
  const byName = new Map(horses.map(h => [normName(h.name), { name:normName(h.name), votes:0, scoreSum:0 }]));

  for (const a of listOfAnalyses) {
    for (const sc of a.scores || []) {
      const key = normName(sc.name);
      if (!byName.has(key)) continue;
      const row = byName.get(key);
      row.votes += 1;
      const v = Number(sc.score||0);
      row.scoreSum += isFinite(v) ? v : 0;
    }

    for (const p of a.picks || []) {
      const key = normName(p.name);
      if (!byName.has(key)) continue;
      const slotBoost = p.slot === "win" ? 0.25 : p.slot === "place" ? 0.15 : 0.1;
      byName.get(key).scoreSum += slotBoost;
    }
  }

  const rows = [...byName.values()].map(r => ({
    name: r.name,
    votes: r.votes,
    avgScore: r.votes ? (r.scoreSum / r.votes) : 0
  }));

  rows.sort((a,b) => (b.avgScore - a.avgScore) || (b.votes - a.votes));
  return rows;
}

function fuseDeterministic(consRows, detRows) {
  const detMap = new Map(detRows.map(r => [normName(r.name), r]));
  const fused = consRows.map(r => {
    const d = detMap.get(normName(r.name));
    const det = d?.detNorm ?? 0.5;

    // Blend 60% consensus + 40% deterministic
    const blended = 0.6 * r.avgScore + 0.4 * det;

    return { name: r.name, consensus: r.avgScore, det, blended };
  });

  fused.sort((a,b)=>b.blended - a.blended);
  return fused;
}

function chooseWPS(fused) {
  const top = fused.slice(0, 6); // small shortlist
  const win = top[0]?.name;
  const place = top[1]?.name;
  const show = top[2]?.name;

  // Confidence: margin between 1st and 2nd + low variance bonus
  const m1 = (top[0]?.blended ?? 0) - (top[1]?.blended ?? 0);
  const m2 = (top[1]?.blended ?? 0) - (top[2]?.blended ?? 0);
  const conf = Math.max(0, Math.min(1, 0.55*m1 + 0.35*m2 + 0.10)); // clamp

  return { picks: [{slot:"win", name:win},{slot:"place",name:place},{slot:"show",name:show}], confidence: conf };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { horses, meta, mode } = req.body || {};

    if (!Array.isArray(horses) || !horses.length) {
      return res.status(400).json({ error: "No horses provided" });
    }

    // Deterministic baseline
    const detRows = scoreDeterministic(horses);

    let analyses = [];

    if (mode === "deep") {
      // 3 parallel JSON-locked passes with slight seeds
      const [a1,a2,a3] = await Promise.all([
        llmAnalyze({ horses, meta, temperature: 0.1, seed: 7 }),
        llmAnalyze({ horses, meta, temperature: 0.15, seed: 17 }),
        llmAnalyze({ horses, meta, temperature: 0.2, seed: 27 })
      ]);
      analyses = [a1,a2,a3];
    } else {
      analyses = [await llmAnalyze({ horses, meta, temperature: 0.1, seed: 7 })];
    }

    const consensus = buildConsensus(analyses, horses);

    // Normalize consensus avgScores to 0..1
    const maxC = Math.max(...consensus.map(r=>r.avgScore), 1e-6);
    consensus.forEach(r => r.avgScore = maxC ? r.avgScore / maxC : 0);

    const fused = fuseDeterministic(consensus, detRows);
    const { picks, confidence } = chooseWPS(fused);

    return res.status(200).json({
      ok: true,
      mode: mode || "standard",
      picks,
      confidence,                       // 0..1 (UI can show %)
      fused,                            // for debug overlay if needed
      deterministicTop: detRows.slice(0,5),
    });
  } catch (err) {
    console.error("[API ERROR analyze]", err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: String(err?.message || err),
      data: err?.data || null
    });
  }
}
