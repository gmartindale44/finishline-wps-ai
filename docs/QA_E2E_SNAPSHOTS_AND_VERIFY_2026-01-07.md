# QA E2E Test: Snapshot & Verify Logs on Vercel Preview

**Date:** 2026-01-07  
**PR #157:** https://github.com/gmartindale44/finishline-wps-ai/pull/157  
**Branch:** `feat/paygate-server-enforcement`  
**Test Type:** End-to-End Verification  
**Status:** ⏳ Awaiting Preview URL to execute tests

---

## Code References

### Snapshot Write Implementation
- **File:** `pages/api/predict_wps.js`
- **Lines:** 525-566 (deriveRaceId function)
- **Lines:** 937-983 (snapshot write logic)
- **Key Format:** `fl:predsnap:${raceId}:${asOf}` (line 955)
- **TTL:** 604800 seconds / 7 days (line 975)
- **Env Var Check:** `ENABLE_PRED_SNAPSHOTS === 'true'` (line 939)
- **Redis Check:** `UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN` (line 940)

### Verify Log Write Implementation
- **File:** `pages/api/verify_race.js`
- **Line:** 17 (`VERIFY_PREFIX = "fl:verify:"`)
- **Lines:** 100-205 (snapshot lookup logic)
- **Lines:** 500-507 (verify log write)
- **Key Format:** `fl:verify:${raceId}` (line 500)
- **TTL:** 7776000 seconds / 90 days (line 503)

### Redis Diagnostic
- **File:** `pages/api/redis_diag.js`
- **Lines:** 9-77 (full implementation)
- **Returns:** Non-sensitive Redis connectivity info

---

## Test Execution Plan

### Step 1: Get Preview URL

**Method 1 - Vercel Dashboard:**
1. Visit: https://vercel.com/hired-hive/finishline-wps-ai
2. Navigate to Deployments
3. Find latest Preview deployment for branch `feat/paygate-server-enforcement`
4. Copy Preview URL (format: `https://finishline-wps-ai-xxx.vercel.app`)

**Method 2 - PR Comments:**
1. Visit: https://github.com/gmartindale44/finishline-wps-ai/pull/157
2. Look for Vercel bot comment with Preview URL

**Method 3 - PR Checks:**
1. Visit: https://github.com/gmartindale44/finishline-wps-ai/pull/157/checks
2. Find Vercel deployment check
3. Click "Details" to see deployment URL

---

## Section 1: Vercel Preview Environment Variables

### Test 1.1: Redis Diagnostic Endpoint

**Command:**
```powershell
# Replace <preview-url> with actual Preview URL
Invoke-RestMethod -Uri "https://<preview-url>/api/redis_diag" -Method GET | ConvertTo-Json
```

**Code Reference:** `pages/api/redis_diag.js:9-77`

**Expected Response:**
```json
{
  "ok": true,
  "redisConfigured": true,
  "urlHost": "<upstash-hostname>",
  "canWrite": true,
  "canRead": true,
  "wroteKey": "fl:diag:<timestamp>",
  "readBack": true,
  "error": null
}
```

**Actual Result:**
```
[PENDING: Run command and paste actual response]
```

**Findings:**
- [ ] `ENABLE_PRED_SNAPSHOTS=true` confirmed (via `redisConfigured: true` + write/read success)
- [ ] `UPSTASH_REDIS_REST_URL` exists (shown in `urlHost`)
- [ ] `UPSTASH_REDIS_REST_TOKEN` exists (confirmed by `canWrite: true`)
- [ ] No conflicting env vars detected

**Issues:** None / [List issues]

---

## Section 2: Predict Endpoint Snapshot Execution

### Test 2.1: Predict with Snapshot Write

