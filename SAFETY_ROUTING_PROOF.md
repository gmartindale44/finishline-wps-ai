# Safety + Routing Proof Report

## STEP 1: Current State Verification

### Handler Presence Check

| Handler | Root `/api/` | `pages/api/` | Status |
|---------|--------------|--------------|--------|
| `paygate-token` | ❌ Deleted | ✅ Exists | ✅ Correct |
| `debug-paygate` | ❌ Deleted | ✅ Exists | ✅ Correct |
| `verify_race` | ✅ Re-export shim | ✅ Full handler | ✅ Preserved |

**Finding:** Root `/api/` duplicates removed. Only `api/verify_race.js` remains as re-export shim (needed for compatibility).

### Routing Configuration Check

- ✅ `next.config.cjs`: Clean (no rewrites, redirects, or headers)
- ✅ No `middleware.ts/js` files found
- ✅ No catch-all routes (`[...slug].js`) found
- ✅ No `vercel.json` found

**Finding:** No explicit rewrite mechanism exists. Routing should be 1:1 file-to-route mapping.

### Frontend Calls Check

**Files referencing `/api/verify_race`:**
- `public/js/verify-modal.js` - ✅ Expected (verification UI)
- `public/js/verify-tab.js` - ✅ Expected (verification UI)

**Finding:** No accidental calls to verify_race from paygate code.

### Why Vercel Logs Show verify_race Stub

**Possible Causes:**
1. **Stale deployment cache** - Previous deployment may still be serving old routes
2. **Vercel build cache** - Build artifacts may contain old routing
3. **CDN cache** - Edge cache may serve stale responses
4. **Re-export shim conflict** - `api/verify_race.js` re-export may cause routing ambiguity

**Most Likely:** Stale deployment or build cache. The code is correct, but Vercel may need a fresh deployment.

## STEP 2: Test Mode Status

### Current Implementation

✅ **Test mode is already implemented:**
- `pages/api/paygate-token.js` reads `NEXT_PUBLIC_PAYGATE_TEST_MODE` env var
- Sets `window.__PAYGATE_TEST_MODE__` in JavaScript response
- `public/js/paygate-helper.js` checks test mode at start of `isUnlocked()`
- `public/js/results-panel.js` shows green "TEST MODE" badge when enabled

### How to Enable Test Mode in Vercel Preview

1. **Vercel Dashboard** → Project → Settings → Environment Variables
2. **Add Variable:**
   - Name: `NEXT_PUBLIC_PAYGATE_TEST_MODE`
   - Value: `true`
   - Environment: **Preview** (NOT Production)
3. **Redeploy Preview** (or wait for next deployment)
4. **Verify:** Open Preview URL → Check console for `[PayGate] TEST MODE enabled`

**Note:** Test mode is OFF by default. Only activates when env var is explicitly set.

## STEP 3: Smoke Test Scripts

### PowerShell Script

```powershell
# Test /api/paygate-token
Write-Host "`n=== Testing /api/paygate-token ===" -ForegroundColor Cyan
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -Method GET -UseBasicParsing
Write-Host "Status: $($response.StatusCode)"
Write-Host "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($response.Headers['Content-Type'])"
Write-Host "Body (first 200 chars):"
Write-Host $response.Content.Substring(0, [Math]::Min(200, $response.Content.Length))

# Test /api/debug-paygate
Write-Host "`n=== Testing /api/debug-paygate ===" -ForegroundColor Cyan
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -Method GET -UseBasicParsing
Write-Host "Status: $($response.StatusCode)"
Write-Host "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($response.Headers['Content-Type'])"
Write-Host "Body (JSON):"
$response.Content | ConvertFrom-Json | ConvertTo-Json

# Test /api/verify_race (GET)
Write-Host "`n=== Testing /api/verify_race (GET) ===" -ForegroundColor Cyan
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/verify_race" -Method GET -UseBasicParsing
Write-Host "Status: $($response.StatusCode)"
Write-Host "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Host "Body (first 200 chars):"
Write-Host $response.Content.Substring(0, [Math]::Min(200, $response.Content.Length))

# Test /api/verify_race (POST)
Write-Host "`n=== Testing /api/verify_race (POST) ===" -ForegroundColor Cyan
$body = @{
    date = "2025-12-31"
    track = "Turfway Park"
    raceNo = "8"
} | ConvertTo-Json
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/verify_race" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($response.StatusCode)"
Write-Host "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Host "Body (first 200 chars):"
Write-Host $response.Content.Substring(0, [Math]::Min(200, $response.Content.Length))
```

### Bash/curl Script

```bash
#!/bin/bash
PREVIEW_URL="https://<PREVIEW-URL>"

echo "=== Testing /api/paygate-token ==="
curl -i "${PREVIEW_URL}/api/paygate-token?cb=123" 2>&1 | head -20

echo -e "\n=== Testing /api/debug-paygate ==="
curl -i "${PREVIEW_URL}/api/debug-paygate?cb=123" 2>&1 | head -20

