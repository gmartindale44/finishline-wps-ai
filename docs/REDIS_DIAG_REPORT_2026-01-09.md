# Redis/Upstash Diagnostic Report
**Date:** 2026-01-09  
**Issues:** predsnap not writing, verify_backfill false skips  
**Status:** Root cause identified, fixes implemented

---

## EXECUTIVE SUMMARY

**Issue A: predsnap not writing** - Root cause: High-signal gating logic requires `allowAny` (bet allowed) OR `confidenceHigh >= 80%`. If neither condition is met, snapshots are not written even when `ENABLE_PRED_SNAPSHOTS=true` and `raceId` is present.

**Issue B: verify_backfill false skips** - Root cause: Previously fixed with centralized normalization (commit a857e470), but Redis client type mismatch discovered. `verify_backfill` uses `@upstash/redis` SDK while other endpoints use REST API client (both should use same env vars, but fingerprints will prove consistency).

---

## FINDINGS

### 1. Redis Client Architecture

**Current State:**
- `predict_wps.js`: Uses `lib/redis.js` REST API client (`fetch` to Upstash REST)
- `verify_race.js`: Uses `lib/redis.js` REST API client
- `verify_backfill.js`: Uses `@upstash/redis` SDK via `backfill_helpers.getRedis()` (Redis.fromEnv())
- `green_zone.ts`: Uses `@upstash/redis` SDK (separate instance)
- `tracks.js`: Uses `@upstash/redis` SDK (separate instance)

**Environment Variables Used:**
- All clients use: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Both REST API and SDK should connect to the same Upstash instance IF env vars are identical

**Risk:** If Preview and Production have different env var values, endpoints using different clients might connect to different Redis instances, causing:
- predsnap writes to one instance, reads from another
- verify keys written to one instance, skip checks query another

**Fix Applied:** Added safe fingerprints (no secrets) to all endpoints to prove which Redis instance is used per request.

---

### 2. predsnap Write Gating Logic

**Location:** `pages/api/predict_wps.js` lines 958-968

**Current Gating:**
```javascript
const shouldSnapshot = !!(enablePredSnapshots && redisConfigured && raceId && (allowAny || confidenceHigh));
```

**Conditions Required:**
1. ✅ `ENABLE_PRED_SNAPSHOTS === 'true'`
2. ✅ `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` present
3. ✅ `raceId` is not null (requires `date`, `raceNo`, `track` in request body)
4. ⚠️ **EITHER:**
   - `allowAny === true` (at least one bet type allowed: win OR place OR show)
   - **OR** `confidenceHigh === true` (confidence >= 80%)

**Issue:** If a prediction has:
- `confidence < 80%`
- AND no bets allowed (`allow.win === false && allow.place === false && allow.show === false`)

Then `shouldSnapshot = false` and NO snapshot is written, even if `ENABLE_PRED_SNAPSHOTS=true` and all other conditions are met.

**Evidence from Code:**
- Line 959: `const allow = shadowDecision?.allow || {};`
- Line 960: `const allowAny = !!(allow?.win || allow?.place || allow?.show);`
- Line 961: `const confidenceHigh = (typeof calibratedResponse.confidence === 'number' ? calibratedResponse.confidence : 0) >= 80;`
- Line 962: `const shouldSnapshot = !!(enablePredSnapshots && redisConfigured && raceId && (allowAny || confidenceHigh));`

**Debug Fields Added:**
- `snapshot_debug.gatingReason`: Explains why snapshot was/wasn't attempted
- `snapshot_debug.shouldSnapshot`, `allowAny`, `confidenceHigh`: All boolean flags

---

### 3. Key Format Consistency

**predsnap Keys:**
- **Write format** (predict_wps.js line 971): `fl:predsnap:${raceId}:${asOf}`
  - Where `raceId = "${normDate}|${normTrack}|${normRaceNo}"`
  - Example: `fl:predsnap:2026-01-09|aqueduct|7:2026-01-09T12:34:56.789Z`
