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
 * Compute predmeta coverage metrics
 * @param {Array} rows - Array of parsed CSV row objects
 * @returns {Object} Coverage metrics
 */
function computePredmetaCoverage(rows) {
  if (!rows || rows.length === 0) {
    return {
      totalRows: 0,
      rowsWithConfidence: 0,
      rowsWithT3m: 0,
      rowsWithBoth: 0,
      coverageRate: 0,
    };
  }

  let rowsWithConfidence = 0;
  let rowsWithT3m = 0;
  let rowsWithBoth = 0;

  for (const row of rows) {
    const hasConfidence = row.confidence_pct != null && Number.isFinite(row.confidence_pct);
    const hasT3m = row.t3m_pct != null && Number.isFinite(row.t3m_pct);

    if (hasConfidence) rowsWithConfidence++;
    if (hasT3m) rowsWithT3m++;
    if (hasConfidence && hasT3m) rowsWithBoth++;
  }

  const total = rows.length;
  return {
    totalRows: total,
    rowsWithConfidence,
    rowsWithT3m,
    rowsWithBoth,
    coverageRate: total > 0 ? rowsWithBoth / total : 0,
  };
}

/**
 * Compute accuracy by confidence bucket
 * @param {Array} rows - Array of parsed CSV row objects
 * @returns {Object} Accuracy by confidence bucket
 */
function computeAccuracyByConfidenceBucket(rows) {
  const buckets = {
    "50-60": { races: 0, winHits: 0, top3Hits: 0 },
    "60-70": { races: 0, winHits: 0, top3Hits: 0 },
    "70-80": { races: 0, winHits: 0, top3Hits: 0 },
    "80+": { races: 0, winHits: 0, top3Hits: 0 },
  };

  for (const row of rows) {
    const confidence = row.confidence_pct;
    if (confidence == null || !Number.isFinite(confidence)) continue;

    let bucket = null;
    if (confidence >= 50 && confidence < 60) bucket = "50-60";
    else if (confidence >= 60 && confidence < 70) bucket = "60-70";
    else if (confidence >= 70 && confidence < 80) bucket = "70-80";
    else if (confidence >= 80) bucket = "80+";

    if (bucket) {
      buckets[bucket].races++;
      if (toBoolean(row.winHit)) buckets[bucket].winHits++;
      if (toBoolean(row.top3Hit)) buckets[bucket].top3Hits++;
    }
  }

  const result = {};
  for (const [bucket, stats] of Object.entries(buckets)) {
    if (stats.races > 0) {
      result[bucket] = {
        races: stats.races,
        winHitRate: stats.winHits / stats.races,
        top3HitRate: stats.top3Hits / stats.races,
      };
    }
  }

  return result;
}

/**
 * Compute accuracy by T3M bucket
 * @param {Array} rows - Array of parsed CSV row objects
 * @returns {Object} Accuracy by T3M bucket
 */
function computeAccuracyByT3mBucket(rows) {
  const buckets = {
    "30-40": { races: 0, winHits: 0, top3Hits: 0 },
    "40-50": { races: 0, winHits: 0, top3Hits: 0 },
    "50-60": { races: 0, winHits: 0, top3Hits: 0 },
    "60+": { races: 0, winHits: 0, top3Hits: 0 },
  };

  for (const row of rows) {
    const t3m = row.t3m_pct;
    if (t3m == null || !Number.isFinite(t3m)) continue;

    let bucket = null;
    if (t3m >= 30 && t3m < 40) bucket = "30-40";
    else if (t3m >= 40 && t3m < 50) bucket = "40-50";
    else if (t3m >= 50 && t3m < 60) bucket = "50-60";
    else if (t3m >= 60) bucket = "60+";

    if (bucket) {
      buckets[bucket].races++;
      if (toBoolean(row.winHit)) buckets[bucket].winHits++;
      if (toBoolean(row.top3Hit)) buckets[bucket].top3Hits++;
    }
  }

  const result = {};
  for (const [bucket, stats] of Object.entries(buckets)) {
    if (stats.races > 0) {
      result[bucket] = {
        races: stats.races,
        winHitRate: stats.winHits / stats.races,
        top3HitRate: stats.top3Hits / stats.races,
      };
    }
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

  // Compute predmeta metrics (safe - returns empty objects if no predmeta data)
  const predmetaCoverage = computePredmetaCoverage(normalizedRows);
  const accuracyByConfidence = computeAccuracyByConfidenceBucket(normalizedRows);
  const accuracyByT3m = computeAccuracyByT3mBucket(normalizedRows);

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
    predmeta: {
      coverage: predmetaCoverage,
      accuracyByConfidenceBucket: accuracyByConfidence,
      accuracyByT3mBucket: accuracyByT3m,
    },
  };
}

