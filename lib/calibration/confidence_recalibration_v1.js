/**
 * lib/calibration/confidence_recalibration_v1.js
 * 
 * Confidence recalibration using isotonic regression (PAVA algorithm).
 * Maps raw confidence percentages to calibrated values based on observed win rates.
 */

/**
 * Pool-Adjacent-Violators Algorithm (PAVA) for isotonic regression
 * Ensures monotonic non-decreasing mapping
 * 
 * @param {Array<{raw: number, observed: number, count: number}>} buckets - Bucket data with raw confidence, observed win rate, and count
 * @returns {Array<{raw: number, calibrated: number, count: number}>} - Calibrated buckets (monotonic)
 */
function poolAdjacentViolators(buckets) {
  if (!buckets || buckets.length === 0) {
    return [];
  }

  // Sort by raw confidence (ascending)
  const sorted = [...buckets].sort((a, b) => a.raw - b.raw);
  
  // PAVA: merge adjacent buckets that violate monotonicity
  const result = [];
  let i = 0;
  
  while (i < sorted.length) {
    let current = { ...sorted[i] };
    let j = i + 1;
    
    // Look ahead and merge if next bucket has lower observed rate
    while (j < sorted.length && current.observed > sorted[j].observed) {
      // Merge: weighted average of observed rates
      const totalCount = current.count + sorted[j].count;
      const weightedObserved = (current.observed * current.count + sorted[j].observed * sorted[j].count) / totalCount;
      
      current = {
        raw: current.raw, // Keep min raw value
        observed: weightedObserved,
        count: totalCount,
      };
      j++;
    }
    
    result.push({
      raw: current.raw,
      calibrated: current.observed, // Calibrated value = observed win rate
      count: current.count,
    });
    
    i = j;
  }
  
  return result;
}

/**
 * Build confidence recalibration mapping from calibration data
 * 
 * @param {Array} rows - Calibration CSV rows with raw_confidence_pct and winHit
 * @param {Object} options - Options (minSampleSize, bucketSize)
 * @returns {Object|null} - Recalibration mapping object or null if insufficient data
 */
export function buildConfidenceRecalibration(rows, options = {}) {
  const minSampleSize = options.minSampleSize || 300;
  const bucketSize = options.bucketSize || 5; // 5% buckets (0-5, 5-10, ..., 95-100)
  
  // Filter rows with valid raw confidence
  // Prefer raw_confidence (0-100, 1 decimal) > raw_confidence_pct > confidence_pct
  const validRows = rows.filter((row) => {
    const rawConf = row.raw_confidence ?? row.raw_confidence_pct ?? row.confidence_pct;
    return rawConf != null && Number.isFinite(rawConf) && rawConf >= 0 && rawConf <= 100;
  });
  
  if (validRows.length < minSampleSize) {
    return {
      mapping: null,
      sampleSize: validRows.length,
      minSampleSize,
      fallback: true, // Identity mapping (calibrated = raw)
      buckets: [],
    };
  }
  
  // Group into buckets (0-5, 5-10, ..., 95-100)
  const bucketMap = new Map();
  
  for (const row of validRows) {
    // Prefer raw_confidence (0-100, 1 decimal) > raw_confidence_pct > confidence_pct
    const rawConf = row.raw_confidence ?? row.raw_confidence_pct ?? row.confidence_pct;
    const bucketIndex = Math.floor(rawConf / bucketSize);
    const bucketMin = bucketIndex * bucketSize;
    const bucketMax = Math.min(100, (bucketIndex + 1) * bucketSize);
    const bucketKey = `${bucketMin}-${bucketMax}`;
    
    if (!bucketMap.has(bucketKey)) {
      bucketMap.set(bucketKey, {
        raw: (bucketMin + bucketMax) / 2, // Midpoint of bucket
        wins: 0,
        total: 0,
      });
    }
    
    const bucket = bucketMap.get(bucketKey);
    bucket.total++;
    if (row.winHit === true || row.winHit === "true" || row.winHit === 1 || row.winHit === "1") {
      bucket.wins++;
    }
  }
  
  // Convert to array and compute observed win rates
  const buckets = Array.from(bucketMap.entries())
    .map(([key, data]) => {
      const observed = data.total > 0 ? data.wins / data.total : 0;
      return {
        raw: data.raw,
        observed,
        count: data.total,
        bucketKey: key,
      };
    })
    .filter((b) => b.count > 0); // Only keep buckets with data
  
  if (buckets.length === 0) {
    return {
      mapping: null,
      sampleSize: validRows.length,
      minSampleSize,
      fallback: true,
      buckets: [],
    };
  }
  
  // Apply PAVA to ensure monotonicity
  const calibratedBuckets = poolAdjacentViolators(buckets);
  
  // Build interpolation function
  const calibrateFn = (rawPct) => {
    if (rawPct < 0) return 0;
    if (rawPct > 100) return 100;
    
    // Find surrounding buckets
    if (calibratedBuckets.length === 0) {
      return rawPct; // Identity fallback
    }
    
    // If below first bucket, use first bucket's calibrated value
    if (rawPct <= calibratedBuckets[0].raw) {
      return Math.max(0, Math.min(100, calibratedBuckets[0].calibrated * 100));
    }
    
    // If above last bucket, use last bucket's calibrated value
    if (rawPct >= calibratedBuckets[calibratedBuckets.length - 1].raw) {
      const last = calibratedBuckets[calibratedBuckets.length - 1];
      return Math.max(0, Math.min(100, last.calibrated * 100));
    }
    
    // Linear interpolation between buckets
    for (let i = 0; i < calibratedBuckets.length - 1; i++) {
      const a = calibratedBuckets[i];
      const b = calibratedBuckets[i + 1];
      
      if (rawPct >= a.raw && rawPct <= b.raw) {
        const t = (rawPct - a.raw) / (b.raw - a.raw);
        const calibrated = a.calibrated * (1 - t) + b.calibrated * t;
        return Math.max(0, Math.min(100, calibrated * 100));
      }
    }
    
    // Fallback (shouldn't reach here)
    return rawPct;
  };
  
  return {
    mapping: calibrateFn,
    sampleSize: validRows.length,
    minSampleSize,
    fallback: false,
    buckets: calibratedBuckets.map((b) => ({
      rawMin: b.raw - bucketSize / 2,
      rawMax: b.raw + bucketSize / 2,
      rawMid: b.raw,
      calibrated: b.calibrated * 100, // Convert to percentage
      count: b.count,
    })),
  };
}

/**
 * Calibrate a raw confidence percentage using the recalibration mapping
 * 
 * @param {number} rawPct - Raw confidence percentage (0-100)
 * @param {Object} recalibration - Recalibration object from buildConfidenceRecalibration
 * @returns {number} - Calibrated confidence percentage (0-100)
 */
export function calibrateConfidencePct(rawPct, recalibration) {
  if (!recalibration || !recalibration.mapping) {
    // Fallback: identity mapping
    return rawPct;
  }
  
  return recalibration.mapping(rawPct);
}