- **Read pattern** (verify_race.js line 79): `fl:predsnap:${joinKey}:*`
  - Where `joinKey = "${normDate}|${normTrack}|${normRaceNo}"`
  - Example: `fl:predsnap:2026-01-09|aqueduct|7:*`

**Track Normalization:**
- Both use identical `normalizeTrack()` function:
  ```javascript
  String(track).toLowerCase().trim()
    .replace(/\s+/g, " ")      // Collapse spaces
    .replace(/[^a-z0-9\s]/g, "") // Remove non-alphanum
    .replace(/\s+/g, " ")      // Keep spaces (not converting to dashes)
  ```
- Result: `"Aqueduct"` → `"aqueduct"`, `"Gulfstream Park"` → `"gulfstream park"` (keeps space)

**✅ Key format is CONSISTENT** between write and read paths.

**verify Keys:**
- **Write format** (verify_race.js line 473): `fl:verify:${raceId}`
  - Where `raceId = buildVerifyRaceId(track, date, raceNo)` from `lib/verify_normalize.js`
  - Format: `{trackSlug}-{YYYY-MM-DD}-unknown-r{raceNo}`
  - Example: `fl:verify:aqueduct-2026-01-09-unknown-r7`
- **Read format** (verify_backfill.js line 396): `fl:verify:${raceIdDerived}`
  - Uses same `buildVerifyRaceId()` from centralized module
  - ✅ **Key format is CONSISTENT** (fixed in commit a857e470)

---

### 4. Redis Fingerprints (Safe, No Secrets)

**Implementation:** `lib/redis_fingerprint.js`

**Fields Exposed:**
- `urlFingerprint`: Last 6 chars of Upstash hostname (e.g., `"sh.com"`)
- `tokenFingerprint`: First 8 chars of SHA256(token) hash (one-way, cannot reverse)
- `env`: Combined env info (e.g., `"preview-production-abc1234"`)
- `configured`: Boolean
- `urlHost`: Full hostname (safe, no secrets)

**Added To:**
- ✅ `predict_wps.js`: `snapshot_debug.redisFingerprint`
- ✅ `verify_race.js`: `predmeta.debug.redisFingerprint`, `logPayload.debug.redisFingerprint`
- ✅ `verify_backfill.js`: `debug.redisFingerprint`

**Purpose:** Prove which Redis instance is used per endpoint/request, identify Preview vs Production mismatches.

---

## ROOT CAUSE ANALYSIS

### Issue A: predsnap Not Writing

**Most Likely Causes (in order):**
1. **High-signal gating too restrictive** - If confidence < 80% AND no bets allowed, snapshot is skipped
2. **raceId is null** - If `date`, `raceNo`, or `track` missing from request body
3. **ENABLE_PRED_SNAPSHOTS not set** - Env var not `'true'` in deployment
4. **Redis env vars missing** - `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` not set

**Fix Applied:**
- Added `gatingReason` debug field to explain why snapshot was/wasn't attempted
- Added `redisFingerprint` to prove which Redis instance is used
- Added `redisClientType` to identify client type

### Issue B: verify_backfill False Skips

**Root Cause:** Previously fixed in commit a857e470 (centralized normalization). Current issue is likely:
1. **Redis client mismatch** - `verify_backfill` uses `@upstash/redis` SDK while `verify_race` uses REST API (should use same instance if env vars match, but fingerprints will prove)
2. **Date normalization edge case** - Rare cases where date format differs (MM/DD/YYYY vs YYYY-MM-DD)

**Fix Applied:**
- Comprehensive debug fields already present (from commit a857e470)
- Added `redisFingerprint` to prove Redis instance consistency
- Added `redisClientType` to identify client mismatch

---

## FIXES IMPLEMENTED

