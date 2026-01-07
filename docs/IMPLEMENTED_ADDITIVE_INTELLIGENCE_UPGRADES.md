# Implemented Additive Intelligence Upgrades

**Date:** 2026-01-06  
**Status:** ✅ COMPLETED  
**Risk Level:** LOW (additive-only, feature-flagged, fail-open)

## Overview

This document describes the additive intelligence upgrades implemented to enhance FinishLine WPS AI prediction system without breaking existing functionality or requiring UI changes.

## Features Implemented

### 1. Timestamp Snapshot Method (Feature Flag: `ENABLE_PRED_SNAPSHOTS`)

**Purpose:** Track prediction snapshots over time to enable "time-to-post" analysis without requiring user input.

**Changes:**
- ✅ Added `meta.asOf` (ISO timestamp) to every `/api/predict_wps` response
- ✅ Added `meta.raceId` derived from `track + date + raceNo` (null if missing)
- ✅ Store prediction snapshots in Redis: `fl:predsnap:{raceId}:{asOf}` (7-day TTL)
- ✅ In `/api/verify_race`, attempt to use "best snapshot" (latest before verify time) to populate predmeta
- ✅ Fail-open: Verification never breaks if Redis fails

**Feature Flag:**
- `ENABLE_PRED_SNAPSHOTS` (default: `false`)
- Set to `"true"` to enable snapshot storage and lookup

**Files Modified:**
- `pages/api/predict_wps.js` (lines ~500-850)
- `pages/api/verify_race.js` (lines ~100-160, ~360-370)

**Redis Key Format:**
```
fl:predsnap:{date}|{normalizedTrack}|{raceNo}:{asOfISO}
Example: fl:predsnap:2026-01-06|gulfstream park|5:2026-01-06T17:49:19.123Z
```

**Snapshot Selection Logic:**
1. Find all snapshots matching `fl:predsnap:{raceId}:*`
2. Sort by timestamp (newest first)
3. Select latest snapshot with `asOf <= verify time`
4. Fallback to latest snapshot overall if none before verify time
5. If snapshot not found, use existing predmeta lookup (fail-open)

### 2. Harville W/P/S Probability Layer (Feature Flag: `ENABLE_HARVILLE_PROBS`)

**Purpose:** Add Harville-computed place/show probabilities alongside existing win probabilities for more accurate probability modeling.

**Changes:**
- ✅ Added `probs_win` array (same as existing normalized probabilities)
- ✅ Added `probs_place` array (Harville-computed from win probs)
- ✅ Added `probs_show` array (Harville-computed from win probs)
- ✅ Added `prob_win`, `prob_place`, `prob_show` to each `ranking[]` entry
- ✅ Kept existing `ranking[].prob` unchanged (backward compatible)

**Feature Flag:**
- `ENABLE_HARVILLE_PROBS` (default: `true`)
- Set to `"false"` to disable Harville computation

**Files Modified:**
- `lib/harville.js` (new file)
- `pages/api/predict_wps.js` (lines ~260-290)

**Harville Formulas:**
- Place: `P(place_i) = Σ_{j≠i} [p_i * p_j / (1 - p_i)]`
- Show: `P(show_i) = Σ_{j≠i,k≠i,k≠j} [p_i * p_j * p_k / ((1-p_i)(1-p_i-p_j))]`
- Uses Stern adjustment (gentle exponent: p^0.95) for numerical stability

**Response Fields:**
```json
{
  "probs_win": [0.37, 0.35, 0.19, 0.09],
  "probs_place": [0.52, 0.48, 0.28, 0.12],
  "probs_show": [0.61, 0.58, 0.38, 0.18],
  "ranking": [
    {
      "name": "Lightning Bolt",
      "prob": 0.37,
      "prob_win": 0.37,
      "prob_place": 0.52,
      "prob_show": 0.61
    }
  ]
}
```

### 3. top3_mass Clarity Fields (Feature Flag: `ENABLE_TOP3_MASS_CLARITY`)

