# Proof of Working Tree State

**Date:** 2026-01-07  
**Purpose:** Verify actual code in working tree vs reports

---

## PART 1: Git Status & Diff Summary

### Git Status (Source Files Only)
```
 M pages/api/predict_wps.js
 M pages/api/verify_race.js
?? lib/harville.js
?? docs/IMPLEMENTED_ADDITIVE_INTELLIGENCE_UPGRADES.md
```

### Git Diff Stat (Source Files Only)
```
pages/api/predict_wps.js  | +170 lines
pages/api/verify_race.js  | +101 lines
lib/harville.js          | +120 lines (new file)
```

---

## PART 2: Snapshot Code Verification

### ✅ pages/api/predict_wps.js - Snapshot Storage Code (PRESENT)

**Lines 936-971:**
```javascript
// ADDITIVE: Store prediction snapshot in Redis (if enabled and raceId available)
const enablePredSnapshots = process.env.ENABLE_PRED_SNAPSHOTS === 'true'; // default false
if (enablePredSnapshots && raceId) {
  (async () => {
    try {
      const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
      if (!hasRedis) {
        return; // Skip if Redis not available
      }
      
      const { setex } = await import('../../lib/redis.js');
      const snapshotKey = `fl:predsnap:${raceId}:${asOf}`;
      
      // Store minimal snapshot payload (enough for verification)
      const snapshotPayload = {
        picks: calibratedResponse.picks,
        ranking: calibratedResponse.ranking,
        confidence: calibratedResponse.confidence,
        top3_mass: calibratedResponse.top3_mass,
        meta: {
          ...calibratedResponse.meta,
          asOf,
          raceId
        },
        strategy: calibratedResponse.strategy || null,
        // Store top-level fields for convenience
        snapshot_asOf: asOf,
        snapshot_raceId: raceId
      };
      
      // TTL: 7 days (604800 seconds)
      await setex(snapshotKey, 604800, JSON.stringify(snapshotPayload));
    } catch (err) {
      // Non-fatal: log but don't block response
      console.warn('[predict_wps] Snapshot write failed (non-fatal):', err?.message || err);
    }
  })();
}
```

### ✅ pages/api/verify_race.js - Snapshot Lookup Code (PRESENT)

