# PayGate Routing Fix - Final Deliverable Summary

## Root Cause Proof

### Exact Mechanism

**File:** `pages/api/verify_race.js` (lines 1699-1711)

The `verify_race` handler returns `verify_race_stub` JSON for ANY non-POST request:

```javascript
if (req.method !== "POST") {
  const stub = await buildStubResponse({
    track: null,
    date: null,
    raceNo: null,
  });
  return res.status(200).json({
    ...stub,
    ok: false,
    step: "verify_race_stub",
    error: "METHOD_NOT_ALLOWED",
    message: `Expected POST, received ${req.method}`,
  });
}
```

**Why requests hit this:** Next.js `pages/api` routing may intercept requests before Vercel's root `/api` serverless functions, causing paygate endpoints to route to `verify_race.js`.

**Evidence:**
- Vercel logs show `[buildStubResponse] Date is missing` (line 1458 in verify_race.js)
- Responses include `"handlerFile": "pages/api/verify_race.js"`
- Responses include `"step": "verify_race_stub"`

## Fix Applied

### Root `/api` Handlers (Canonical - Vercel Priority)

**Files:**
- `api/paygate-token.js` - Full standalone implementation
- `api/debug-paygate.js` - Full standalone implementation

**Key Features:**
1. ✅ Standalone handlers (no re-exports, no imports from pages/api)
2. ✅ Identity markers: `X-Handler-Identity: PAYGATE_TOKEN_OK` / `DEBUG_PAYGATE_OK`
3. ✅ Aggressive cache-busting headers
4. ✅ Correct content types
5. ✅ Never import or call verify_race logic

## Verification Commands

### PowerShell

```powershell
# Test paygate-token
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -Method GET -UseBasicParsing
Write-Output "Status: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Output "Content-Type: $($response.Headers['Content-Type'])"
Write-Output "Body (first 200 chars):"
Write-Output $response.Content.Substring(0, [Math]::Min(200, $response.Content.Length))

# Test debug-paygate
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -Method GET -UseBasicParsing
Write-Output "Status: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
$response.Content | ConvertFrom-Json | ConvertTo-Json
```

### Bash

```bash
# Test paygate-token
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"

# Test debug-paygate
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

### Expected Results

**✅ Must Have:**
- Status: `200 OK`
- Header: `X-Handler-Identity: PAYGATE_TOKEN_OK` or `DEBUG_PAYGATE_OK`
- Content-Type: `application/javascript; charset=utf-8` or `application/json; charset=utf-8`
- Body starts with `// PAYGATE_TOKEN_HANDLER_OK` (for paygate-token)
- JSON contains `"ok": true, "apiRouteWorking": true` (for debug-paygate)

**❌ Must NOT Have:**
- `verify_race_stub`
- `METHOD_NOT_ALLOWED`
- `"handlerFile": "pages/api/verify_race.js"`
- `"step": "verify_race_stub"`

## Vercel UI Checklist

1. **Functions List:**
   - Go to Vercel Dashboard → Project → Functions
   - Confirm `/api/paygate-token` appears
   - Confirm `/api/debug-paygate` appears
   - Both show `Runtime: Node.js`

2. **Function Logs:**
   - Go to Functions → View Logs
   - Make requests to paygate endpoints
   - **Should see:** Function invocations for paygate endpoints
   - **Should NOT see:** `[buildStubResponse]` or `[verify_race]` logs

## Files Changed

**Modified:**
- `api/paygate-token.js` - Full handler implementation
- `api/debug-paygate.js` - Full handler implementation

**Created:**
- `PAYGATE-ROUTING-ROOT-CAUSE-AND-FIX.md` - Comprehensive documentation
- `ROOT-CAUSE-PROOF.md` - Root cause analysis

**Unchanged:**
- `pages/api/paygate-token.js` - Optional wrapper
- `pages/api/debug-paygate.js` - Optional wrapper
- `pages/api/verify_race.js` - Unchanged
- All other endpoints - Unchanged

## Git Status

- ✅ Handlers implemented and committed
- ✅ Documentation added
- ✅ `.next` in `.gitignore`
- ✅ Ready for Vercel Preview deployment

## Commit History

- Latest commit includes root cause documentation
- Previous commits include handler implementations