**Purpose:** Resolve confusion about "percentages not matching" by clearly distinguishing raw vs calibrated top3_mass values.

**Changes:**
- ✅ Added `top3_mass_raw` (0-100 int): Raw sum of top 3 ranking probabilities
- ✅ Added `top3_mass_calibrated` (0-100 int): Existing calibrated top3_mass value
- ✅ Added `top3_mass_method` (string): "raw_sum" | "calib_template" | "legacy"
- ✅ Kept existing `top3_mass` unchanged (backward compatible)

**Feature Flag:**
- `ENABLE_TOP3_MASS_CLARITY` (default: `true`)
- Set to `"false"` to disable clarity fields

**Files Modified:**
- `pages/api/predict_wps.js` (lines ~415-545)

**Response Fields:**
```json
{
  "top3_mass": 56,
  "top3_mass_raw": 91,
  "top3_mass_calibrated": 56,
  "top3_mass_method": "calib_template"
}
```

**Method Logic:**
- `"raw_sum"`: Raw sum of probabilities (no calibration)
- `"calib_template"`: Calibrated value differs materially (> 5 points) from raw
- `"legacy"`: Fallback for older responses or when clarity disabled

## Safety Guarantees

### Backward Compatibility
- ✅ **Zero breaking changes:** All existing fields (`picks`, `confidence`, `top3_mass`, `ranking[].prob`) remain unchanged
- ✅ **Additive only:** New fields are optional and won't break existing consumers
- ✅ **Fail-open:** All Redis operations are non-blocking and fail gracefully

### Feature Flags
- All features are gated behind environment variables
- Defaults are safe (snapshots disabled, Harville/Top3Mass enabled by default)
- Can be toggled without code changes

### Error Handling
- Redis failures are logged but never block responses
- Harville computation failures fall back to null (fields omitted)
- Snapshot lookup failures fall back to existing predmeta lookup

## Testing Instructions

### Local Testing

1. **Start Dev Server:**
   ```bash
   npm run dev
   ```

2. **Test Prediction with Additive Fields:**
   ```bash
   curl -X POST http://localhost:3000/api/predict_wps \
     -H "Content-Type: application/json" \
     -d '{
       "horses": [
         {"name": "Thunder Strike", "odds": "3/1", "post": 3},
         {"name": "Lightning Bolt", "odds": "5/2", "post": 5},
         {"name": "Silver Star", "odds": "7/2", "post": 2},
         {"name": "Dark Moon", "odds": "4/1", "post": 7}
       ],
       "track": "Gulfstream Park",
       "surface": "dirt",
       "distance_input": "6f",
       "speedFigs": {
         "Thunder Strike": 95,
         "Lightning Bolt": 92,
         "Silver Star": 88,
         "Dark Moon": 85
       }
     }'
   ```

3. **Verify Response Contains:**
   - ✅ `meta.asOf` (ISO timestamp string)
   - ✅ `meta.raceId` (null, since date/raceNo not provided)
   - ✅ `ranking[].prob` unchanged (existing field)
   - ✅ `ranking[].prob_win`, `prob_place`, `prob_show` (if Harville enabled)
   - ✅ `probs_win`, `probs_place`, `probs_show` arrays (if Harville enabled)
   - ✅ `top3_mass_raw`, `top3_mass_calibrated`, `top3_mass_method` (if clarity enabled)
   - ✅ `top3_mass` unchanged (existing field)

4. **Test with Date/RaceNo (Snapshot Storage):**
   ```bash
   curl -X POST http://localhost:3000/api/predict_wps \
     -H "Content-Type: application/json" \
     -d '{
       "horses": [...],
       "track": "Gulfstream Park",
       "date": "2026-01-06",
       "raceNo": "5",
       "surface": "dirt",
       "distance_input": "6f",
       "speedFigs": {...}
     }'
   ```
   
   With `ENABLE_PRED_SNAPSHOTS=true`, verify:
   - ✅ `meta.raceId` is non-null (e.g., `"2026-01-06|gulfstream park|5"`)
   - ✅ Snapshot key exists in Redis: `fl:predsnap:{raceId}:{asOf}`
   - ✅ Snapshot TTL is 7 days (604800 seconds)

