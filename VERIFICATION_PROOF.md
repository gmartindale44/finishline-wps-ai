# Verification Proof - PayGate Test Mode + Routing

## 1. verify_race POST Path Unchanged Proof

### Diff Check

**Command:**
```bash
git diff HEAD~5 HEAD -- pages/api/verify_race.js
```

**Result:** Only change is debug header addition (line 1704):
```diff
+      res.setHeader('X-Handler-Identity', 'VERIFY_RACE_STUB');
```

**Verification:**
- ✅ POST path completely untouched
- ✅ Only header added to non-POST stub path
- ✅ No logic changes, no refactoring, no deletions
- ✅ verify_race behavior identical to before

### POST Test Command

```powershell
# Test verify_race POST (should work normally, not return stub)
$body = @{
    date = "2025-12-31"
    track = "Turfway Park"
    raceNo = "8"
} | ConvertTo-Json

Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/verify_race" `
  -Method POST `
  -Body $body `
  -ContentType "application/json" `
  -UseBasicParsing | Select-Object StatusCode, @{Name='X-Handler-Identity';Expression={$_.Headers['X-Handler-Identity']}}, @{Name='Body';Expression={$_.Content.Substring(0, [Math]::Min(200, $_.Content.Length))}}
```

**Expected:**
- Status: `200`
- Body: Should contain verify result (NOT `verify_race_stub`)
- Behavior: Identical to before (unchanged)

## 2. Paygate Endpoints Hit Correct Handlers

### Handler Presence

| Endpoint | Root `/api/` | `pages/api/` | Status |
|----------|--------------|--------------|--------|
| `/api/paygate-token` | ❌ Deleted | ✅ Exists | ✅ Correct |
| `/api/debug-paygate` | ❌ Deleted | ✅ Exists | ✅ Correct |

**Finding:** Root duplicates removed. Handlers exist only in `pages/api/`.

### Identity Headers Verification

**`/api/paygate-token` handler (`pages/api/paygate-token.js`):**
- Line 23: `res.setHeader('X-Handler-Identity', 'PAYGATE_TOKEN_OK');`
- Returns: JavaScript with `Content-Type: application/javascript`
- Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`

**`/api/debug-paygate` handler (`pages/api/debug-paygate.js`):**
- Line 22: `res.setHeader('X-Handler-Identity', 'DEBUG_PAYGATE_OK');`
- Returns: JSON with `Content-Type: application/json`
- Body contains: `{"ok": true, "apiRouteWorking": true, "handler": "debug-paygate", ...}`

### Test Commands

```powershell
# Test /api/paygate-token
$r1 = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Status: $($r1.StatusCode)"
Write-Host "X-Handler-Identity: $($r1.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r1.Headers['Content-Type'])"
Write-Host "Body starts with: $($r1.Content.Substring(0, 50))"
# Expected: X-Handler-Identity: PAYGATE_TOKEN_OK, Body starts with // PAYGATE_TOKEN_HANDLER_OK

# Test /api/debug-paygate
$r2 = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -UseBasicParsing
Write-Host "Status: $($r2.StatusCode)"
Write-Host "X-Handler-Identity: $($r2.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r2.Headers['Content-Type'])"
$r2.Content | ConvertFrom-Json | ConvertTo-Json
# Expected: X-Handler-Identity: DEBUG_PAYGATE_OK, JSON with ok:true
```

## 3. Test Mode Status

### Current Implementation

✅ **Test mode is implemented:**
- `pages/api/paygate-token.js` reads `NEXT_PUBLIC_PAYGATE_TEST_MODE` env var (line 43-44)
- Sets `window.__PAYGATE_TEST_MODE__` in JavaScript response (line 51)
- `public/js/paygate-helper.js` checks test mode at start of `isUnlocked()` (line 27-29)
- Returns `true` immediately if test mode enabled (line 35)
- `public/js/results-panel.js` shows green "TEST MODE" badge when enabled

### How to Enable in Vercel Preview

1. **Vercel Dashboard** → Project → Settings → Environment Variables
2. **Add Variable:**
   - Name: `NEXT_PUBLIC_PAYGATE_TEST_MODE`
   - Value: `true` (no equals sign, just the value)
   - Environment: **Preview** (NOT Production)
3. **Redeploy Preview** (or wait for next deployment)
4. **Verify:** Open Preview URL → Check console for `[PayGate] TEST MODE enabled`

## 4. Minimal Smoke Test Commands

### PowerShell (One-Liners)

```powershell
# Test 1: /api/paygate-token
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -UseBasicParsing; Write-Host "Status: $($r.StatusCode), Identity: $($r.Headers['X-Handler-Identity']), Body: $($r.Content.Substring(0, 50))"

# Test 2: /api/debug-paygate
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -UseBasicParsing; Write-Host "Status: $($r.StatusCode), Identity: $($r.Headers['X-Handler-Identity']), JSON: $($r.Content)"

# Test 3: /api/verify_race (GET - should return stub)
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/verify_race" -UseBasicParsing; Write-Host "Status: $($r.StatusCode), Identity: $($r.Headers['X-Handler-Identity']), Body: $($r.Content)"

# Test 4: /api/verify_race (POST - should work normally)
$body = '{"date":"2025-12-31","track":"Turfway Park","raceNo":"8"}'; $r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/verify_race" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing; Write-Host "Status: $($r.StatusCode), Body: $($r.Content.Substring(0, 200))"
```

### curl (Bash)

```bash
# Test 1: /api/paygate-token
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123" | grep -E "(HTTP|X-Handler-Identity|Content-Type)" | head -3

# Test 2: /api/debug-paygate
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123" | grep -E "(HTTP|X-Handler-Identity|Content-Type)" | head -3

# Test 3: /api/verify_race (GET)
curl -i "https://<PREVIEW-URL>/api/verify_race" | grep -E "(HTTP|X-Handler-Identity)" | head -2

# Test 4: /api/verify_race (POST)
curl -i -X POST "https://<PREVIEW-URL>/api/verify_race" -H "Content-Type: application/json" -d '{"date":"2025-12-31","track":"Turfway Park","raceNo":"8"}' | head -20
```

### Expected Results

**✅ `/api/paygate-token`:**
- Status: `200`
- `X-Handler-Identity: PAYGATE_TOKEN_OK`
- Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- ❌ Must NOT contain: `verify_race_stub`

**✅ `/api/debug-paygate`:**
- Status: `200`
- `X-Handler-Identity: DEBUG_PAYGATE_OK`
- JSON: `{"ok": true, "apiRouteWorking": true, "handler": "debug-paygate", ...}`
- ❌ Must NOT contain: `verify_race_stub`

**✅ `/api/verify_race` (GET):**
- Status: `200`
- `X-Handler-Identity: VERIFY_RACE_STUB` (debug header)
- JSON: `{"step": "verify_race_stub", ...}` (expected stub)

**✅ `/api/verify_race` (POST):**
- Status: `200`
- JSON: Verify result (NOT stub)
- ✅ Behavior identical to before

## Summary

✅ **verify_race unchanged:** Only debug header added, POST behavior identical  
✅ **Paygate endpoints isolated:** Root duplicates removed, handlers in `pages/api/` only  
✅ **Test mode implemented:** OFF by default, enabled via `NEXT_PUBLIC_PAYGATE_TEST_MODE=true`  
✅ **Identity headers present:** All handlers set correct `X-Handler-Identity` headers

**Action Required:**
1. Enable `NEXT_PUBLIC_PAYGATE_TEST_MODE=true` in Vercel Preview environment
2. Redeploy Preview
3. Run smoke test commands to verify routing

