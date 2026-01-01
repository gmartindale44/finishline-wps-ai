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

## Test 5: /api/photo_extract_openai_b64 (POST) - OCR Endpoint

### PowerShell
```powershell
# Create a minimal test payload (base64-encoded 1x1 transparent PNG)
$testB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
$body = @{
    b64 = $testB64
} | ConvertTo-Json

$r = Invoke-WebRequest -Uri "$PreviewUrl/api/photo_extract_openai_b64" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r.Headers['Content-Type'])"
$json = $r.Content | ConvertFrom-Json
Write-Host "ok: $($json.ok)"
Write-Host "error: $($json.error)"
$json | ConvertTo-Json
```

### Expected Results
- ✅ Status: `200` (or `400`/`500` with proper error message)
- ✅ `X-Handler-Identity: PHOTO_EXTRACT_OK`
- ✅ `Content-Type: application/json; charset=utf-8`
- ✅ JSON contains: `"ok": true` (on success) or `"ok": false` with `"error"` field (on failure)
- ❌ Must NOT return: `405 Method Not Allowed`

### Alternative Payload Formats (All Should Work)
```powershell
# Format 1: { b64: string }
$body1 = @{ b64 = $testB64 } | ConvertTo-Json

# Format 2: { imagesB64: string[], kind?: string }
$body2 = @{ imagesB64 = @($testB64); kind = "main" } | ConvertTo-Json

# Format 3: { data_b64: string }
$body3 = @{ data_b64 = $testB64 } | ConvertTo-Json

# Format 4: { data: string }
$body4 = @{ data = $testB64 } | ConvertTo-Json
```

## Test 6: PayGate Enforcement Toggle

### Prerequisites
1. **Set Environment Variables in Vercel:**
   - `PAYGATE_ENFORCE` (or `NEXT_PUBLIC_PAYGATE_ENFORCE`) - Controls enforcement mode
   - `NEXT_PUBLIC_PAYGATE_TEST_MODE` - Controls test mode bypass
   - Redeploy after changing env vars

### Test 6A: Enforcement OFF (Default Behavior)

**Setup:**
- Set `PAYGATE_ENFORCE=false` (or unset)
- Set `NEXT_PUBLIC_PAYGATE_TEST_MODE=true` (optional, for test mode bypass)

**PowerShell:**
```powershell
# Check debug endpoint for enforce flag
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/debug-paygate?cb=123" -UseBasicParsing
$json = $r.Content | ConvertFrom-Json
Write-Host "enforceEnvRaw: $($json.enforceEnvRaw)"
Write-Host "enforceParsed: $($json.enforceParsed)"
Write-Host "testModeParsed: $($json.testModeParsed)"

# Check paygate-token script
$r2 = Invoke-WebRequest -Uri "$PreviewUrl/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Body contains __PAYGATE_ENFORCE__: $($r2.Content -match '__PAYGATE_ENFORCE__')"
```

**Expected Results:**
- ✅ `enforceParsed: false` (enforcement OFF)
- ✅ If `testModeParsed: true`, test mode bypass works
- ✅ Paygate-token script contains `window.__PAYGATE_ENFORCE__ = false`
- ✅ Premium content accessible when test mode enabled OR valid unlock marker present

### Test 6B: Enforcement ON (Requires Valid Unlock Marker)

**Setup:**
- Set `PAYGATE_ENFORCE=true` (or `NEXT_PUBLIC_PAYGATE_ENFORCE=true`)
- Set `NEXT_PUBLIC_PAYGATE_TEST_MODE=false` (or unset)
- Redeploy Preview