**Command:**
```powershell
$body = @{
    track = "Gulfstream Park"
    date = "2026-01-07"
    raceNo = "8"
    surface = "Dirt"
    distance_input = "6f"
    horses = @(
        @{name = "Thunder Strike"; odds = "3/1"; post = 3}
        @{name = "Lightning Bolt"; odds = "5/2"; post = 5}
        @{name = "Silver Star"; odds = "7/2"; post = 2}
        @{name = "Dark Moon"; odds = "4/1"; post = 7}
        @{name = "Wind Runner"; odds = "6/1"; post = 1}
        @{name = "Fire Storm"; odds = "8/1"; post = 4}
    )
    speedFigs = @{
        "Thunder Strike" = 95
        "Lightning Bolt" = 92
        "Silver Star" = 88
        "Dark Moon" = 85
        "Wind Runner" = 83
        "Fire Storm" = 80
    }
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Uri "https://<preview-url>/api/predict_wps" -Method POST -ContentType 'application/json' -Body $body
$response.meta.raceId
$response.snapshot_debug | ConvertTo-Json
```

**Code Reference:** `pages/api/predict_wps.js:525-566` (deriveRaceId), `937-983` (snapshot write)

**Expected raceId Format:**
- Pattern: `YYYY-MM-DD|normalized track|raceNo`
- Example: `2026-01-07|gulfstream park|8`
- Normalization: lowercase, trim, collapse spaces, remove non-alphanumeric (lines 533-541)

**Actual Response:**
```
meta.raceId: [PENDING: Paste actual value]
snapshot_debug: [PENDING: Paste actual JSON]
```

**Verification:**
- [ ] `meta.raceId` matches pattern: `^\d{4}-\d{2}-\d{2}\|[^|]+\|\d+$`
- [ ] `snapshot_debug.enablePredSnapshots` = `true`
- [ ] `snapshot_debug.redisConfigured` = `true`
- [ ] `snapshot_debug.snapshotAttempted` = `true`
- [ ] `snapshot_debug.snapshotWriteOk` = `true`
- [ ] `snapshot_debug.snapshotKey` format: `fl:predsnap:{raceId}:{asOf}`
- [ ] `snapshot_debug.snapshotWriteError` = `null`

**Issues:** None / [List issues]

---

## Section 3: Upstash Verification

### Test 3.1: Verify Snapshot Keys Exist

**Prerequisites:**
- Get `UPSTASH_REDIS_REST_URL` from Vercel Preview environment
- Get `UPSTASH_REDIS_REST_TOKEN` from Vercel Preview environment

**Code Reference:** `pages/api/predict_wps.js:955,975` (key format and TTL)

**Upstash Query Script:**
```bash
# Set env vars from Vercel Preview
export UPSTASH_REDIS_REST_URL="<from-vercel>"
export UPSTASH_REDIS_REST_TOKEN="<from-vercel>"

# Search for all snapshot keys
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:predsnap:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Search for specific race (use raceId from Test 2.1)
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:predsnap:2026-01-07|gulfstream park|8:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Get specific snapshot key (use snapshotKey from Test 2.1)
curl -X GET "${UPSTASH_REDIS_REST_URL}/GET/fl:predsnap:2026-01-07|gulfstream park|8:2026-01-07T..." \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Check TTL
curl -X GET "${UPSTASH_REDIS_REST_URL}/TTL/fl:predsnap:2026-01-07|gulfstream park|8:2026-01-07T..." \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"
```

**Actual Results:**
```
fl:predsnap:* keys count: [PENDING]
Specific snapshot key exists: [PENDING: yes/no]
Snapshot key: [PENDING: paste key name]
TTL: [PENDING: paste TTL value]
```

**Verification:**
- [ ] Keys matching `fl:predsnap:*` found
- [ ] Specific snapshot key exists
- [ ] TTL > 0 and <= 604800 (7 days)
- [ ] Snapshot payload contains: `picks`, `ranking`, `confidence`, `top3_mass`, `meta.asOf`, `meta.raceId`

**Issues:** None / [List issues]

---

## Section 4: Verify Logging

### Test 4.1: Verify Race Endpoint

**Command:**
```powershell
$verifyBody = @{
    track = "Gulfstream Park"
    date = "2026-01-07"
    raceNo = "8"
    mode = "manual"
    outcome = @{
        win = "Thunder Strike"
        place = "Lightning Bolt"
        show = "Silver Star"
    }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "https://<preview-url>/api/verify_race" -Method POST -ContentType 'application/json' -Body $verifyBody
```

