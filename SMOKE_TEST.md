# Smoke Test - PayGate Routing Fix

## Prerequisites

1. **Get Preview URL:**
   - Vercel Dashboard → Deployments → Latest Preview
   - Copy the Preview URL (e.g., `https://finishline-wps-ai-abc123.vercel.app`)

2. **Set Variable in PowerShell:**
   ```powershell
   $PreviewUrl = "https://<YOUR-PREVIEW-URL>.vercel.app"
   ```

## Test 1: /api/paygate-token?cb=123

### PowerShell
```powershell
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r.Headers['Content-Type'])"
Write-Host "Cache-Control: $($r.Headers['Cache-Control'])"
Write-Host "Body (first 300 chars):"
$r.Content.Substring(0, [Math]::Min(300, $r.Content.Length))
```

### Expected Results
- ✅ Status: `200`
- ✅ `X-Handler-Identity: PAYGATE_TOKEN_OK`
- ✅ `Content-Type: application/javascript; charset=utf-8`
- ✅ `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- ✅ Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- ✅ Body contains: `window.__PAYGATE_TEST_MODE__ = true` (or `false`)
- ✅ Body contains: `window.__PAYGATE_TEST_MODE_ENV__ = "true"` (or empty string)
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, JSON structure, `handlerFile pages/api/verify_race.js`

### Proof
```javascript
// PAYGATE_TOKEN_HANDLER_OK
window.__PAYGATE_TEST_MODE__ = true;
window.__PAYGATE_TEST_MODE_ENV__ = "true";
```

## Test 2: /api/debug-paygate?cb=123

### PowerShell
```powershell
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/debug-paygate?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r.Headers['Content-Type'])"
Write-Host "Cache-Control: $($r.Headers['Cache-Control'])"
$json = $r.Content | ConvertFrom-Json
Write-Host "handler: $($json.handler)"
Write-Host "testModeEnvRaw: $($json.testModeEnvRaw)"
Write-Host "testModeParsed: $($json.testModeParsed)"
$json | ConvertTo-Json
```

### Expected Results
- ✅ Status: `200`
- ✅ `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ `Content-Type: application/json; charset=utf-8`
- ✅ `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- ✅ JSON contains: `"handler": "debug-paygate"`
- ✅ JSON contains: `"ok": true`
- ✅ JSON contains: `"testModeEnvRaw": "true"` (or empty string)
- ✅ JSON contains: `"testModeParsed": true` (if test mode enabled)
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile pages/api/verify_race.js`

### Proof
```json
{
  "ok": true,
  "apiRouteWorking": true,
  "handler": "debug-paygate",
  "testModeEnvRaw": "true",
  "testModeParsed": true
}
```

## Test 3: /api/verify_race (POST) - Regression Check

### PowerShell
```powershell
$body = @{
    date = "2025-12-31"
    track = "Turfway Park"
    raceNo = "8"
} | ConvertTo-Json

$r = Invoke-WebRequest -Uri "$PreviewUrl/api/verify_race" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "Body (first 200 chars):"
$r.Content.Substring(0, [Math]::Min(200, $r.Content.Length))
```

### Expected Results
- ✅ Status: `200`
- ✅ Body contains verify result (NOT `verify_race_stub`)
- ✅ Behavior identical to before (unchanged)

## Test 4: Other /api Endpoints - Regression Check

### /api/health
```powershell
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/health" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
```

### /api/tracks
```powershell
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/tracks" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
```

### Expected Results
- ✅ All existing endpoints continue to work
- ✅ No regressions

## Complete Test Script

```powershell
# Set your Preview URL
$PreviewUrl = "https://<YOUR-PREVIEW-URL>.vercel.app"

Write-Host "`n=== Test 1: /api/paygate-token ===" -ForegroundColor Cyan
$r1 = Invoke-WebRequest -Uri "$PreviewUrl/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Status: $($r1.StatusCode)"
Write-Host "X-Handler-Identity: $($r1.Headers['X-Handler-Identity'])"
if ($r1.Headers['X-Handler-Identity'] -eq 'PAYGATE_TOKEN_OK' -and $r1.Content -match 'PAYGATE_TOKEN_HANDLER_OK') {
    Write-Host "✅ PASS" -ForegroundColor Green
} else {
    Write-Host "❌ FAIL" -ForegroundColor Red
}

Write-Host "`n=== Test 2: /api/debug-paygate ===" -ForegroundColor Cyan
$r2 = Invoke-WebRequest -Uri "$PreviewUrl/api/debug-paygate?cb=123" -UseBasicParsing
Write-Host "Status: $($r2.StatusCode)"
Write-Host "X-Handler-Identity: $($r2.Headers['X-Handler-Identity'])"
$json2 = $r2.Content | ConvertFrom-Json
if ($r2.Headers['X-Handler-Identity'] -eq 'DEBUG_PAYGATE_OK' -and $json2.handler -eq 'debug-paygate') {
    Write-Host "✅ PASS" -ForegroundColor Green
} else {
    Write-Host "❌ FAIL" -ForegroundColor Red
}

Write-Host "`n=== Test 3: /api/verify_race (POST) ===" -ForegroundColor Cyan
$body = @{date="2025-12-31";track="Turfway Park";raceNo="8"} | ConvertTo-Json
$r3 = Invoke-WebRequest -Uri "$PreviewUrl/api/verify_race" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($r3.StatusCode)"
if ($r3.StatusCode -eq 200 -and $r3.Content -notmatch 'verify_race_stub') {
    Write-Host "✅ PASS" -ForegroundColor Green
} else {
    Write-Host "❌ FAIL" -ForegroundColor Red
}

Write-Host "`n=== Tests Complete ===" -ForegroundColor Green
```

## Summary Checklist

- [ ] `/api/paygate-token` returns JavaScript with `X-Handler-Identity: PAYGATE_TOKEN_OK`
- [ ] `/api/paygate-token` body starts with `// PAYGATE_TOKEN_HANDLER_OK`
- [ ] `/api/debug-paygate` returns JSON with `X-Handler-Identity: DEBUG_PAYGATE_OK`
- [ ] `/api/debug-paygate` JSON contains `"handler": "debug-paygate"`
- [ ] `/api/verify_race` POST works normally (unchanged behavior)
- [ ] Other `/api` endpoints continue to work (no regressions)
- [ ] No `verify_race_stub` in paygate endpoint responses
