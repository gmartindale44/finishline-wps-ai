import fs from "node:fs";
import path from "node:path";

const DEFAULT_DATASET_PATH = path.join(
  process.cwd(),
  "data",
  "finishline_tests_calibration_v1.csv"
);
const DEFAULT_HISTORICAL_PATH = path.join(
  process.cwd(),
  "data",
  "finishline_historical_v1.csv"
);

const HEADERS = [
  "race_id",
  "track",
  "race_num",
  "bet_type",
  "confidence",
  "top3_mass",
  "gap_1_2",
  "gap_2_3",
  "ai_top_pick",
  "ai_place_pick",
  "ai_show_pick",
  "strategy_flag",
  "wager_results",
  "payout_win",
  "payout_place",
  "payout_show",
  "exotics_hit",
  "profit_loss",
];

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

/**
 * @typedef {Object} FinishLineRow
 * @property {string} race_id
 * @property {string} track
 * @property {number} race_num
 * @property {string} bet_type
 * @property {number} confidence
 * @property {number} top3_mass
 * @property {number} gap_1_2
 * @property {number} gap_2_3
 * @property {string} ai_top_pick
 * @property {string} ai_place_pick
 * @property {string} ai_show_pick
 * @property {string} strategy_flag
 * @property {string} wager_results
 * @property {number} payout_win
 * @property {number} payout_place
 * @property {number} payout_show
 * @property {string} exotics_hit
 * @property {number} profit_loss
 */

/**
 * @typedef {Object} LoadDatasetOptions
 * @property {string} [path]
 * @property {boolean} [silent]
 * @property {boolean} [returnMeta]
 */

/**
 * @param {string} value
 * @returns {number}
 */
function parseNumber(value) {
  if (value === undefined || value === null) return Number.NaN;
  const trimmed = String(value).trim();
  if (!trimmed) return Number.NaN;
  const cleaned = trimmed.replace(/[^0-9+\-\.]/g, "");
  if (!cleaned) return Number.NaN;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((cell) => cell.trim());
}

/**
 * @param {string[]} rawRow
 * @param {boolean} silent
 * @returns {FinishLineRow | null}
 */
function mapRow(rawRow, silent, warn) {
  if (!rawRow.length) return null;
  if (rawRow[0] && rawRow[0].toLowerCase() === "race_id") return null;

  const row = {};
  for (let i = 0; i < HEADERS.length; i += 1) {
    row[HEADERS[i]] = rawRow[i] ?? "";
  }

  if (!row.race_id) return null;

  let invalidNumeric = false;
  const numericValues = {};

  NUMERIC_FIELDS.forEach((field) => {
    const value = parseNumber(row[field]);
    if (!Number.isFinite(value)) {
      invalidNumeric = true;
    }
    numericValues[field] = value;
  });

  if (invalidNumeric) {
    if (!silent && typeof warn === "function") {
      warn(row.race_id);
    }
    return null;
  }

  return /** @type {FinishLineRow} */ ({
    race_id: row.race_id,
    track: row.track || "",
    race_num: numericValues.race_num,
    bet_type: row.bet_type || "",
    confidence: numericValues.confidence,
    top3_mass: numericValues.top3_mass,
    gap_1_2: numericValues.gap_1_2,
    gap_2_3: numericValues.gap_2_3,
    ai_top_pick: row.ai_top_pick || "",
    ai_place_pick: row.ai_place_pick || "",
    ai_show_pick: row.ai_show_pick || "",
    strategy_flag: row.strategy_flag || "",
    wager_results: row.wager_results || "",
    payout_win: numericValues.payout_win,
    payout_place: numericValues.payout_place,
    payout_show: numericValues.payout_show,
    exotics_hit: row.exotics_hit || "",
    profit_loss: numericValues.profit_loss,
  });
}

/**
 * @param {LoadDatasetOptions} [opts]
 * @returns {FinishLineRow[]}
 */
