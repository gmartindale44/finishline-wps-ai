/**
 * lib/calibration/verify_metrics_v1.js
 * 
 * Compute calibration metrics from verify CSV rows.
 */

/**
 * Normalize a hit value to boolean
 */
function toBoolean(value) {
  if (value === true || value === "true" || value === "True" || value === 1 || value === "1") {
    return true;
  }
  return false;
}

/**
 * Normalize race number to string for grouping
 */
function normalizeRaceNo(raceNo) {
  if (raceNo == null || raceNo === "") return "unknown";
  return String(raceNo).trim();
}

/**
 * Normalize strategy name (default if empty)
 */
function normalizeStrategy(strategyName, version) {
  const s = (strategyName || "").trim() || "default";
  const v = (version || "").trim() || "v1";
  return `${s}@${v}`;
}

/**
 * Compute hit rates for a set of rows
 */
function computeHitRates(rows) {
  if (!rows || rows.length === 0) {
    return {
      races: 0,
      winHitRate: 0,
      placeHitRate: 0,
      showHitRate: 0,
      top3HitRate: 0,
      anyHitRate: 0,
      exactTrifectaRate: 0,
      partialOrderTop3Rate: 0,
    };
  }

  let winHits = 0;
  let placeHits = 0;
  let showHits = 0;
  let top3Hits = 0;
  let anyHits = 0;
  let exactTrifectas = 0;
  let partialOrderTop3 = 0;

  for (const row of rows) {
    const winHit = toBoolean(row.winHit);
    const placeHit = toBoolean(row.placeHit);
    const showHit = toBoolean(row.showHit);
    const top3Hit = toBoolean(row.top3Hit);

    if (winHit) winHits++;
    if (placeHit) placeHits++;
    if (showHit) showHits++;
    if (top3Hit) top3Hits++;
    if (winHit || placeHit || showHit) anyHits++;

    // Exact trifecta: all three positions match
    const exactMatch =
      row.predWin &&
      row.predPlace &&
      row.predShow &&
      row.outWin &&
      row.outPlace &&
      row.outShow &&
      row.predWin.trim().toLowerCase() === row.outWin.trim().toLowerCase() &&
      row.predPlace.trim().toLowerCase() === row.outPlace.trim().toLowerCase() &&
      row.predShow.trim().toLowerCase() === row.outShow.trim().toLowerCase();
    if (exactMatch) exactTrifectas++;

    // Partial order top3: top3Hit already captures this
    if (top3Hit) partialOrderTop3++;
  }

  const total = rows.length;
  return {
    races: total,
    winHitRate: total > 0 ? winHits / total : 0,
    placeHitRate: total > 0 ? placeHits / total : 0,
    showHitRate: total > 0 ? showHits / total : 0,
    top3HitRate: total > 0 ? top3Hits / total : 0,
    anyHitRate: total > 0 ? anyHits / total : 0,
    exactTrifectaRate: total > 0 ? exactTrifectas / total : 0,
    partialOrderTop3Rate: total > 0 ? partialOrderTop3 / total : 0,
  };
}

/**
 * Compute metrics grouped by track
 */
function computeByTrack(rows, minTrackSampleSize = 10) {
  const byTrack = {};

  for (const row of rows) {
    const track = (row.track || "").trim() || "unknown";
    if (!byTrack[track]) {
      byTrack[track] = [];
    }
    byTrack[track].push(row);
  }

  const result = {};
  for (const [track, trackRows] of Object.entries(byTrack)) {
    if (trackRows.length >= minTrackSampleSize) {
      const rates = computeHitRates(trackRows);
      result[track] = {
        races: rates.races,
        winHitRate: rates.winHitRate,
        top3HitRate: rates.top3HitRate,
      };
    }
  }

  return result;
}

/**
 * Compute metrics grouped by race number
 */
function computeByRaceNo(rows) {
  const byRaceNo = {};

  for (const row of rows) {
    const raceNo = normalizeRaceNo(row.raceNo);
    if (!byRaceNo[raceNo]) {
      byRaceNo[raceNo] = [];
    }
    byRaceNo[raceNo].push(row);
  }

  const result = {};
  for (const [raceNo, raceRows] of Object.entries(byRaceNo)) {
    const rates = computeHitRates(raceRows);
    result[raceNo] = {
      races: rates.races,
      winHitRate: rates.winHitRate,
      top3HitRate: rates.top3HitRate,
    };
  }

  return result;
}

/**
 * Compute metrics grouped by strategy
 */
function computeByStrategy(rows) {
  const byStrategy = {};

  for (const row of rows) {
    const strategy = normalizeStrategy(row.strategyName, row.version);
    if (!byStrategy[strategy]) {
      byStrategy[strategy] = [];
    }
    byStrategy[strategy].push(row);
  }

  const result = {};
  for (const [strategy, strategyRows] of Object.entries(byStrategy)) {
    const rates = computeHitRates(strategyRows);
    result[strategy] = {
      races: rates.races,
      winHitRate: rates.winHitRate,
      top3HitRate: rates.top3HitRate,
    };
  }

  return result;
}

/**
 * Main function to compute all verify metrics v1
 * @param {Array} rows - Array of parsed CSV row objects
 * @param {Object} options - Options (source, filteredRows, etc.)
 * @returns {Object} Metrics object
 */
export function computeVerifyMetricsV1(rows, options = {}) {
  const source = options.source || "finishline_tests_calibration_v1.csv";
  const filteredRows = options.filteredRows || rows.length;
  const totalRows = options.totalRows || rows.length;

  // Normalize hit flags to booleans
  const normalizedRows = rows.map((row) => ({
    ...row,
    winHit: toBoolean(row.winHit),
    placeHit: toBoolean(row.placeHit),
    showHit: toBoolean(row.showHit),
    top3Hit: toBoolean(row.top3Hit),
  }));

  const global = computeHitRates(normalizedRows);
  const byTrack = computeByTrack(normalizedRows, 10);
  const byRaceNo = computeByRaceNo(normalizedRows);
  const byStrategy = computeByStrategy(normalizedRows);

  return {
    meta: {
      source,
      generatedAt: new Date().toISOString(),
      totalRows,
      filteredRows,
    },
    global,
    byTrack,
    byRaceNo,
    byStrategy,
  };
}

