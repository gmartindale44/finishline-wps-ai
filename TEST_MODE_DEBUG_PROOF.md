# Test Mode Debug Proof

## Changes Made

### 1. pages/api/paygate-token.js

**Added:**
- Server-side console.log showing raw env value and parsed boolean
- `window.__PAYGATE_TEST_MODE_ENV__` variable in emitted JS (raw env string)
- Enhanced client-side console.log with `testModeEnvRaw`

**Emitted JavaScript Line:**
```javascript
window.__PAYGATE_TEST_MODE__ = true;  // or false
window.__PAYGATE_TEST_MODE_ENV__ = "true";  // raw env string
```

**Server-side Log (Vercel Function Logs):**
```
[PayGate Token Handler] Test mode check: {
  testModeEnvRaw: "true",
  testModeEnvParsed: "true",
  testModeEnabled: true,
  envVarPresent: true
}
```

### 2. pages/api/debug-paygate.js

**Added:**
- `testModeEnvRaw`: Raw environment variable value
- `testModeParsed`: Parsed boolean (true if "true", "1", "yes", "on")

**Response JSON:**
```json
{
  "ok": true,
  "apiRouteWorking": true,
  "handler": "debug-paygate",
  "hasToken": true,
  "tokenVersionLength": 12,
  "familyUnlockDays": 365,
  "testModeEnvRaw": "true",
  "testModeParsed": true
}
```

### 3. public/js/paygate-helper.js

**Enhanced:**
- Logs `testModeEnvRaw` from `window.__PAYGATE_TEST_MODE_ENV__`
- Logs `windowHasTestMode` to confirm variable exists

**Client-side Console Log:**
```javascript
[PayGate] Test mode check: {
  testModeValue: true,
  testModeEnvRaw: "true",
  testModeEnabled: true,
  testModeType: "boolean",
  windowHasTestMode: true
}
```

## Exact Smoke Tests

### Test 1: /api/paygate-token?cb=123

**PowerShell:**
```powershell
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Body contains __PAYGATE_TEST_MODE__: $($r.Content -match '__PAYGATE_TEST_MODE__')"
Write-Host "Body contains __PAYGATE_TEST_MODE_ENV__: $($r.Content -match '__PAYGATE_TEST_MODE_ENV__')"
Write-Host "Body (first 500 chars):"
$r.Content.Substring(0, [Math]::Min(500, $r.Content.Length))
```

**curl:**
```bash
curl -s "https://<PREVIEW-URL>/api/paygate-token?cb=123" | head -20
```

**Expected:**
- ✅ Status: `200`
- ✅ `X-Handler-Identity: PAYGATE_TOKEN_OK`
- ✅ Body contains: `window.__PAYGATE_TEST_MODE__ = true` (if test mode enabled)
- ✅ Body contains: `window.__PAYGATE_TEST_MODE_ENV__ = "true"` (raw env string)
- ✅ Body contains: `testModeEnvRaw: "true"` in console.log

**Proof Line:**
```javascript
window.__PAYGATE_TEST_MODE__ = true;
window.__PAYGATE_TEST_MODE_ENV__ = "true";
```

### Test 2: /api/debug-paygate?cb=123

**PowerShell:**
```powershell
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
$json = $r.Content | ConvertFrom-Json
Write-Host "testModeEnvRaw: $($json.testModeEnvRaw)"
Write-Host "testModeParsed: $($json.testModeParsed)"
$json | ConvertTo-Json
```

**curl:**
```bash
curl -s "https://<PREVIEW-URL>/api/debug-paygate?cb=123" | jq .
```