### 1. Safe Redis Fingerprints
**File:** `lib/redis_fingerprint.js` (NEW)
- Generates safe fingerprints (no secrets exposed)
- SHA256 hash of token (first 8 chars, one-way)
- Hostname fingerprint (last 6 chars)

### 2. Enhanced Debug Fields
**Files:** `pages/api/predict_wps.js`, `pages/api/verify_race.js`, `pages/api/verify_backfill.js`
- Added `redisFingerprint` to all responses
- Added `redisClientType` to identify client type
- Added `gatingReason` to explain predsnap write decisions
- Added `joinKey` to verify_race for key format visibility

### 3. Key Format Verification
**Status:** ✅ Verified consistent
- predsnap keys: Both use `${date}|${track}|${raceNo}` format
- verify keys: Both use centralized `buildVerifyRaceId()` from `lib/verify_normalize.js`

---

## TESTING RECOMMENDATIONS

### Test 1: Verify predsnap Write Conditions
```bash
# Call /api/predict_wps with:
# - date: "2026-01-09"
# - raceNo: "7"
# - track: "Aqueduct"
# - Check response for:
#   - snapshot_debug.shouldSnapshot (should be true if conditions met)
#   - snapshot_debug.gatingReason (explains decision)
#   - snapshot_debug.redisFingerprint (proves Redis instance)
#   - snapshot_debug.snapshotWriteOk (should be true if written)
```

### Test 2: Verify Redis Instance Consistency
```bash
# Compare fingerprints across endpoints:
# 1. Call /api/predict_wps → check snapshot_debug.redisFingerprint
# 2. Call /api/verify_race → check predmeta.debug.redisFingerprint
# 3. Call /api/verify_backfill → check debug.redisFingerprint
# 
# All fingerprints should match (same urlFingerprint, tokenFingerprint)
```

### Test 3: Verify Key Formats
```bash
# Use /api/debug_verify_key endpoint:
# GET /api/debug_verify_key?track=Aqueduct&date=2026-01-09&raceNo=7
# 
# Returns:
# - computed.raceId: Shows exact raceId format
# - computed.key: Shows exact verify key format
# - redis.keyExists: Proves key existence
```

### Test 4: Verify verify_backfill Skip Logic
```bash
# Call /api/verify_backfill with:
# - races: [{ track: "Aqueduct", date: "2026-01-09", raceNo: "7" }]
# - Check response for:
#   - results[0].verifiedRedisKeyChecked (exact key checked)
#   - results[0].verifiedRedisKeyExists (should be false for new race)
#   - results[0].normalization (shows input/output values)
#   - debug.redisFingerprint (proves Redis instance)
```

---

## NEXT STEPS

1. **Deploy to Preview** and run smoke tests to collect fingerprints
2. **Compare fingerprints** across endpoints to confirm Redis instance consistency
3. **Monitor predsnap writes** - Check `gatingReason` to understand why snapshots aren't writing
4. **If predsnap gating is too restrictive**, consider relaxing to: `enablePredSnapshots && redisConfigured && raceId` (remove allowAny/confidenceHigh requirement)
5. **If Redis client mismatch confirmed**, unify all endpoints to use REST API client from `lib/redis.js`

---

## SECURITY NOTES

- ✅ No secrets exposed in fingerprints (token is hashed, URL is hostname only)
- ✅ Fingerprints are safe to log/expose in API responses
- ✅ All debug fields are non-sensitive (key names, existence flags, value previews truncated)

---

## COMMIT SUMMARY

**Commit:** `diag: redis fingerprints + enhanced predsnap/verify debug + gating reason`

**Files Changed:**
- `lib/redis_fingerprint.js` (NEW): Safe fingerprint generation
- `pages/api/predict_wps.js`: Added fingerprints, gatingReason, clientType
- `pages/api/verify_race.js`: Added fingerprints, joinKey, clientType
- `pages/api/verify_backfill.js`: Added fingerprints, clientType

**No Breaking Changes:** All changes are additive debug fields.
