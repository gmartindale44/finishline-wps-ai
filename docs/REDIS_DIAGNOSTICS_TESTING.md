# Redis Diagnostics & Snapshot Testing Guide

**Date:** 2026-01-07  
**PR #157:** https://github.com/gmartindale44/finishline-wps-ai/pull/157  
**Branch:** `feat/paygate-server-enforcement`

---

## Changes Made

### 1. Redis Diagnostic Endpoint (`/api/redis_diag`)
- **Path:** `pages/api/redis_diag.js`
- **Method:** GET
- **Returns:** Non-sensitive Redis connectivity info

**Response Format:**
```json
{
  "ok": true,
  "redisConfigured": true/false,
  "urlHost": "hostname or 'missing'",
  "canWrite": true/false,
  "canRead": true/false,
  "wroteKey": "fl:diag:<timestamp>",
  "readBack": true/false,
  "error": null or error message
}
```

### 2. Enhanced Snapshot Debug (`/api/predict_wps`)
- Added to `snapshot_debug` object in response:
  - `snapshotKey`: Full key name (e.g., `fl:predsnap:2026-01-07|track|1:2026-01-07T...`)
  - `snapshotWriteError`: Error message if write fails (optional)

### 3. Enhanced Verify Debug (`/api/verify_race`)
- Added to `debug` object in verify log:
  - `snapshotPattern`: Pattern searched (e.g., `fl:predsnap:2026-01-07|track|1:*`)
  - `snapshotSelectedKey`: Key name of selected snapshot (or null)
  - `verifyLogKey`: Verify log key name (e.g., `fl:verify:2026-01-07|track|1`)
  - `verifyWriteOk`: Boolean indicating if verify log write succeeded
  - `verifyWriteError`: Error message if verify log write fails (optional)

---

## Testing Steps (After Preview Deployment)

### Step 1: Test Redis Connectivity

**Call:** `GET https://<preview-url>/api/redis_diag`

**Expected Result:**
```json
{
  "ok": true,
  "redisConfigured": true,
  "urlHost": "<upstash-hostname>",
  "canWrite": true,
  "canRead": true,
  "wroteKey": "fl:diag:1704662400000",
  "readBack": true,
  "error": null
}
```

**If `redisConfigured: false`:**
- Check Vercel Preview environment variables
- Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set

**If `canWrite: false` or `canRead: false`:**
- Check Upstash credentials
- Verify Upstash database is active
- Check network connectivity from Vercel to Upstash

---

### Step 2: Test Snapshot Write

**Call:** `POST https://<preview-url>/api/predict_wps`

**Request Body:**
```json
{
  "track": "Tampa Bay Downs",
  "date": "2026-01-07",
  "raceNo": "8",
  "surface": "Dirt",
  "distance_input": "6f",
  "horses": [
    {"name": "Fast Runner", "odds": "2/1", "post": 1},
    {"name": "Swift Wind", "odds": "3/1", "post": 2},
    {"name": "Quick Dash", "odds": "4/1", "post": 3},
    {"name": "Speed Demon", "odds": "5/1", "post": 4},
    {"name": "Rapid Fire", "odds": "6/1", "post": 5},
    {"name": "Lightning Bolt", "odds": "8/1", "post": 6}
  ],
  "speedFigs": {
    "Fast Runner": 92,
    "Swift Wind": 90,
    "Quick Dash": 88,
    "Speed Demon": 86,
    "Rapid Fire": 84,
    "Lightning Bolt": 82
  }
}
```

**Check Response `snapshot_debug` Object:**
```json
{
  "snapshot_debug": {
    "enablePredSnapshots": true,
    "redisConfigured": true,
    "snapshotAttempted": true,
    "snapshotKey": "fl:predsnap:2026-01-07|tampa bay downs|8:2026-01-07T...",
    "snapshotWriteOk": true,
    "snapshotWriteError": null
  }
}
```

**Key Fields to Verify:**
- `enablePredSnapshots`: Should be `true` if `ENABLE_PRED_SNAPSHOTS=true` is set
- `snapshotAttempted`: Should be `true` if `raceId` was derived (requires `date` + `raceNo` + `track`)
- `snapshotKey`: Full key name that should appear in Upstash
- `snapshotWriteOk`: Should be `true` if write succeeded

---

### Step 3: Verify Snapshot in Upstash

