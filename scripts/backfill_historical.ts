import fs from "node:fs";
import path from "node:path";
import {
  loadCleanDataset,
  DATASET_HEADERS,
} from "../lib/calibration/dataset.js";

const OUTPUT_PATH = path.join(
  process.cwd(),
  "data",
  "finishline_historical_v1.csv"
);

const NUMERIC_FIELDS = new Set([
  "race_num",
  "confidence",
  "top3_mass",
  "gap_1_2",
  "gap_2_3",
  "payout_win",
  "payout_place",
  "payout_show",
  "profit_loss",
]);

/** @type {Record<string, string[]>} */
const GENERIC_ALIASES = {
  track: ["track", "track_name", "course", "venue"],
  race_num: ["race_num", "race_number", "race_no", "race"],
  date: ["date", "race_date", "event_date"],
  winner: ["winner", "first", "fin1", "win", "horse_win"],
  place: ["place", "second", "fin2", "runner_up", "horse_place"],
  show: ["show", "third", "fin3", "horse_show"],
  win_payout: [
    "win_payout",
    "win_payoff",
    "win",
    "win_pay",
    "p_win",
    "win_return",
  ],
  place_payout: [
    "place_payout",
    "place_payoff",
    "place",
    "p_place",
    "place_return",
  ],
  show_payout: [
    "show_payout",
    "show_payoff",
    "show",
    "p_show",
    "show_return",
  ],
};

/**
 * @typedef {Record<string, string | number>} FinishLineRow
 */

/**
 * @typedef {{
 *   file: string;
 *   rowsRead: number;
 *   mapped: number;
 *   skipped: number;
 *   duplicates: number;
 * }} FileStats
 */

/**
 * @param {string} line
 * @param {number} [expected]
 */
function parseCsvLine(line, expected) {
  const result = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  if (typeof expected === "number") {
    while (result.length < expected) result.push("");
  }
  return result.map((cell) => cell.trim());
}

/**
 * @param {string} value
 */