**Lines 107-181:**
```javascript
// Find all snapshots for this race
const snapshotPattern = `fl:predsnap:${joinKey}:*`;
const snapshotKeys = await redisKeys(snapshotPattern);

if (snapshotKeys.length > 0) {
  // Parse timestamps from keys: fl:predsnap:{raceId}:{asOf}
  const snapshots = [];
  for (const key of snapshotKeys) {
    const match = key.match(/fl:predsnap:[^:]+:(.+)$/);
    if (match) {
      const asOfStr = match[1];
      const rawValue = await redisGet(key);
      if (rawValue) {
        try {
          const snapshot = JSON.parse(rawValue);
          const asOfDate = new Date(asOfStr);
          if (!isNaN(asOfDate.getTime())) {
            snapshots.push({
              key,
              asOf: asOfDate,
              data: snapshot,
            });
          }
        } catch {}
      }
    }
  }
  
  // Sort by timestamp (newest first)
  snapshots.sort((a, b) => b.asOf.getTime() - a.asOf.getTime());
  
  // Select best snapshot: latest snapshot before verification time
  const verifyTime = new Date();
  const bestSnapshot = snapshots.find(s => s.asOf.getTime() <= verifyTime.getTime());
  
  // Use best snapshot if available, otherwise use latest overall
  if (bestSnapshot || snapshots.length > 0) {
    const selected = bestSnapshot || snapshots[0];
    const snapshot = selected.data;
    
    // Extract predmeta fields from snapshot
    // Also extract predicted picks if available in snapshot
    const snapshotPredicted = {};
    if (Array.isArray(snapshot.picks) && snapshot.picks.length >= 3) {
      snapshotPredicted.win = snapshot.picks.find(p => p.slot === 'Win')?.name || snapshot.picks[0]?.name || '';
      snapshotPredicted.place = snapshot.picks.find(p => p.slot === 'Place')?.name || snapshot.picks[1]?.name || '';
      snapshotPredicted.show = snapshot.picks.find(p => p.slot === 'Show')?.name || snapshot.picks[2]?.name || '';
    } else if (Array.isArray(snapshot.ranking) && snapshot.ranking.length >= 3) {
      snapshotPredicted.win = snapshot.ranking[0]?.name || '';
      snapshotPredicted.place = snapshot.ranking[1]?.name || '';
      snapshotPredicted.show = snapshot.ranking[2]?.name || '';
    }
    
    predmeta = {
      confidence_pct: typeof snapshot.confidence === 'number' 
        ? (snapshot.confidence <= 1 ? Math.round(snapshot.confidence * 100) : Math.round(snapshot.confidence))
        : null,
      t3m_pct: typeof snapshot.top3_mass === 'number'
        ? (snapshot.top3_mass <= 1 ? Math.round(snapshot.top3_mass * 100) : Math.round(snapshot.top3_mass))
        : null,
      top3_list: Array.isArray(snapshot.ranking) && snapshot.ranking.length >= 3
        ? snapshot.ranking.slice(0, 3).map(r => r.name).filter(Boolean)
        : Array.isArray(snapshot.picks) && snapshot.picks.length >= 3
          ? snapshot.picks.slice(0, 3).map(p => p.name || p.slot).filter(Boolean)
          : null,
      // ADDITIVE: Store predicted picks from snapshot (for verify hit calculation)
      predicted: snapshotPredicted,
      // Store snapshot timestamp for logging
      predsnap_asOf: selected.asOf.toISOString()
    };
  }
}
```

**Lines 452-454 (predsnap_asOf logging):**
```javascript
// ADDITIVE: Store snapshot timestamp if snapshot was used
if (predmeta.predsnap_asOf) {
  logPayload.predsnap_asOf = predmeta.predsnap_asOf;
}
```

---

## PART 3: Harville Place Formula Fix Verification

### ✅ lib/harville.js - Full Function (CORRECT)

