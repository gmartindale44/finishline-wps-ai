# feat: reconcile predmeta pending keys at verify time

## Root Cause

Predmeta coverage is 0% because:
1. `/api/predict_wps` writes predmeta to **pending keys** (temporary, 2-hour TTL) when `date`/`raceNo` are missing from the prediction payload
2. Pending keys may expire before `verify_race` runs, or the matching score threshold (>= 8) was too strict
3. Result: verify logs don't get predmeta fields, calibration CSV shows empty predmeta columns

**Evidence from debug run:**
- Only 1 permanent predmeta key exists (debug key with `date: N/A`, `raceNo: N/A`)
- 5 most recent verify logs have no predmeta fields
- Expected predmeta keys don't exist in Redis

## Solution: Improved Reconciliation Logic

Enhanced the existing reconciliation logic in `verify_race.js` to be more effective:

### Changes

1. **Safety: Hard limit on keys scanned**
   - Limits to most recent 25 pending keys (prevents scanning large keyspaces)
   - Sorts by timestamp and takes newest first

2. **Lowered score threshold: 8 → 5**
   - Previous: Required score >= 8 (track + distance + surface, or track + fingerprint + recency)
   - New: Requires score >= 5 (allows track match + recency, or track + one metadata match)
   - Base score: Track match = +3, Recency bonus = up to +5
   - Now matches when: track matches + very recent (< 1 hour) = score 8+

3. **Improved recency scoring**
   - Increased recency bonus from +3 max to +5 max
   - Better prioritizes very recent matches (< 1 hour)

4. **Debug logging**
   - Adds `predmeta_reconciled`, `predmeta_reconcile_reason`, `predmeta_reconciled_from` to `result.debug`
   - Helps diagnose reconciliation success/failure without spamming logs

### Safety Guarantees

- ✅ **Fail-open**: If reconciliation fails, verify continues without predmeta (no errors)
- ✅ **Hard limits**: Max 25 keys scanned per verify request
- ✅ **No breaking changes**: Existing permanent key lookup unchanged
- ✅ **Graceful fallback**: Works when predmeta is missing (empty columns, zero coverage)

## How It Works

1. When `verify_race` runs and permanent predmeta key is missing:
   - Scans up to 25 most recent pending keys
   - Filters by: track match + within 2 hours
   - Scores candidates by: track (+3), distance (+5), surface (+5), runners count (+3), fingerprint (+2), recency (+5 max)
   - If best score >= 5: promotes to permanent key, attaches to verify log

2. Verify log payload includes predmeta fields:
   - `confidence_pct`
   - `t3m_pct`  
   - `top3_list`

3. CSV export reads predmeta from verify logs:
   - `scripts/calibration/export_verify_redis_to_csv.mjs` extracts predmeta fields
   - Calibration metrics compute coverage/accuracy

## Expected Outcome

Once merged and a verify_race request runs with a matching pending predmeta key:
- ✅ Pending key gets promoted to permanent key
- ✅ Verify log contains predmeta fields
- ✅ Next `npm run export:verify-redis` includes predmeta columns with data
- ✅ Next `npm run calibrate:verify-v1` shows predmeta coverage > 0%

## Testing

**Validation commands run:**
- ✅ `npm run build:calibration-sample` - Schema accepts 18 columns
- ✅ `npm run calibrate:verify-v1` - Handles predmeta fields (currently 0 coverage expected)

**Manual test script created:**
- `scripts/debug/test_predmeta_reconcile.mjs` - Creates test pending key and verifies reconciliation

**Next steps for validation:**
1. Deploy to preview environment
2. Make a prediction (creates pending predmeta key)
3. Run verify_race with matching track/date/raceNo
4. Check verify log contains predmeta fields
5. Run `npm run export:verify-redis` - confirm predmeta columns populated
6. Run `npm run calibrate:verify-v1` - confirm coverage > 0%

## Files Changed

- `pages/api/verify_race.js` - Enhanced reconciliation logic (46 insertions, 9 deletions)

## Validation Output

```bash
# Schema validation
npm run build:calibration-sample
✅ Header validated (18 columns, includes predmeta)

# Calibration validation  
npm run calibrate:verify-v1
✅ Loaded 5000 rows
✅ Reports generated with predmeta support (coverage: 0% expected until new verify runs)
```

## Risks & Mitigations

**Risk:** Reconciliation might match wrong pending key  
**Mitigation:** Score threshold (>= 5) requires track match + recency/metadata, prioritizes most recent matches

**Risk:** Scanning pending keys might be slow  
**Mitigation:** Hard limit of 25 keys, sorted by recency (newest first)

**Risk:** Predmeta reconciliation fails silently  
**Mitigation:** Debug fields added to `result.debug` for diagnostics, fail-open design (verify continues without predmeta)

---

**PR Link:** https://github.com/gmartindale44/finishline-wps-ai/pull/new/feat/predmeta-reconcile-at-verify