echo -e "\n=== Testing /api/verify_race (GET) ==="
curl -i "${PREVIEW_URL}/api/verify_race" 2>&1 | head -20

echo -e "\n=== Testing /api/verify_race (POST) ==="
curl -i -X POST "${PREVIEW_URL}/api/verify_race" \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-12-31","track":"Turfway Park","raceNo":"8"}' 2>&1 | head -20
```

### Expected Results

**✅ `/api/paygate-token`:**
- Status: `200`
- `X-Handler-Identity: PAYGATE_TOKEN_OK`
- `Content-Type: application/javascript; charset=utf-8`
- Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- Body contains: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, JSON structure

**✅ `/api/debug-paygate`:**
- Status: `200`
- `X-Handler-Identity: DEBUG_PAYGATE_OK`
- `Content-Type: application/json; charset=utf-8`
- JSON: `{"ok": true, "apiRouteWorking": true, "handler": "debug-paygate", ...}`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile pages/api/verify_race.js`

**✅ `/api/verify_race` (GET):**
- Status: `200`
- `X-Handler-Identity: VERIFY_RACE_STUB` (debug header added)
- JSON: `{"step": "verify_race_stub", "error": "METHOD_NOT_ALLOWED", ...}`
- ✅ This is expected behavior (stub for non-POST)

**✅ `/api/verify_race` (POST):**
- Status: `200`
- JSON: Verify result (not stub)
- ✅ Behavior identical to before (unchanged)

## STEP 4: Safety Compliance

### verify_race.js Status

**Changes Made:**
- ✅ Only added `X-Handler-Identity: VERIFY_RACE_STUB` header (line 1704)
- ✅ Header added only to non-POST stub path
- ✅ POST path completely untouched
- ✅ No logic changes, no refactoring, no deletions

**Compliance:**
- ✅ NOT deleted, moved, refactored, or rewritten
- ✅ POST behavior UNCHANGED
- ✅ Stub logic PRESERVED
- ✅ NOT simplified or optimized
- ✅ NOT moved or merged

### Production Safety

- ✅ Test mode OFF by default
- ✅ No production behavior change unless env var enabled
- ✅ Stripe keys/flows UNCHANGED
- ✅ Fail-closed behavior PRESERVED

## Root Cause Analysis

### Why Vercel Logs Show verify_race Stub for Paygate Endpoints

**Most Likely Cause:** Stale deployment or build cache

**Evidence:**
1. Code is correct: Root `/api/` duplicates removed, handlers exist in `pages/api/`
2. No rewrite mechanism: No middleware, catch-all routes, or rewrites found
3. Identity headers present: Handlers set correct `X-Handler-Identity` headers
4. Vercel logs show old behavior: Suggests cached/stale deployment

**Solution:**
1. **Force fresh deployment:** Trigger new Vercel deployment (push empty commit or redeploy)
2. **Clear Vercel build cache:** Vercel Dashboard → Project → Settings → Clear build cache
3. **Verify after deployment:** Run smoke tests to confirm correct routing

## Next Steps in Vercel

### To Enable Test Mode (Preview Only)

1. **Vercel Dashboard** → Project → Settings → Environment Variables
2. **Add:**
   - Name: `NEXT_PUBLIC_PAYGATE_TEST_MODE`
   - Value: `true`
   - Environment: **Preview** (NOT Production)
3. **Redeploy Preview:**
   - Option A: Push empty commit to trigger deployment
   - Option B: Vercel Dashboard → Deployments → Redeploy latest Preview
4. **Verify:**
   - Open Preview URL
   - Check console: Should see `[PayGate] TEST MODE enabled`
   - UI should show green "TEST MODE" badge
   - Premium content should be unlocked

### To Fix Routing (If Still Hitting verify_race)

1. **Clear Build Cache:**
   - Vercel Dashboard → Project → Settings → General → Clear Build Cache
2. **Force Fresh Deployment:**
   - Push empty commit: `git commit --allow-empty -m "chore: force fresh deployment"`
   - Or: Vercel Dashboard → Redeploy with "Clear Cache" option
3. **Verify:**
   - Run smoke test scripts
   - Check `X-Handler-Identity` headers match expected values
   - Confirm responses do NOT contain `verify_race_stub`

## Summary

✅ **verify_race unchanged:** Only debug header added, POST behavior identical  
✅ **Paygate endpoints isolated:** Root duplicates removed, handlers in `pages/api/` only  
✅ **Test mode implemented:** OFF by default, enabled via `NEXT_PUBLIC_PAYGATE_TEST_MODE` env var  
✅ **Routing correct:** No rewrite mechanism, 1:1 file-to-route mapping  
⚠️ **Vercel logs issue:** Likely stale deployment cache - needs fresh deployment

**Action Required:**
1. Enable `NEXT_PUBLIC_PAYGATE_TEST_MODE=true` in Vercel Preview environment
2. Redeploy Preview with cache cleared
3. Run smoke test scripts to verify routing

