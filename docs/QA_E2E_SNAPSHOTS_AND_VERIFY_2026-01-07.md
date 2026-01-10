# QA E2E Test: Snapshot & Verify Logs on Vercel Preview

**Date:** 2026-01-07  
**PR #157:** https://github.com/gmartindale44/finishline-wps-ai/pull/157  
**Branch:** `feat/paygate-server-enforcement`  
**Test Type:** End-to-End Verification

---

## Test Objectives

1. ✅ Verify Vercel Preview environment variables are correctly set
2. ✅ Verify `/api/predict_wps` writes snapshots to Upstash
3. ✅ Verify snapshot keys exist in Upstash with correct format and TTL
4. ✅ Verify `/api/verify_race` writes verify logs to Upstash
5. ✅ Verify verify log keys exist and contain snapshot lookup debug info

---

## Test Execution

### Prerequisites

**Preview URL Required:**
- Get from Vercel Dashboard: https://vercel.com/hired-hive/finishline-wps-ai
- Or from PR #157 comments (Vercel bot posts Preview URL)
- Or from PR #157 checks tab → Vercel deployment

**Test Script:**
```powershell
.\scripts\qa_test_preview.ps1 -PreviewUrl "https://finishline-wps-ai-xxx.vercel.app"
```

---

## Section 1: Vercel Preview Environment Variables

### Test 1.1: Redis Diagnostic Endpoint

**Endpoint:** `GET /api/redis_diag`

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
[PENDING: Run test and paste actual response here]
```

**Findings:**
- [ ] `ENABLE_PRED_SNAPSHOTS=true` confirmed via `redisConfigured: true` + successful write/read
- [ ] `UPSTASH_REDIS_REST_URL` exists (hostname shown in `urlHost`)
- [ ] `UPSTASH_REDIS_REST_TOKEN` exists (confirmed by `canWrite: true`)
- [ ] No conflicting env vars detected

**Issues:**
- None / [List any issues found]

---

## Section 2: Predict Endpoint Snapshot Execution

### Test 2.1: Predict with Snapshot Write

**Endpoint:** `POST /api/predict_wps`

**Code Reference:** `pages/api/predict_wps.js:936-983`

**Request Body:**
```json
{
  "track": "Gulfstream Park",
  "date": "2026-01-07",
  "raceNo": "8",
  "surface": "Dirt",
  "distance_input": "6f",
  "horses": [
    {"name": "Thunder Strike", "odds": "3/1", "post": 3},
    {"name": "Lightning Bolt", "odds": "5/2", "post": 5},
    {"name": "Silver Star", "odds": "7/2", "post": 2},
    {"name": "Dark Moon", "odds": "4/1", "post": 7},
    {"name": "Wind Runner", "odds": "6/1", "post": 1},
    {"name": "Fire Storm", "odds": "8/1", "post": 4}
  ],
  "speedFigs": {
    "Thunder Strike": 95,
    "Lightning Bolt": 92,
    "Silver Star": 88,
    "Dark Moon": 85,
    "Wind Runner": 83,
    "Fire Storm": 80
  }
}
```

**Expected raceId Format:**
- Pattern: `YYYY-MM-DD|normalized track|raceNo`
- Example: `2026-01-07|gulfstream park|8`
- Normalization: lowercase, trim, collapse spaces, remove non-alphanumeric

**Code Reference:** `pages/api/predict_wps.js:525-566` (deriveRaceId function)

**Actual Response `snapshot_debug`:**
```
[PENDING: Paste actual snapshot_debug object here]
```

**Verification Checklist:**
- [ ] `meta.raceId` exists and matches pattern: `^\d{4}-\d{2}-\d{2}\|[^|]+\|\d+$`
- [ ] `meta.raceId` value: `[paste actual value]`
- [ ] `snapshot_debug.enablePredSnapshots` = `true`
- [ ] `snapshot_debug.redisConfigured` = `true`
- [ ] `snapshot_debug.snapshotAttempted` = `true`
- [ ] `snapshot_debug.snapshotWriteOk` = `true`
- [ ] `snapshot_debug.snapshotKey` exists and format: `fl:predsnap:{raceId}:{asOf}`
- [ ] `snapshot_debug.snapshotWriteError` = `null` (or absent)

**Issues:**
- None / [List any issues found]

---

## Section 3: Upstash Verification

### Test 3.1: Verify Snapshot Keys Exist

**Method:** Query Upstash REST API with same credentials as Preview deployment

**Code Reference:** `pages/api/predict_wps.js:955,975` (snapshot key format)

**Key Format:**
- Pattern: `fl:predsnap:${raceId}:${asOf}`
- Example: `fl:predsnap:2026-01-07|gulfstream park|8:2026-01-07T22:30:00.000Z`
- TTL: 604800 seconds (7 days)

**Upstash Query Commands:**
```bash
# Set env vars from Vercel Preview deployment
export UPSTASH_REDIS_REST_URL="<from-vercel>"
export UPSTASH_REDIS_REST_TOKEN="<from-vercel>"