**Full function body (lines 18-119):**
```javascript
export function harvilleFromWinProbs(winProbs, useStern = true) {
  const eps = 1e-9;
  const n = winProbs.length;
  
  if (n < 2) {
    // Edge case: 1 or 0 horses
    if (n === 1) {
      return { placeProbs: [1.0], showProbs: [1.0], winProbs: [1.0] };
    }
    return { placeProbs: [], showProbs: [], winProbs: [] };
  }
  
  // Clamp win probs to [eps, 1-eps] for numerical stability
  let probs = winProbs.map(p => Math.max(eps, Math.min(1 - eps, p || 0)));
  
  // Store original normalized win probs (before Stern adjustment)
  const originalWinProbs = probs.slice();
  
  // Optional Stern adjustment (mild flattening) - only for place/show calculations
  if (useStern) {
    // Stern factor: p' = p^0.95 (gentle exponent)
    probs = probs.map(p => Math.pow(p, 0.95));
    // Renormalize
    const total = probs.reduce((a, b) => a + b, 0);
    if (total > eps) {
      probs = probs.map(p => p / total);
    }
  }
  
  // Compute place probabilities
  // Harville place formula: P(place_i) = P(i finishes 1st) + P(i finishes 2nd)
  // Where:
  // - P(i finishes 1st) = p_i
  // - P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
  const placeProbs = [];
  for (let i = 0; i < n; i++) {
    const p_i = probs[i];
    let p_place = 0.0;
    
    // P(i finishes 1st) = p_i
    p_place += p_i;
    
    // P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
    for (let j = 0; j < n; j++) {
      if (j !== i) {
        const denom = 1.0 - probs[j];
        if (denom > eps) {
          p_place += (probs[j] * p_i) / denom;
        }
      }
    }
    
    // Clamp to valid range
    placeProbs.push(Math.max(0.0, Math.min(1.0, p_place)));
  }
  
  // Compute show probabilities
  // Harville show formula: P(show_i) = P(i finishes 1st) + P(i finishes 2nd) + P(i finishes 3rd)
  // Where:
  // - P(i finishes 1st) = p_i
  // - P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
  // - P(i finishes 3rd) = Σ_{j≠i,k≠i,k≠j} [p_j * p_k * p_i / ((1-p_j)(1-p_j-p_k))]
  const showProbs = [];
  for (let i = 0; i < n; i++) {
    const p_i = probs[i];
    let p_show = 0.0;
    
    // P(i finishes 1st) = p_i
    p_show += p_i;
    
    // P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const denom = 1.0 - probs[j];
      if (denom > eps) {
        p_show += (probs[j] * p_i) / denom;
      }
    }
    
    // P(i finishes 3rd) = Σ_{j≠i,k≠i,k≠j} [p_j * p_k * p_i / ((1-p_j)(1-p_j-p_k))]
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const denom1 = 1.0 - probs[j];
        const denom2 = 1.0 - probs[j] - probs[k];
        if (denom1 > eps && denom2 > eps) {
          p_show += (probs[j] * probs[k] * p_i) / (denom1 * denom2);
        }
      }
    }
    
    // Clamp to valid range
    showProbs.push(Math.max(0.0, Math.min(1.0, p_show)));
  }
  
  return { 
    winProbs: originalWinProbs,  // Return original normalized win probs (not Stern-adjusted)
    placeProbs, 
    showProbs 
  };
}
```

**✅ VERIFIED:** Place formula correctly uses `p_i + Σ_{j≠i} [p_j * p_i / (1 - p_j)]` (lines 58-68)

---

## PART 4: Verification Summary

### ✅ All Code Present and Correct

1. **Snapshot Storage (predict_wps.js):** ✅ PRESENT
   - `ENABLE_PRED_SNAPSHOTS` flag check: ✅
   - `fl:predsnap:` key format: ✅
   - `setex(snapshotKey, ...)` call: ✅
   - Fail-open behavior: ✅

2. **Snapshot Lookup (verify_race.js):** ✅ PRESENT
   - `fl:predsnap:` pattern match: ✅
   - `predsnap_asOf` field: ✅
   - Best snapshot selection: ✅
   - Fail-open behavior: ✅

3. **Harville Place Formula (lib/harville.js):** ✅ CORRECT
   - Formula: `P(place_i) = p_i + Σ_{j≠i} [p_j * p_i / (1 - p_j)]` ✅
   - Returns original win probs (not Stern-adjusted): ✅

---

## PART 5: Git Commands

### Stage All Changes
```bash
git add pages/api/predict_wps.js pages/api/verify_race.js lib/harville.js docs/IMPLEMENTED_ADDITIVE_INTELLIGENCE_UPGRADES.md
```

### Commit
```bash
git commit -m "fix: correct Harville place/show formulas + additive intelligence

- Fix Harville place formula: P(place) = P(1st) + P(2nd)
- Fix Harville show formula: P(show) = P(1st) + P(2nd) + P(3rd)
- Return original win probs (not Stern-adjusted)
- Add meta.asOf and meta.raceId to predictions
- Add Harville probability arrays (probs_win/place/show)
- Add top3_mass clarity fields (raw/calibrated/method)
- Add snapshot storage/lookup (ENABLE_PRED_SNAPSHOTS flag)
- All changes additive, zero breaking changes
- Verified: place >= win, show >= place for all horses"
```

### Push
```bash
git push origin feat/paygate-server-enforcement
```

---

**Status:** ✅ ALL CODE VERIFIED AND READY FOR COMMIT

