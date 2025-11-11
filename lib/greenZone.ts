export type Signals = {
  confidence?: number;
  top3Mass?: number;
  gap12?: number;
  gap23?: number;
};

export type GreenZoneSuggestion = 'WinOnly' | 'ATB' | 'ExactaBox' | 'TrifectaBox';
export type GreenZoneTier = 'Green' | 'Yellow' | 'Red';

export type GreenZoneScore = {
  score: number;
  tier: GreenZoneTier;
  suggested: GreenZoneSuggestion;
  note: string;
};

export function scoreGreenZone(signals: Signals): GreenZoneScore {
  const confidence = Math.max(0, Math.min(100, signals.confidence ?? 0));
  const top3Mass = Math.max(0, Math.min(100, signals.top3Mass ?? 0));
  const gap12 = Math.max(0, signals.gap12 ?? 0);
  const gap23 = Math.max(0, signals.gap23 ?? 0);

  const weighted = 0.45 * confidence + 0.35 * top3Mass + 8 * gap12 + 5 * gap23;
  const score = Math.round(Math.min(100, weighted));

  let suggested: GreenZoneSuggestion = 'ATB';
  if (confidence >= 78 && gap12 >= 2) suggested = 'WinOnly';
  else if (top3Mass >= 55 && gap12 + gap23 >= 3.5) suggested = 'TrifectaBox';
  else if (top3Mass >= 52) suggested = 'ExactaBox';

  let tier: GreenZoneTier = 'Red';
  if (score >= 72) tier = 'Green';
  else if (score >= 58) tier = 'Yellow';

  const note = tier === 'Green'
    ? 'Strong edge: confidence/mass plus healthy gaps'
    : tier === 'Yellow'
      ? 'Decent edge; reduce stake or seek better price'
      : 'Skip unless overlay odds';

  return { score, tier, suggested, note };
}
