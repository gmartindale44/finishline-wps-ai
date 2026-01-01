# Smoke Test Checklist - PayGate Routing

## Quick Test Commands

### Test 1: /api/paygate-token?cb=123

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
- ✅ Body contains: `window.__PAYGATE_TEST_MODE__ = true` (or `false`)
- ✅ Body contains: `window.__PAYGATE_TEST_MODE_ENV__ = "true"` (raw env string)
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, JSON structure

**Proof Line:**
```javascript
// PAYGATE_TOKEN_HANDLER_OK
window.__PAYGATE_TEST_MODE__ = true;
window.__PAYGATE_TEST_MODE_ENV__ = "true";
```

### Test 2: /api/debug-paygate?cb=123

**PowerShell:**
```powershell
$r = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r.Headers['Content-Type'])"
$json = $r.Content | ConvertFrom-Json
Write-Host "testModeEnvRaw: $($json.testModeEnvRaw)"
Write-Host "testModeParsed: $($json.testModeParsed)"
$json | ConvertTo-Json
```

**curl:**
```bash
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123" | head -30
```

**Expected Results:**
- ✅ Status: `200`
- ✅ `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ `Content-Type: application/json; charset=utf-8`
- ✅ JSON contains: `"handler": "debug-paygate"`
- ✅ JSON contains: `"testModeEnvRaw": "true"` (or empty string if not set)
- ✅ JSON contains: `"testModeParsed": true` (if test mode enabled)
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile pages/api/verify_race.js`

**Proof JSON:**
```json
{
  "ok": true,
  "apiRouteWorking": true,
  "handler": "debug-paygate",
  "testModeEnvRaw": "true",
  "testModeParsed": true
}
```

### Test 3: Browser Console Check

**Steps:**
1. Open Preview URL in browser
2. Open Developer Console (F12)
3. Check for console messages

**Expected (if test mode enabled):**
```
[PayGate Token Handler] Test mode check: { testModeEnvRaw: "true", testModeEnabled: true, ... }
[PayGate] Token script loaded: { testMode: true, testModeEnvRaw: "true", ... }
[PayGate] Test mode check: { testModeValue: true, testModeEnabled: true, ... }
[PayGate] TEST MODE enabled - bypassing paygate checks
[FLResults] TEST MODE badge displayed
```

### Test 4: UI Badge Check

**Steps:**
1. Open Preview URL in browser
2. Generate predictions (or open results panel)
3. Look for badge in results panel title

**Expected (if test mode enabled):**
- ✅ Green badge with text "TEST MODE ON" visible
- ✅ Premium content unlocked (visible)

## Failure Indicators

If you see these, routing is WRONG:
- ❌ `X-Handler-Identity: VERIFY_RACE_STUB` on paygate endpoints
- ❌ Body contains `"step": "verify_race_stub"`
- ❌ Body contains `"error": "METHOD_NOT_ALLOWED"`
- ❌ Body contains `"handlerFile": "pages/api/verify_race.js"`
- ❌ `Content-Type: application/json` on `/api/paygate-token` (should be JavaScript)

## Success Indicators

If you see these, routing is CORRECT:
- ✅ `X-Handler-Identity: PAYGATE_TOKEN_OK` on `/api/paygate-token`
- ✅ `X-Handler-Identity: DEBUG_PAYGATE_OK` on `/api/debug-paygate`
- ✅ Body starts with `// PAYGATE_TOKEN_HANDLER_OK` on `/api/paygate-token`
- ✅ JSON with `"handler": "debug-paygate"` on `/api/debug-paygate`
- ✅ No `verify_race_stub` in responses