**Code Reference:** `pages/api/verify_race.js:17` (VERIFY_PREFIX), `500-507` (log write)

**Verify Log Key Format:**
- Prefix: `fl:verify:` (line 17)
- Pattern: `fl:verify:${raceId}` (line 500)
- TTL: 7776000 seconds / 90 days (line 503)

**Upstash Query:**
```bash
# Search for verify keys
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:verify:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Get specific verify log (use raceId from Test 2.1)
curl -X GET "${UPSTASH_REDIS_REST_URL}/GET/fl:verify:2026-01-07|gulfstream park|8" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}" | jq
```

**Expected Verify Log Structure:**
```json
{
  "debug": {
    "snapshotPattern": "fl:predsnap:2026-01-07|gulfstream park|8:*",
    "snapshotKeysFoundCount": 1,
    "snapshotSelectedAsOf": "2026-01-07T...",
    "snapshotSelectedKey": "fl:predsnap:2026-01-07|gulfstream park|8:2026-01-07T...",
    "verifyLogKey": "fl:verify:2026-01-07|gulfstream park|8",
    "verifyWriteOk": true,
    "verifyWriteError": null
  },
  "predsnap_asOf": "2026-01-07T..."
}
```

**Actual Results:**
```
Verify response: [PENDING: Paste actual response]
Verify log exists: [PENDING: yes/no]
Verify log key: [PENDING: paste key name]
Verify log debug fields: [PENDING: Paste debug object from verify log]
```

**Verification:**
- [ ] Verify log key exists: `fl:verify:2026-01-07|gulfstream park|8`
- [ ] `debug.verifyLogKey` matches expected prefix `fl:verify:`
- [ ] `debug.snapshotPattern` is correct
- [ ] `debug.snapshotKeysFoundCount` > 0 (if snapshot existed)
- [ ] `debug.snapshotSelectedKey` matches snapshot key from Test 2.1
- [ ] `debug.verifyWriteOk` = `true`
- [ ] `predsnap_asOf` exists in verify log (if snapshot was used)

**Issues:** None / [List issues]

---

## Summary

### Test Execution Status

| Test | Status | Evidence |
|------|--------|----------|
| 1.1 Redis Diagnostic | ⏳ Pending | Preview URL required |
| 2.1 Predict Snapshot | ⏳ Pending | Preview URL required |
| 3.1 Upstash Snapshot Keys | ⏳ Pending | Preview URL + Upstash credentials required |
| 4.1 Verify Log Write | ⏳ Pending | Preview URL required |
| 4.2 Upstash Verify Keys | ⏳ Pending | Preview URL + Upstash credentials required |

### Key Code References

**Snapshot Write:**
- `pages/api/predict_wps.js:937-983` - Snapshot write logic with debug tracking
- `pages/api/predict_wps.js:525-566` - Race ID derivation and normalization

**Verify Log Write:**
- `pages/api/verify_race.js:17` - VERIFY_PREFIX constant
- `pages/api/verify_race.js:500-507` - Verify log write with debug tracking
- `pages/api/verify_race.js:100-205` - Snapshot lookup logic

**Diagnostic:**
- `pages/api/redis_diag.js:9-77` - Redis connectivity diagnostic

### Next Steps

1. **Obtain Preview URL:**
   - Vercel Dashboard: https://vercel.com/hired-hive/finishline-wps-ai
   - PR #157: https://github.com/gmartindale44/finishline-wps-ai/pull/157

2. **Run Test Script:**
   ```powershell
   .\scripts\qa_test_preview.ps1 -PreviewUrl "<preview-url>"
   ```

3. **Query Upstash:**
   - Use Preview environment variables to query keys directly
   - Verify snapshot keys and verify log keys exist

4. **Update This Report:**
   - Fill in all `[PENDING]` sections with actual results
   - Document any issues found
   - Provide recommendations

---

**Document Created:** 2026-01-07  
**Last Updated:** 2026-01-07  
**Status:** ⏳ Awaiting test execution with Preview URL
