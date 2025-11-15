import { loadMergedDataset } from "../../lib/calibration/dataset.js";
import { scoreGreenZone } from "../../lib/greenZone";

const MIN_CONFIDENCE = 60;
const MIN_TOP3 = 50;
const MAX_SUGGESTIONS = 12;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const dataset = loadMergedDataset({ silent: true });
    const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
    const suggestions = buildPatternSuggestions(rows);

    if (!suggestions.length) {
      return res.status(200).json({
        ok: true,
        suggestions: [],
        reason: "not_enough_data_yet",
        sourceCounts: dataset?.sourceCounts,
      });
    }

    return res.status(200).json({
      ok: true,
      suggestions,
      sourceCounts: dataset?.sourceCounts,
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[greenzone_today] error", message);
    return res.status(500).json({
      ok: false,
      error: "greenzone_today failed",
      details: message,
    });
  }
}

function buildPatternSuggestions(rows = []) {
  const filtered = rows.filter((row) => {
    const confidence = Number(row.confidence);
    const top3 = Number(row.top3_mass ?? row.top3Mass);
    const profit = Number(row.profit_loss ?? row.profitLoss);
    if (!Number.isFinite(confidence) || !Number.isFinite(top3)) return false;
    if (confidence < MIN_CONFIDENCE || top3 < MIN_TOP3) return false;
    if (!Number.isFinite(profit) || profit <= 0) return false;
    return true;
  });

  const scored = filtered
    .map((row) => {
      const confidence = Number(row.confidence) || 0;
      const top3 = Number(row.top3_mass ?? row.top3Mass) || 0;
      const gap12 = Number(row.gap_1_2 ?? row.gap12) || 0;
      const gap23 = Number(row.gap_2_3 ?? row.gap23) || 0;
      const profit = Number(row.profit_loss ?? row.profitLoss) || 0;

      const gz = scoreGreenZone({
        confidence,
        top3Mass: top3,
        gap12,
        gap23,
      });

      const tier = gz.tier === "Yellow" ? "Amber" : gz.tier;

      return {
        track: row.track || "",
        raceNo:
          Number.isFinite(row.race_num) && row.race_num !== null
            ? String(row.race_num)
            : undefined,
        raceId: row.race_id || "",
        score: gz.score,
        matchTier: tier,
        suggested: gz.suggested,
        note: gz.note,
        confidence,
        top3Mass: top3,
        gap12,
        gap23,
        profitLoss: profit,
        source: "historical_pattern",
      };
    })
    .filter((entry) => entry.track && entry.raceId);

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.profitLoss - a.profitLoss ||
        (b.confidence ?? 0) - (a.confidence ?? 0)
    )
    .slice(0, MAX_SUGGESTIONS);
}