5. **Test Snapshot Lookup in verify_race:**
   ```bash
   curl -X POST http://localhost:3000/api/verify_race \
     -H "Content-Type: application/json" \
     -d '{
       "track": "Gulfstream Park",
       "date": "2026-01-06",
       "raceNo": "5",
       "outcome": {
         "win": "Lightning Bolt",
         "place": "Thunder Strike",
         "show": "Silver Star"
       }
     }'
   ```
   
   With `ENABLE_PRED_SNAPSHOTS=true`, verify:
   - ✅ Verify log contains `predsnap_asOf` field (if snapshot was used)
   - ✅ Predmeta fields (`confidence_pct`, `t3m_pct`, `top3_list`) populated from snapshot
   - ✅ Verification still works if Redis is disabled (fail-open)

### Feature Flag Testing

1. **Disable Harville:**
   ```bash
   ENABLE_HARVILLE_PROBS=false npm run dev
   ```
   - Verify `probs_win/place/show` arrays are omitted
   - Verify `ranking[].prob_win/place/show` fields are omitted

2. **Disable Top3Mass Clarity:**
   ```bash
   ENABLE_TOP3_MASS_CLARITY=false npm run dev
   ```
   - Verify `top3_mass_raw/calibrated/method` fields are omitted
   - Verify `top3_mass` still present (unchanged)

3. **Enable Snapshots:**
   ```bash
   ENABLE_PRED_SNAPSHOTS=true npm run dev
   ```
   - Verify snapshots are stored in Redis
   - Verify snapshot lookup works in verify_race

## Environment Variables

```bash
# Enable prediction snapshot storage/lookup (default: false)
ENABLE_PRED_SNAPSHOTS=false

# Enable Harville probability computation (default: true)
ENABLE_HARVILLE_PROBS=true

# Enable top3_mass clarity fields (default: true)
ENABLE_TOP3_MASS_CLARITY=true

# Redis configuration (required for snapshots)
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

## Files Changed

### New Files
- `lib/harville.js` - Harville formula implementation

### Modified Files
- `pages/api/predict_wps.js` - Added meta.asOf/raceId, Harville probs, top3_mass clarity, snapshot storage
- `pages/api/verify_race.js` - Added snapshot lookup, predsnap_asOf logging

### Documentation
- `docs/IMPLEMENTED_ADDITIVE_INTELLIGENCE_UPGRADES.md` (this file)

## Code Comments

All additive code is marked with `// ADDITIVE: ...` comments for easy identification:
- `pages/api/predict_wps.js`: Lines with Harville, meta fields, snapshot storage
- `pages/api/verify_race.js`: Lines with snapshot lookup, predsnap_asOf logging
- `lib/harville.js`: All code is additive (new file)

## Next Steps

1. ✅ Monitor logs for any unexpected errors
2. ✅ Verify snapshot storage works in production (with `ENABLE_PRED_SNAPSHOTS=true`)
3. ✅ Test snapshot lookup in verify_race with real race data
4. ✅ Consider enabling snapshots by default after validation period
5. ✅ Document Harville probabilities for users (if needed)

## Risk Assessment

**Risk Level:** LOW

**Risks:**
- Redis failures: Mitigated by fail-open design
- Harville computation errors: Mitigated by try-catch and null fallback
- Snapshot lookup failures: Mitigated by fallback to existing predmeta lookup
- Backward compatibility: Mitigated by additive-only changes

**Mitigations:**
- All features are feature-flagged
- All Redis operations are non-blocking
- All errors are logged but never break responses
- Existing fields remain unchanged

## Git Diff Summary

```bash
# Files changed
lib/harville.js (new file)
pages/api/predict_wps.js (modified)
pages/api/verify_race.js (modified)
docs/IMPLEMENTED_ADDITIVE_INTELLIGENCE_UPGRADES.md (new file)

# Lines added
~200 lines (additive only, no removals)
```

---

**End of Implementation Report**

