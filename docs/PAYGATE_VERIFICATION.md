# PayGate Endpoints Verification Guide

This document provides copy/paste commands to verify that `/api/paygate-token` and `/api/debug-paygate` work correctly and do NOT route to `verify_race`.

## PowerShell Commands

### Test `/api/paygate-token`

```powershell
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -Method GET -UseBasicParsing
Write-Output "Status Code: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Output "Content-Type: $($response.Headers['Content-Type'])"
Write-Output "Cache-Control: $($response.Headers['Cache-Control'])"
Write-Output "`nBody (first 300 chars):"
Write-Output $response.Content.Substring(0, [Math]::Min(300, $response.Content.Length))
```

**Expected Results:**
- Status Code: `200`
- X-Handler-Identity: `PAYGATE_TOKEN_OK`
- Content-Type: `application/javascript; charset=utf-8`
- Cache-Control: `no-store, no-cache, must-revalidate, proxy-revalidate`
- Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- Body contains: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`
- Body does NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile`, JSON structure

### Test `/api/debug-paygate`

```powershell
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -Method GET -UseBasicParsing
Write-Output "Status Code: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Output "Content-Type: $($response.Headers['Content-Type'])"
Write-Output "Cache-Control: $($response.Headers['Cache-Control'])"
Write-Output "`nBody (JSON):"
$json = $response.Content | ConvertFrom-Json
$json | ConvertTo-Json
```

**Expected Results:**
- Status Code: `200`
- X-Handler-Identity: `DEBUG_PAYGATE_OK`
- Content-Type: `application/json; charset=utf-8`
- Cache-Control: `no-store, no-cache, must-revalidate, proxy-revalidate`
- JSON contains: `"ok": true`
- JSON contains: `"apiRouteWorking": true`
- JSON contains: `"handler": "debug-paygate"`
- JSON contains: `"hasToken": boolean`
- JSON does NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile`, `pages/api/verify_race.js`

## Bash/curl Commands

### Test `/api/paygate-token`

```bash
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"
```

**Expected Response:**
```
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
Surrogate-Control: no-store
X-Handler-Identity: PAYGATE_TOKEN_OK

// PAYGATE_TOKEN_HANDLER_OK
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: false, familyUnlockDays: 365 });
```

**Must NOT contain:**
- `verify_race_stub`
- `METHOD_NOT_ALLOWED`
- `handlerFile`
- `pages/api/verify_race.js`
- JSON structure (should be JavaScript, not JSON)

### Test `/api/debug-paygate`

```bash
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

**Expected Response:**
```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
Surrogate-Control: no-store
X-Handler-Identity: DEBUG_PAYGATE_OK

{
  "ok": true,
  "apiRouteWorking": true,
  "handler": "debug-paygate",
  "hasToken": false,
  "tokenVersionLength": 0,
  "familyUnlockDays": 365
}
```

**Must NOT contain:**
- `verify_race_stub`
- `METHOD_NOT_ALLOWED`
- `handlerFile`
- `pages/api/verify_race.js`
- `step`

## Verification Checklist

### ✅ Must Have (Success Criteria)

- [ ] Status Code: `200 OK`
- [ ] Header: `X-Handler-Identity: PAYGATE_TOKEN_OK` or `DEBUG_PAYGATE_OK`
- [ ] Header: `Content-Type` matches expected (JavaScript or JSON with charset)
- [ ] Header: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- [ ] Header: `Surrogate-Control: no-store`
- [ ] Body format matches expected (JavaScript starts with `// PAYGATE_TOKEN_HANDLER_OK`, JSON has `ok:true`)
- [ ] `/api/paygate-token` returns JavaScript (not JSON)
- [ ] `/api/debug-paygate` returns JSON with `ok: true, apiRouteWorking: true, handler: "debug-paygate"`

### ❌ Must NOT Have (Failure Indicators)

- [ ] `verify_race_stub` anywhere in response
- [ ] `METHOD_NOT_ALLOWED` error message
- [ ] `handlerFile` field pointing to `pages/api/verify_race.js`
- [ ] `step` field with value `verify_race_stub`
- [ ] JSON structure in `/api/paygate-token` response (should be JavaScript)
- [ ] `Expected POST, received GET` message

## Troubleshooting

### If you see `verify_race_stub` in response:

1. Check Vercel Functions list - both endpoints should appear
2. Check Vercel Logs - should see handler invocations, NOT `[buildStubResponse]` logs
3. Verify files exist: `pages/api/paygate-token.js` and `pages/api/debug-paygate.js`
4. Verify root `/api/` duplicates are removed (should NOT exist)
5. Check `next.config.cjs` - should have no rewrites
6. Verify no middleware files exist

### If status is 404:

1. Check files exist in `pages/api/`
2. Verify Next.js build completed successfully
3. Check Vercel deployment logs for build errors
4. Verify `export default function handler` is present

### If status is 405:

1. Verify using GET method (not POST)
2. Check handler allows GET method

