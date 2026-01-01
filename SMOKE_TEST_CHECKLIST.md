# Smoke Test Checklist - PayGate Test Mode

## Prerequisites

1. **Set Environment Variable in Vercel Preview:**
   - Vercel Dashboard → Project → Settings → Environment Variables
   - Add: `NEXT_PUBLIC_PAYGATE_TEST_MODE` = `true` (or `1`, `yes`, `on` - case-insensitive)
   - Environment: **Preview** (NOT Production)
   - Redeploy Preview after setting

2. **Get Preview URL:**
   - Vercel Dashboard → Deployments → Latest Preview
   - Copy the Preview URL (e.g., `https://finishline-wps-ai-abc123.vercel.app`)

## Test 1: /api/paygate-token

**URL:** `https://<PREVIEW-URL>/api/paygate-token?cb=123`

**PowerShell:**
```powershell
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r.Headers['Content-Type'])"
Write-Host "Body (first 300 chars):"
$r.Content.Substring(0, [Math]::Min(300, $r.Content.Length))
```

**curl:**
```bash
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123" | head -30
```

**Expected Results:**
- ✅ Status: `200`
- ✅ `X-Handler-Identity: PAYGATE_TOKEN_OK`
- ✅ `Content-Type: application/javascript; charset=utf-8`
- ✅ Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- ✅ Body contains: `window.__PAYGATE_TEST_MODE__ = true` (if test mode enabled)
- ✅ Body contains: `console.log('[PayGate] Token script loaded:'`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, JSON structure

**Check Response Body:**
- Look for: `window.__PAYGATE_TEST_MODE__ = true` (if test mode enabled)
- Look for: `testMode: true` in console.log output
- Look for: `testModeEnvValue: "true"` (or "1", "yes", "on") in console.log

## Test 2: /api/debug-paygate

**URL:** `https://<PREVIEW-URL>/api/debug-paygate?cb=123`

**PowerShell:**
```powershell
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r.Headers['Content-Type'])"
$r.Content | ConvertFrom-Json | ConvertTo-Json
```

**curl:**
```bash
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123" | head -30
```

**Expected Results:**
- ✅ Status: `200`
- ✅ `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ `Content-Type: application/json; charset=utf-8`
- ✅ JSON contains: `{"ok": true, "apiRouteWorking": true, "handler": "debug-paygate", ...}`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile pages/api/verify_race.js`

## Test 3: Browser Console Check (Test Mode Detection)

**Steps:**
1. Open Preview URL in browser
2. Open Developer Console (F12)
3. Look for console messages:

**Expected Console Messages (if test mode enabled):**
```
[PayGate] Token script loaded: { hasTokenVersion: ..., familyUnlockDays: ..., testMode: true, testModeEnvValue: "true" }
[PayGate] Test mode check: { testModeValue: true, testModeEnabled: true, testModeType: "boolean" }
[PayGate] TEST MODE enabled - bypassing paygate checks
[FLResults] Test mode badge check: { testModeValue: true, testModeEnabled: true, testModeType: "boolean" }
[FLResults] TEST MODE badge displayed
```

**Expected Console Messages (if test mode disabled):**
```
[PayGate] Token script loaded: { hasTokenVersion: ..., familyUnlockDays: ..., testMode: false, testModeEnvValue: "" }
[PayGate] Test mode check: { testModeValue: false, testModeEnabled: false, testModeType: "boolean" }
```

## Test 4: UI Badge Check

**Steps:**
1. Open Preview URL in browser
2. Generate predictions (or open results panel)
3. Look for badge in results panel title

**Expected (if test mode enabled):**
- ✅ Green badge with text "TEST MODE ON" visible
- ✅ Badge appears next to results title

**Expected (if test mode disabled):**
- ✅ No badge visible (or badge hidden)

## Test 5: App Access Check

**Steps:**
1. Open Preview URL in browser
2. Try to access premium content (predictions, confidence scores, etc.)

**Expected (if test mode enabled):**
- ✅ Premium content unlocked (visible)
- ✅ No paywall blocking access
- ✅ "I already paid" button works immediately (if present)

**Expected (if test mode disabled):**
- ✅ Normal fail-closed behavior
- ✅ Premium content locked by default
- ✅ Paywall visible

## Test 6: verify_race Safety Check (POST)

**URL:** `https://<PREVIEW-URL>/api/verify_race`

**PowerShell:**
```powershell
$body = @{date="2025-12-31";track="Turfway Park";raceNo="8"} | ConvertTo-Json
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/verify_race" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "Body (first 200 chars):"
$r.Content.Substring(0, [Math]::Min(200, $r.Content.Length))
```

**curl:**
```bash
curl -i -X POST "https://<PREVIEW-URL>/api/verify_race" \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-12-31","track":"Turfway Park","raceNo":"8"}' | head -30
```

**Expected Results:**
- ✅ Status: `200`
- ✅ Body contains verify result (NOT `verify_race_stub`)
- ✅ Behavior identical to before (unchanged)

## Summary Checklist

- [ ] `/api/paygate-token` returns JavaScript with `X-Handler-Identity: PAYGATE_TOKEN_OK`
- [ ] `/api/paygate-token` body contains `window.__PAYGATE_TEST_MODE__ = true` (if enabled)
- [ ] `/api/debug-paygate` returns JSON with `X-Handler-Identity: DEBUG_PAYGATE_OK`
- [ ] Console shows test mode detection messages
- [ ] UI shows "TEST MODE ON" badge when enabled
- [ ] App is accessible (premium content unlocked) when test mode enabled
- [ ] `/api/verify_race` POST works normally (unchanged behavior)
- [ ] No `verify_race_stub` in paygate endpoint responses

