export type LogSource = "predict" | "verify" | "backfill";

export interface FinishLineLogEntry {
  id: string;
  timestamp: number;
  date: string;
  track: string;
  raceNo?: string;
  distanceF?: number;
  surface?: string;
  fieldSize?: number;
  confidence?: number;
  top3Mass?: number;
  gap12?: number;
  gap23?: number;
  suggested?: string;
  stake?: number;
  profit?: number;
  winHorse?: string;
  placeHorse?: string;
  showHorse?: string;
  hits?: {
    winHit?: boolean;
    placeHit?: boolean;
    showHit?: boolean;
    top3Hit?: boolean;
  };
  hasResult: boolean;
  source: LogSource;
  raw?: Record<string, unknown>;
}

function parseNumber(value: unknown, multiplier = 1): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return num * multiplier;
}

function parsePercent(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const cleaned = String(value).replace(/[^0-9+\-\.]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return undefined;
  return num / 100;
}

function ensureDate(value: string | undefined): string {
  if (!value) return todayISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  try {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    }
  } catch {
    /* ignore */
  }
  return todayISO();
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function entryFromRedisHash(
  key: string,
  hash: Record<string, string>
): FinishLineLogEntry | null {
  try {
    const id = hash.race_id || key.replace(/^fl:pred:/, "");
    if (!id) return null;

    const created = parseNumber(hash.created_ts);
    const resolved = parseNumber(hash.resolved_ts);
    const timestamp = resolved || created || Date.now();

    const confidenceRaw = parseNumber(hash.confidence);
    const confidence =
      confidenceRaw !== undefined
        ? confidenceRaw <= 1
          ? confidenceRaw * 100
          : confidenceRaw
        : undefined;

    const top3Raw = parseNumber(hash.top3_mass);
    const top3Mass =
      top3Raw !== undefined
        ? top3Raw <= 1
          ? top3Raw * 100
          : top3Raw
        : undefined;

    const hits: FinishLineLogEntry["hits"] = {
      winHit: hash.winHit === "true" || hash.winHit === "1",
      placeHit: hash.placeHit === "true" || hash.placeHit === "1",
      showHit: hash.showHit === "true" || hash.showHit === "1",
      top3Hit: hash.top3Hit === "true" || hash.top3Hit === "1",
    };

    const hasResult =
      hash.status === "resolved" ||
      hits.winHit ||
      hits.placeHit ||
      hits.showHit ||
      hits.top3Hit;

    return {
      id,
      timestamp,
      date: ensureDate(hash.date),
      track: hash.track || "",
      raceNo: hash.raceNo || hash.race_no || "",
      distanceF: parseNumber(hash.distanceF),
      surface: hash.surface || undefined,
      fieldSize: parseNumber(hash.field_size),
      confidence,
      top3Mass,
      gap12: parseNumber(hash.gap12),
      gap23: parseNumber(hash.gap23),
      suggested: hash.strategy || undefined,
      stake: 1,
      profit: parsePercent(hash.roi_percent),
      winHorse: hash.win || hash.winHorse || undefined,
      placeHorse: hash.place || hash.placeHorse || undefined,
      showHorse: hash.show || hash.showHorse || undefined,
      hits,
      hasResult,
      source: hasResult ? "verify" : "predict",
      raw: hash,
    };
  } catch {
    return null;
  }
}

export function entryFromReconciliationRow(
  row: Record<string, string>
): FinishLineLogEntry | null {
  try {
    const id =
      row.raceNo && row.track && row.date
        ? `${row.track}:${row.date}:R${row.raceNo}`
        : row.track
        ? `${row.track}:${row.date || todayISO()}`
        : row.query || "";
    if (!id) return null;

    const timestamp = parseNumber(row.ts) || Date.now();
    const hits: FinishLineLogEntry["hits"] = {
      winHit: row.winHit === "1" || row.winHit === "true",
      placeHit: row.placeHit === "1" || row.placeHit === "true",
      showHit: row.showHit === "1" || row.showHit === "true",
      top3Hit: row.top3Hit === "1" || row.top3Hit === "true",
    };

    return {
      id,
      timestamp,
      date: ensureDate(row.date),
      track: row.track || "",
      raceNo: row.raceNo || "",
      distanceF: undefined,
      surface: undefined,
      fieldSize: undefined,
      confidence: undefined,
      top3Mass: undefined,
      gap12: undefined,
      gap23: undefined,
      suggested: undefined,
      stake: 1,
      profit: undefined,
      winHorse: undefined,
      placeHorse: undefined,
      showHorse: undefined,
      hits,
      hasResult: true,
      source: "verify",
      raw: row,
    };
  } catch {
    return null;
  }
}

export function mergeLogEntries(
  existing: FinishLineLogEntry[],
  incoming: FinishLineLogEntry[]
): FinishLineLogEntry[] {
  const map = new Map<string, FinishLineLogEntry>();

  const upsert = (entry: FinishLineLogEntry) => {
    if (!entry.id) return;
    const current = map.get(entry.id);
    if (!current) {
      map.set(entry.id, entry);
      return;
    }
    const preferIncoming =
      (!!entry.hasResult && !current.hasResult) ||
      ((entry.profit ?? 0) !== undefined && (current.profit ?? undefined) === undefined);
    if (preferIncoming) {
      map.set(entry.id, { ...current, ...entry });
    } else {
      map.set(entry.id, { ...entry, ...current });
    }
  };

  existing.forEach(upsert);
  incoming.forEach(upsert);

  return Array.from(map.values());
}