**PowerShell:**
```powershell
# Check debug endpoint
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/debug-paygate?cb=123" -UseBasicParsing
$json = $r.Content | ConvertFrom-Json
Write-Host "enforceEnvRaw: $($json.enforceEnvRaw)"
Write-Host "enforceParsed: $($json.enforceParsed)"
Write-Host "testModeParsed: $($json.testModeParsed)"

# Check paygate-token script
$r2 = Invoke-WebRequest -Uri "$PreviewUrl/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Body contains __PAYGATE_ENFORCE__ = true: $($r2.Content -match '__PAYGATE_ENFORCE__ = true')"
```

**Expected Results:**
- ✅ `enforceParsed: true` (enforcement ON)
- ✅ Paygate-token script contains `window.__PAYGATE_ENFORCE__ = true`
- ✅ Premium content BLOCKED unless valid unlock marker in localStorage
- ✅ Test mode bypass IGNORED when enforcement is ON
- ✅ Stripe checkout still works (can unlock via `?paid=1&plan=day`)

### Test 6C: Enforcement ON + Test Mode ON (Enforcement Takes Precedence)

**Setup:**
- Set `PAYGATE_ENFORCE=true`
- Set `NEXT_PUBLIC_PAYGATE_TEST_MODE=true`
- Redeploy Preview

**Expected Results:**
- ✅ `enforceParsed: true` AND `testModeParsed: true`
- ✅ Premium content BLOCKED (enforcement overrides test mode)
- ✅ Valid unlock marker still required

### Browser Console Test (Enforcement Flow)

**Open Browser DevTools Console:**
```javascript
// Check current enforcement state
console.log('Enforce:', window.__PAYGATE_ENFORCE__);
console.log('Test Mode:', window.__PAYGATE_TEST_MODE__);

// Check unlock status
console.log('Is Unlocked:', window.__FL_PAYGATE__?.isUnlocked());

// With enforcement ON and no unlock marker:
// Expected: isUnlocked() = false

// Unlock via URL (Stripe test checkout)
// Visit: ?paid=1&plan=day
// Expected: isUnlocked() = true (after URL params processed)
```

### Expected Behavior Matrix

| Enforcement | Test Mode | Unlock Marker | Result |
|------------|-----------|---------------|--------|
| OFF | OFF | None | ❌ Locked |
| OFF | OFF | Valid | ✅ Unlocked |
| OFF | ON | None | ✅ Unlocked (test mode bypass) |
| OFF | ON | Valid | ✅ Unlocked |
| ON | OFF | None | ❌ Locked |
| ON | OFF | Valid | ✅ Unlocked |
| ON | ON | None | ❌ Locked (enforcement overrides) |
| ON | ON | Valid | ✅ Unlocked |

## Summary Checklist

- [ ] `/api/paygate-token` returns JavaScript with `X-Handler-Identity: PAYGATE_TOKEN_OK`
- [ ] `/api/paygate-token` body starts with `// PAYGATE_TOKEN_HANDLER_OK`
- [ ] `/api/paygate-token` body contains `window.__PAYGATE_ENFORCE__` (enforcement flag)
- [ ] `/api/debug-paygate` returns JSON with `X-Handler-Identity: DEBUG_PAYGATE_OK`
- [ ] `/api/debug-paygate` JSON contains `"handler": "debug-paygate"`
- [ ] `/api/debug-paygate` JSON contains `"enforceEnvRaw"` and `"enforceParsed"` fields
- [ ] Enforcement OFF: Test mode bypass works (if test mode enabled)
- [ ] Enforcement ON: Premium blocked unless valid unlock marker
- [ ] Enforcement ON: Test mode bypass ignored (enforcement takes precedence)
- [ ] Stripe checkout still works (can unlock via URL params)
- [ ] `/api/photo_extract_openai_b64` POST returns 200 (not 405)
- [ ] `/api/photo_extract_openai_b64` has `X-Handler-Identity: PHOTO_EXTRACT_OK`
- [ ] `/api/verify_race` POST works normally (unchanged behavior)
- [ ] Other `/api` endpoints continue to work (no regressions)
- [ ] No `verify_race_stub` in paygate endpoint responses