**Using Upstash UI:**
1. Log into Upstash Console
2. Select the database used by Vercel Preview
3. Search for the exact `snapshotKey` from Step 2 response
4. Verify the key exists and contains the snapshot payload

**Using Upstash REST API (if key not found in UI):**
```bash
# Set these from Vercel Preview environment variables
export UPSTASH_REDIS_REST_URL="<from-vercel>"
export UPSTASH_REDIS_REST_TOKEN="<from-vercel>"

# Search for snapshot keys
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:predsnap:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Search for verify keys
curl -X GET "${UPSTASH_REDIS_REST_URL}/KEYS/fl:verify:*" \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"

# Get specific snapshot key
curl -X GET "${UPSTASH_REDIS_REST_URL}/GET/fl:predsnap:2026-01-07|tampa bay downs|8:..." \
  -H "Authorization: Bearer ${UPSTASH_REDIS_REST_TOKEN}"
```

**Expected:**
- `fl:predsnap:*` keys should exist if snapshots are enabled and writes succeeded
- Key payload should match the structure written in `predict_wps.js`

---

### Step 4: Test Verify with Snapshot Lookup

**Call:** `POST https://<preview-url>/api/verify_race`

**Request Body:**
```json
{
  "track": "Tampa Bay Downs",
  "date": "2026-01-07",
  "raceNo": "8",
  "mode": "manual",
  "outcome": {
    "win": "Fast Runner",
    "place": "Swift Wind",
    "show": "Quick Dash"
  }
}
```

**Check Verify Log in Upstash:**
1. Search for verify log key: `fl:verify:2026-01-07|tampa bay downs|8`
2. Parse the JSON and check the `debug` object:

**Expected Debug Fields:**
```json
{
  "debug": {
    "snapshotPattern": "fl:predsnap:2026-01-07|tampa bay downs|8:*",
    "snapshotKeysFoundCount": 1,
    "snapshotSelectedAsOf": "2026-01-07T...",
    "snapshotSelectedKey": "fl:predsnap:2026-01-07|tampa bay downs|8:2026-01-07T...",
    "verifyLogKey": "fl:verify:2026-01-07|tampa bay downs|8",
    "verifyWriteOk": true,
    "verifyWriteError": null
  },
  "predsnap_asOf": "2026-01-07T..."
}
```

**If `snapshotKeysFoundCount: 0`:**
- Check if snapshot was written (Step 2)
- Verify `snapshotPattern` matches the actual key format
- Check Upstash database matches the one used by Vercel Preview

**If `verifyWriteOk: false`:**
- Check `verifyWriteError` for specific error
- Verify Redis credentials are correct
- Check Upstash quota/limits

---

## Troubleshooting

### Issue: `fl:predsnap:*` keys not found in Upstash

**Possible Causes:**
1. `ENABLE_PRED_SNAPSHOTS` not set to `true` in Vercel Preview
2. `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` incorrect
3. Wrong Upstash database (Preview might use different database than Production)
4. Network issue preventing write completion
5. Upstash quota exceeded

**Diagnosis:**
- Check `/api/redis_diag` response
- Check `snapshot_debug.snapshotWriteOk` in predict response
- Check `snapshot_debug.snapshotWriteError` for error message

### Issue: `fl:verify:*` keys not found

**Possible Causes:**
1. Verify log write failed silently
2. Wrong Upstash database
3. Redis credentials issue

**Diagnosis:**
- Check verify log debug fields (`verifyWriteOk`, `verifyWriteError`)
- Check Upstash logs for failed requests
- Verify Redis credentials match preview environment

### Issue: Snapshots written but not found by verify

**Possible Causes:**
1. Race ID format mismatch (normalization differences)
2. Different Upstash database for reads vs writes
3. Timing issue (verify called before snapshot write completes)

**Diagnosis:**
- Compare `snapshotPattern` in verify debug with actual `snapshotKey` from predict
- Verify both use same Upstash database
- Check that snapshot write completed before verify (both are awaited now)

---

## Summary

After deployment, use these endpoints to diagnose:
1. `/api/redis_diag` - Test basic Redis connectivity
2. `/api/predict_wps` - Check `snapshot_debug` for write status
3. `/api/verify_race` - Check `debug` in verify log for lookup status

All debug fields are non-sensitive (key names only, no secrets or tokens).