export function loadCleanDataset(opts = {}) {
  const filePath = opts.path
    ? path.isAbsolute(opts.path)
      ? opts.path
      : path.join(process.cwd(), opts.path)
    : DEFAULT_DATASET_PATH;

  const silent = Boolean(opts.silent);

  if (!fs.existsSync(filePath)) {
    throw new Error(`[dataset] Dataset missing at ${filePath}`);
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let skipped = 0;
  const rows = [];
  let warnCount = 0;
  let suppressed = 0;

  const warn = (raceId) => {
    if (silent) return;
    if (warnCount < 10) {
      console.warn(
        "[dataset] Skipping row due to invalid numeric values:",
        raceId
      );
    } else {
      suppressed += 1;
    }
    warnCount += 1;
  };

  for (const line of lines) {
    if (!line) continue;
    const parsed = parseCsvLine(line);
    const mapped = mapRow(parsed, silent, warn);
    if (mapped) {
      rows.push(mapped);
    } else {
      skipped += 1;
    }
  }

  const meta = { skipped, suppressedWarnings: suppressed };

  if (!silent && !opts.returnMeta) {
    console.log(
      `[dataset] Loaded ${rows.length} rows, skipped ${skipped} invalid rows`
    );
  }

  if (opts.returnMeta) {
    if (!silent) {
      console.log(
        `[dataset] Loaded ${rows.length} rows, skipped ${skipped} invalid rows`
      );
      if (suppressed > 0) {
        console.log(
          `[dataset] Additional ${suppressed} rows were skipped without individual warnings`
        );
      }
    }
    return { rows, meta };
  }

  return rows;
}

/**
 * @typedef {Object} LoadMergedDatasetOptions
 * @property {boolean} [silent]
 * @property {string} [mainPath]
 * @property {string} [historicalPath]
 */

/**
 * Load and merge the primary and historical FinishLine datasets.
 * @param {LoadMergedDatasetOptions} [opts]
 */
export function loadMergedDataset(opts = {}) {
  const silent = Boolean(opts.silent);
  const mainPath = opts.mainPath || DEFAULT_DATASET_PATH;
  const historicalPath = opts.historicalPath || DEFAULT_HISTORICAL_PATH;

  const mainResult = loadCleanDataset({
    path: mainPath,
    silent,
    returnMeta: true,
  });

  let historicalResult = {
    rows: /** @type {FinishLineRow[]} */ ([]),
    meta: { skipped: 0, suppressedWarnings: 0 },
  };

  if (historicalPath && fs.existsSync(historicalPath)) {
    try {
      historicalResult = loadCleanDataset({
        path: historicalPath,
        silent,
        returnMeta: true,
      });
    } catch (error) {
      if (!silent) {
        console.warn(
          "[dataset] Failed to load historical dataset",
          error?.message || error
        );
      }
    }
  }

  const mergedMap = new Map();
  for (const row of mainResult.rows) {
    if (!row || !row.race_id) continue;
    mergedMap.set(row.race_id, { row, source: "main" });
  }

  let deduped = 0;
  for (const row of historicalResult.rows) {
    if (!row || !row.race_id) continue;
    if (mergedMap.has(row.race_id)) {
      deduped += 1;
      continue;
    }
    mergedMap.set(row.race_id, { row, source: "historical" });
  }

  const rows = Array.from(mergedMap.values()).map((entry) => entry.row);

  return {
    rows,
    sourceCounts: {
      main_rows: mainResult.rows.length,
      historical_rows: historicalResult.rows.length,
      merged_rows: rows.length,
      deduped,
    },
    meta: {
      main: mainResult.meta,
      historical: historicalResult.meta,
    },
  };
}

/**
 * @param {FinishLineRow} row
 * @returns {number}
 */
export function toROI(row) {
  return Number.isFinite(row.profit_loss) ? row.profit_loss : 0;
}

export const DATASET_HEADERS = HEADERS.slice();