# Search for snapshot keys
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:predsnap:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Search for specific race
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:predsnap:2026-01-07|gulfstream park|8:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Get specific snapshot key
curl -X GET "${UPSTASH_REDIS_REST_URL}/GET/${snapshotKey}" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Check TTL
curl -X GET "${UPSTASH_REDIS_REST_URL}/TTL/${snapshotKey}" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"
```

**Actual Results:**
```
[PENDING: Paste Upstash query results here]
```

**Verification Checklist:**
- [ ] Keys matching `fl:predsnap:*` found: `[count]`
- [ ] Specific snapshot key exists: `[yes/no]`
- [ ] Snapshot key: `[paste key name]`
- [ ] TTL > 0 and <= 604800 (7 days): `[TTL value]`
- [ ] Snapshot payload contains expected fields: `picks`, `ranking`, `confidence`, `top3_mass`, `meta.asOf`, `meta.raceId`

**Issues:**
- None / [List any issues found]

---

## Section 4: Verify Logging

### Test 4.1: Verify Race Endpoint

**Endpoint:** `POST /api/verify_race`

**Code Reference:** `pages/api/verify_race.js:17,500-507` (VERIFY_PREFIX and log write)

**Request Body:**
```json
{
  "track": "Gulfstream Park",
  "date": "2026-01-07",
  "raceNo": "8",
  "mode": "manual",
  "outcome": {
    "win": "Thunder Strike",
    "place": "Lightning Bolt",
    "show": "Silver Star"
  }
}
```

**Verify Log Key Format:**
- Prefix: `fl:verify:` (from `pages/api/verify_race.js:17`)
- Pattern: `fl:verify:${raceId}`
- Example: `fl:verify:2026-01-07|gulfstream park|8`
- TTL: 7776000 seconds (90 days)

**Expected Debug Fields in Verify Log:**
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

**Actual Response:**
```
[PENDING: Paste actual verify response here]
```

**Upstash Query for Verify Log:**
```bash
# Search for verify keys
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:verify:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Get specific verify log
curl -X GET "${UPSTASH_REDIS_REST_URL}/GET/fl:verify:2026-01-07|gulfstream park|8" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"
```

**Actual Upstash Results:**
```
[PENDING: Paste Upstash query results here]
```

**Verification Checklist:**
- [ ] Verify log key exists: `fl:verify:2026-01-07|gulfstream park|8`
- [ ] `debug.verifyLogKey` matches expected prefix `fl:verify:`
- [ ] `debug.snapshotPattern` is correct
- [ ] `debug.snapshotKeysFoundCount` > 0 (if snapshot existed)
- [ ] `debug.snapshotSelectedKey` matches snapshot key from predict
- [ ] `debug.verifyWriteOk` = `true`
- [ ] `predsnap_asOf` exists in verify log (if snapshot was used)

**Issues:**
- None / [List any issues found]

---

## Summary

### Test Results Summary

| Test | Status | Notes |
|------|--------|-------|
| Redis Diagnostic | ⏳ Pending | |
| Predict Snapshot Write | ⏳ Pending | |
| Upstash Snapshot Keys | ⏳ Pending | |
| Verify Log Write | ⏳ Pending | |
| Upstash Verify Keys | ⏳ Pending | |

### Key Findings

**Environment Variables:**
- `ENABLE_PRED_SNAPSHOTS`: [Not verified / Verified = true]
- `UPSTASH_REDIS_REST_URL`: [Not verified / Verified]
- `UPSTASH_REDIS_REST_TOKEN`: [Not verified / Verified]

**Snapshot Functionality:**
- Snapshot writes: [Not verified / Working / Failed]
- Snapshot key format: [Not verified / Correct / Incorrect]
- Snapshot TTL: [Not verified / Correct / Incorrect]

**Verify Functionality:**
- Verify log writes: [Not verified / Working / Failed]
- Verify log key format: [Not verified / Correct / Incorrect]
- Snapshot lookup in verify: [Not verified / Working / Failed]

### Issues Found

1. **None** / [List issues]

### Recommendations

1. [None / List recommendations]

---

## Test Execution Instructions

### Step 1: Get Preview URL

```bash
# Option 1: From Vercel Dashboard
# Visit: https://vercel.com/hired-hive/finishline-wps-ai
# Find latest Preview deployment for feat/paygate-server-enforcement

# Option 2: From PR comments
# Visit: https://github.com/gmartindale44/finishline-wps-ai/pull/157
# Look for Vercel bot comment with Preview URL
```

### Step 2: Run Test Script

```powershell
.\scripts\qa_test_preview.ps1 -PreviewUrl "<preview-url>"
```

### Step 3: Query Upstash

Use the same `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from Vercel Preview environment to query keys directly.

### Step 4: Fill in Results

Update this document with actual test results in the `[PENDING]` sections above.

---

**Document Status:** ⏳ Pending test execution  
**Next Update:** After Preview URL is obtained and tests are run
