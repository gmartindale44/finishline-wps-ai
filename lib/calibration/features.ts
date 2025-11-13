import type { FinishLineLogEntry } from "./logSchema";

export function buildFeatureVector(entry: FinishLineLogEntry): number[] {
  const confidence = sanitize(entry.confidence);
  const top3Mass = sanitize(entry.top3Mass);
  const gap12 = sanitize(entry.gap12);
  const gap23 = sanitize(entry.gap23);
  const fieldSize = sanitize(entry.fieldSize);
  const distance = sanitize(entry.distanceF);
  const surface =
    entry.surface === "Turf" ? 1 : entry.surface === "Synthetic" ? 0.5 : entry.surface ? 0 : 0;

  return [confidence, top3Mass, gap12, gap23, fieldSize, distance, surface];
}

function sanitize(value: number | undefined): number {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return Number(value);
}

export function cosineSim(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function euclideanDist(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}


