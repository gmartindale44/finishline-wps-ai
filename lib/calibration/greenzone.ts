import { scoreGreenZone } from "../greenZone";
import type { FinishLineLogEntry } from "./logSchema";
import { buildFeatureVector, cosineSim } from "./features";

export interface GreenZoneSuggestion {
  track: string;
  raceNo?: string;
  date: string;
  score: number;
  matchTier: "Green" | "Amber" | "Red";
  suggested: string;
  similarity: number;
  source?: string;
}

const matchTierForScore = (score: number): GreenZoneSuggestion["matchTier"] => {
  if (score >= 75) return "Green";
  if (score >= 60) return "Amber";
  return "Red";
};

export function recommendGreenZone(
  winners: FinishLineLogEntry[],
  pending: FinishLineLogEntry[],
  opts: { maxSuggestions?: number } = {}
): GreenZoneSuggestion[] {
  if (!Array.isArray(winners) || !Array.isArray(pending)) return [];
  if (!winners.length || !pending.length) return [];

  const maxSuggestions = opts.maxSuggestions ?? 15;
  const winnerVectors = winners.map((entry) => ({
    entry,
    vector: buildFeatureVector(entry),
  }));

  const suggestions: GreenZoneSuggestion[] = [];

  pending.forEach((entry) => {
    if (!entry.track) return;
    const vector = buildFeatureVector(entry);
    const base = scoreGreenZone({
      confidence: entry.confidence,
      top3Mass: entry.top3Mass,
      gap12: entry.gap12,
      gap23: entry.gap23,
    });

    let bestSimilarity = 0;
    const neighborStrategies: Record<string, number> = {};

    winnerVectors.forEach(({ entry: winnerEntry, vector: winnerVector }) => {
      const sim = cosineSim(vector, winnerVector);
      if (!Number.isFinite(sim) || sim <= 0) return;
      if (sim > bestSimilarity) bestSimilarity = sim;
      const strat = winnerEntry.suggested || "ATB";
      neighborStrategies[strat] = (neighborStrategies[strat] || 0) + sim;
    });

    const topStrategy =
      Object.entries(neighborStrategies)
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name)[0] || entry.suggested || "ATB";

    const combinedScore = Math.max(
      0,
      Math.min(100, Math.round(base.score * 0.7 + bestSimilarity * 30))
    );

    suggestions.push({
      track: entry.track,
      raceNo: entry.raceNo,
      date: entry.date,
      score: combinedScore,
      matchTier: matchTierForScore(combinedScore),
      suggested: topStrategy,
      similarity: Number(bestSimilarity.toFixed(3)),
      source: entry.source,
    });
  });

  return suggestions
    .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
    .slice(0, maxSuggestions);
}

export function buildGreenZoneToday(
  entries: FinishLineLogEntry[],
  today: string
): GreenZoneSuggestion[] {
  if (!Array.isArray(entries) || !entries.length) return [];

  const winners = entries.filter(
    (entry) => entry.hasResult && (entry.profit ?? 0) > 0
  );

  const pending = entries.filter((entry) => {
    if (entry.hasResult) return false;
    if (!entry.date) return false;
    return entry.date >= today;
  });

  if (!winners.length || !pending.length) return [];

  return recommendGreenZone(winners, pending);
}