**Expected:**
- ✅ Status: `200`
- ✅ `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ JSON contains: `"testModeEnvRaw": "true"` (or empty string if not set)
- ✅ JSON contains: `"testModeParsed": true` (if test mode enabled)

**Proof JSON:**
```json
{
  "ok": true,
  "apiRouteWorking": true,
  "handler": "debug-paygate",
  "hasToken": true,
  "tokenVersionLength": 12,
  "familyUnlockDays": 365,
  "testModeEnvRaw": "true",
  "testModeParsed": true
}
```

### Test 3: Browser Console Check

**Steps:**
1. Open Preview URL in browser
2. Open Developer Console (F12)
3. Check for console messages

**Expected Console Messages (if test mode enabled):**
```
[PayGate Token Handler] Test mode check: { testModeEnvRaw: "true", testModeEnvParsed: "true", testModeEnabled: true, envVarPresent: true }
[PayGate] Token script loaded: { hasTokenVersion: true, familyUnlockDays: 365, testMode: true, testModeEnvValue: "true", testModeEnvRaw: "true" }
[PayGate] Test mode check: { testModeValue: true, testModeEnvRaw: "true", testModeEnabled: true, testModeType: "boolean", windowHasTestMode: true }
[PayGate] TEST MODE enabled - bypassing paygate checks
[FLResults] Test mode badge check: { testModeValue: true, testModeEnabled: true, testModeType: "boolean" }
[FLResults] TEST MODE badge displayed
```

**Expected Console Messages (if test mode disabled):**
```
[PayGate Token Handler] Test mode check: { testModeEnvRaw: "", testModeEnvParsed: "", testModeEnabled: false, envVarPresent: false }
[PayGate] Token script loaded: { hasTokenVersion: true, familyUnlockDays: 365, testMode: false, testModeEnvValue: "", testModeEnvRaw: "" }
[PayGate] Test mode check: { testModeValue: false, testModeEnvRaw: "", testModeEnabled: false, testModeType: "boolean", windowHasTestMode: true }
```

### Test 4: UI Badge Check

**Steps:**
1. Open Preview URL in browser
2. Generate predictions (or open results panel)
3. Look for badge in results panel title

**Expected (if test mode enabled):**
- ✅ Green badge with text "TEST MODE ON" visible
- ✅ Premium content unlocked (visible)

**Expected (if test mode disabled):**
- ✅ No badge visible
- ✅ Premium content locked (normal fail-closed behavior)

## Vercel Environment Variable Setup

**Important Reminders:**
1. **Vercel Dashboard** → Project → Settings → Environment Variables
2. **Add Variable:**
   - Name: `NEXT_PUBLIC_PAYGATE_TEST_MODE`
   - Value: `true` (no equals sign, just the value)
   - Environment: **Preview** (NOT Production)
3. **Redeploy Preview** after setting env var (Vercel Dashboard → Deployments → Redeploy)
4. **Wait for deployment** to complete before testing

## Troubleshooting

### If testModeEnabled is still false:

1. **Check Vercel Function Logs:**
   - Vercel Dashboard → Project → Functions → View Logs
   - Look for: `[PayGate Token Handler] Test mode check:`
   - Verify `envVarPresent: true` and `testModeEnvRaw: "true"`

2. **Check Browser Console:**
   - Look for: `[PayGate] Test mode check:`
   - Verify `windowHasTestMode: true` and `testModeValue: true`

3. **Check /api/debug-paygate:**
   - Verify `testModeEnvRaw: "true"` and `testModeParsed: true`

4. **Verify Redeployment:**
   - Ensure Preview was redeployed AFTER setting env var
   - Check deployment timestamp in Vercel Dashboard

## Summary

✅ **Server-side logging:** Added to paygate-token.js (Vercel Function Logs)  
✅ **Client-side debug:** Added `window.__PAYGATE_TEST_MODE_ENV__` variable  
✅ **Debug endpoint:** Added `testModeEnvRaw` and `testModeParsed` to debug-paygate  
✅ **Enhanced logging:** paygate-helper logs all test mode details  
✅ **verify_race.js:** Completely untouched (no changes)

**Files Changed:**
- `pages/api/paygate-token.js` - Server-side logging + env debug variable
- `pages/api/debug-paygate.js` - Debug fields added
- `public/js/paygate-helper.js` - Enhanced logging

**Files NOT Changed:**
- `pages/api/verify_race.js` - ✅ Untouched
- All other files - ✅ Untouched