function csvEscape(value) {
  if (value === "") return "";
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatValue(header, value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (header === "race_num") {
      return String(Math.round(value));
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(2);
  }
  return String(value);
}

function rowToCsv(row) {
  return DATASET_HEADERS.map((header) => {
    const value = row[header] ?? "";
    if (
      NUMERIC_FIELDS.has(header) &&
      typeof value === "number" &&
      !Number.isFinite(value)
    ) {
      return "";
    }
    return csvEscape(formatValue(header, value));
  }).join(",");
}

function ensureOutputHeader() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    const header = DATASET_HEADERS.join(",");
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${header}\n`, "utf8");
  }
}

function loadExistingIds() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    return new Set();
  }
  try {
    const rows = loadCleanDataset({
      path: OUTPUT_PATH,
      silent: true,
    });
    return new Set(rows.map((row) => row.race_id));
  } catch {
    return new Set();
  }
}

function detectCanonical(headerLine) {
  const parsed = parseCsvLine(headerLine);
  const normalized = parsed.map((cell) => cell.toLowerCase()).join(",");
  return (
    normalized ===
    DATASET_HEADERS.map((cell) => cell.toLowerCase()).join(",")
  );
}

function normalizeDate(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{8}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 8) return digits;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  return null;
}

function slugTrack(track) {
  return track.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

function parseMoney(value) {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function parseInteger(value) {
  if (!value) return null;
  const cleaned = value.replace(/[^\d\-]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapGenericRow(header, rowCells) {
  const lowerHeader = header.map((cell) => cell.toLowerCase());
  const indexOf = (aliases) => {
    for (const alias of aliases) {
      const idx = lowerHeader.indexOf(alias);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const idxTrack = indexOf(GENERIC_ALIASES.track);
  const idxRace = indexOf(GENERIC_ALIASES.race_num);
  const idxDate = indexOf(GENERIC_ALIASES.date);
  const idxWinner = indexOf(GENERIC_ALIASES.winner);

  if (idxTrack === -1 || idxRace === -1 || idxDate === -1 || idxWinner === -1) {
    return null;
  }

  const track = rowCells[idxTrack];
  const raceNum = parseInteger(rowCells[idxRace]);
  const date = normalizeDate(rowCells[idxDate]);
  const winner = rowCells[idxWinner];

  if (!track || raceNum === null || !date || !winner) {
    return null;
  }

  const placeIdx = indexOf(GENERIC_ALIASES.place);
  const showIdx = indexOf(GENERIC_ALIASES.show);
  const winPayoutIdx = indexOf(GENERIC_ALIASES.win_payout);
  const placePayoutIdx = indexOf(GENERIC_ALIASES.place_payout);
  const showPayoutIdx = indexOf(GENERIC_ALIASES.show_payout);

  const place = placeIdx >= 0 ? rowCells[placeIdx] : "";
  const show = showIdx >= 0 ? rowCells[showIdx] : "";

  const payoutWin =
    winPayoutIdx >= 0 ? parseMoney(rowCells[winPayoutIdx]) : 0;
  const payoutPlace =
    placePayoutIdx >= 0 ? parseMoney(rowCells[placePayoutIdx]) : 0;
  const payoutShow =
    showPayoutIdx >= 0 ? parseMoney(rowCells[showPayoutIdx]) : 0;

  const stake = 6; // $2 W/P/S ticket
  const returned = payoutWin + payoutPlace + payoutShow;
  const profitLoss = Number((returned - stake).toFixed(2));

  const raceId = `${slugTrack(track)}-R${raceNum}-${date}`;

  return {
    race_id: raceId,
    track,
    race_num: raceNum,
    bet_type: "WPS",
    confidence: 0,
    top3_mass: 0,
    gap_1_2: 0,
    gap_2_3: 0,
    ai_top_pick: winner,
    ai_place_pick: place,
    ai_show_pick: show,
    strategy_flag: "HISTORICAL",
    wager_results: "HISTORICAL",
    payout_win: payoutWin,
    payout_place: payoutPlace,
    payout_show: payoutShow,
    exotics_hit: "Unknown",
    profit_loss: profitLoss,
  };
}

function appendRows(rows) {
  if (!rows.length) return;
  ensureOutputHeader();
  const payload = rows.map(rowToCsv).join("\n") + "\n";
  fs.appendFileSync(OUTPUT_PATH, payload, "utf8");
}

async function processCanonicalFile(absolutePath, existingIds) {
  const { rows, meta } = loadCleanDataset({
    path: absolutePath,
    silent: true,
    returnMeta: true,
  });

  const mapped = [];
  let duplicates = 0;

  for (const row of rows) {
    if (!row?.race_id) continue;
    if (existingIds.has(row.race_id)) {
      duplicates += 1;
      continue;
    }
    existingIds.add(row.race_id);
    mapped.push(row);
  }

  return {
    rows: mapped,
    stats: {
      file: path.basename(absolutePath),
      rowsRead: rows.length + (meta?.skipped ?? 0),
      mapped: mapped.length,
      skipped: meta?.skipped ?? 0,
      duplicates,
    },
  };
}

async function processGenericFile(absolutePath, existingIds) {
  const raw = fs.readFileSync(absolutePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return {
      rows: [],
      stats: {
        file: path.basename(absolutePath),
        rowsRead: 0,
        mapped: 0,
        skipped: 0,
        duplicates: 0,
      },
    };
  }

  const headerLine = lines.shift();
  if (!headerLine) {
    return {
      rows: [],
      stats: {
        file: path.basename(absolutePath),
        rowsRead: 0,
        mapped: 0,
        skipped: 0,
        duplicates: 0,
      },
    };
  }

  const headerCells = parseCsvLine(headerLine);
  const mappedRows = [];
  let skipped = 0;
  let duplicates = 0;

  for (const line of lines) {
    const cells = parseCsvLine(line, headerCells.length);
    const mapped = mapGenericRow(headerCells, cells);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    const raceId = String(mapped.race_id || "");
    if (!raceId) {
      skipped += 1;
      continue;
    }
    if (existingIds.has(raceId)) {
      duplicates += 1;
      continue;
    }
    existingIds.add(raceId);
    mappedRows.push(mapped);
  }

  return {
    rows: mappedRows,
    stats: {
      file: path.basename(absolutePath),
      rowsRead: lines.length,
      mapped: mappedRows.length,
      skipped,
      duplicates,
    },
  };
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error(
      "Usage: node scripts/backfill_historical.ts <path/to/file.csv> [...more.csv]"
    );
    process.exit(1);
    return;
  }

  const existingIds = loadExistingIds();
  const allNewRows = [];
  const summaries = [];

  for (const input of files) {
    const absolutePath = path.isAbsolute(input)
      ? input
      : path.join(process.cwd(), input);

    if (!fs.existsSync(absolutePath)) {
      console.warn(`[backfill] Skipping missing file: ${absolutePath}`);
      continue;
    }

    const fileContents = fs.readFileSync(absolutePath, "utf8");
    const firstNonEmptyLine =
      fileContents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) || "";

    const canonical = detectCanonical(firstNonEmptyLine);

    const { rows, stats } = canonical
      ? await processCanonicalFile(absolutePath, existingIds)
      : await processGenericFile(absolutePath, existingIds);

    summaries.push(stats);
    if (rows.length) {
      allNewRows.push(...rows);
    }
  }

  appendRows(allNewRows);

  console.log(`[backfill] Wrote ${allNewRows.length} rows to ${OUTPUT_PATH}`);
  for (const summary of summaries) {
    console.log(
      `[backfill] ${summary.file}: mapped=${summary.mapped} skipped=${summary.skipped} duplicates=${summary.duplicates} rowsRead=${summary.rowsRead}`
    );
  }
}

main().catch((err) => {
  console.error("[backfill_historical] Unexpected error", err);
  process.exitCode = 1;
});
