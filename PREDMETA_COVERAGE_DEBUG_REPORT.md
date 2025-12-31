# Predmeta Coverage Debug Report

**Generated:** 2025-12-27  
**Issue:** predmeta coverage is 0% in calibration reports despite pipeline being ready

---

## Phase 1: Predmeta Write Path Verification

✅ **Code Path Confirmed:**

- `api/predict_wps.js:610` - Writes `fl:predmeta:${joinKey}` where `joinKey = ${date}|${normTrack}|${raceNo}`
- `pages/api/verify_race.js:124` - Reads `fl:predmeta:${joinKey}` where `joinKey = ${normDate}|${normTrack}|${normRaceNo}`

**Key Format:** `fl:predmeta:YYYY-MM-DD|normtrack|raceNo`

---

## Phase 2: Redis Predmeta Keys

**Results:**
- **Total predmeta keys:** 2
  - **Permanent keys:** 1 (`fl:predmeta:last_write` - debug key)
  - **Pending keys:** 1
  - **Actual permanent race keys:** 0 ❌

**Sample Key Analysis:**
- `fl:predmeta:last_write` (debug key) contains:
  - `confidence_pct: 84`
  - `t3m_pct: 54`
  - `track: laurel park`
  - `date: N/A` ⚠️
  - `raceNo: N/A` ⚠️

**Finding:** The only permanent key is the debug key, which lacks `date` and `raceNo`. This suggests predmeta is being written to **pending keys** (temporary, 2-hour TTL) rather than permanent keys because `date`/`raceNo` are missing at predict time.

---

## Phase 3: Verify Logs Analysis

**Checked:** 5 most recent verify logs from `fl:verify:*`

**Sample Verify Logs:**
1. `fl:verify:zia-park-2025-12-16-unknown-r1`
   - track: Zia Park, date: 2025-12-16, raceNo: 1
   - Has predmeta fields: ❌ **false**
   - Expected predmeta key: `fl:predmeta:2025-12-16|ziapark|1`
   - Predmeta key exists: ❌ **false**

2. `fl:verify:zia-park-2025-12-14-unknown-r9`
   - track: Zia Park, date: 2025-12-14, raceNo: 9
   - Has predmeta fields: ❌ **false**
   - Expected predmeta key: `fl:predmeta:2025-12-14|ziapark|9`
   - Predmeta key exists: ❌ **false**

3. `fl:verify:zia-park-2025-12-07-unknown-r3`
   - track: Zia Park, date: 2025-12-07, raceNo: 3
   - Has predmeta fields: ❌ **false**
   - Expected predmeta key: `fl:predmeta:2025-12-07|ziapark|3`
   - Predmeta key exists: ❌ **false**

4. `fl:verify:zia-park-2025-12-06-unknown-r1`
   - track: Zia Park, date: 2025-12-06, raceNo: 1
   - Has predmeta fields: ❌ **false**
   - Expected predmeta key: `fl:predmeta:2025-12-06|ziapark|1`
   - Predmeta key exists: ❌ **false**

5. `fl:verify:zia-park-2025-12-02-unknown-r2`
   - track: Zia Park, date: 2025-12-02, raceNo: 2
   - Has predmeta fields: ❌ **false**
   - Expected predmeta key: `fl:predmeta:2025-12-02|ziapark|2`
   - Predmeta key exists: ❌ **false**

**Finding:** None of the recent verify logs contain predmeta fields, and the expected predmeta keys do not exist in Redis.

---

## Phase 4: Key Format Comparison

**Expected Format (from code):**
- Write: `fl:predmeta:${date}|${normTrack}|${raceNo}`
- Read: `fl:predmeta:${normDate}|${normTrack}|${normRaceNo}`

**Normalization:**
- Track: `normalizeTrack()` - lowercase, remove spaces/special chars
- Date: `normalizeDate()` - format as `YYYY-MM-DD`
- RaceNo: `String(raceNo).trim()`

**Example computed keys match expected format:** ✅

**Issue:** The keys don't exist because:
1. Predmeta is being written to **pending keys** (when `date`/`raceNo` missing at predict time)
2. Pending keys expire after 2 hours
3. By the time verify_race runs, the pending key may have expired or can't be matched

---

## Root Cause Analysis

### Primary Issue: Missing Date/RaceNo at Predict Time

**Symptom:** Only debug key (`fl:predmeta:last_write`) exists, with `date: N/A` and `raceNo: N/A`.

**Root Cause:** 
- `api/predict_wps.js` writes predmeta to **pending keys** when `date` or `raceNo` are missing from the prediction payload
- Pending keys have a 2-hour TTL and may expire before `verify_race` runs
- Even if pending keys exist, matching them requires score-based reconciliation (which may fail if metadata doesn't match)

**Evidence:**
1. Debug key shows predmeta was written (`confidence_pct: 84`, `t3m_pct: 54`)
2. But it lacks `date` and `raceNo` (went to pending key instead)
3. No permanent predmeta keys exist in Redis
4. Verify logs don't have predmeta fields embedded

---

## Where Mismatch Occurs

**Key Format:** ✅ Match (both use `date|track|raceNo` format)

**Data Availability:** ❌ **Mismatch**
- Predict endpoint receives predmeta data (confidence, T3M)
- But `date`/`raceNo` are missing from prediction payload
- Result: predmeta written to temporary pending keys instead of permanent keys
- When verify_race runs later, it can't find permanent keys and pending keys may have expired

**Date/Track/RaceNo Normalization:** ✅ Match (same normalization functions used)

---

## Summary

| Component | Status | Finding |
|-----------|--------|---------|
| Predmeta Write Path | ✅ Exists | Code writes to `fl:predmeta:*` keys |
| Predmeta Read Path | ✅ Exists | Code reads from `fl:predmeta:*` keys |
| Key Format | ✅ Match | Both use `date|track|raceNo` format |
| Permanent Keys in Redis | ❌ **0 found** | Only debug key exists |
| Verify Logs Have Predmeta | ❌ **0/5 checked** | None contain predmeta fields |
| Root Cause | ❌ **Data missing** | `date`/`raceNo` missing at predict time → writes to pending keys |

---

## Conclusion

**Root Cause:** Predmeta is being written to **pending keys** (temporary, 2-hour TTL) because `date` and `raceNo` are not included in the prediction payload at the time `/api/predict_wps` is called.

**Impact:** 
- Pending keys may expire before verify_race runs
- Even if pending keys exist, score-based matching may fail
- Result: verify logs don't get predmeta fields, calibration CSV has empty predmeta columns

**Next Steps:**
1. Ensure prediction payload includes `date` and `raceNo` when available
2. Verify client-side code (finishline-picker-bootstrap.js) sends these fields
3. Consider extending pending key TTL if date/raceNo are commonly missing
4. Monitor pending key reconciliation success rate in verify_race

---

## Verdict

🟡 **PARTIAL** - Pipeline code is correct, but predmeta data is not being persisted to permanent keys due to missing `date`/`raceNo` at predict time. This causes all predmeta to go to temporary pending keys that expire or fail to match.

