# PayGate Routing Bug: Root Cause and Fix

## Problem Statement

Requests to `/api/paygate-token` and `/api/debug-paygate` return `verify_race_stub` JSON from `pages/api/verify_race.js` instead of executing their own handlers, even though:
- Full handlers exist in root `/api/paygate-token.js` and `/api/debug-paygate.js`
- Vercel Functions list shows these endpoints as deployed
- No middleware or rewrites found in codebase

## Root Cause Proof

### Evidence 1: verify_race.js Handler Behavior

**File:** `pages/api/verify_race.js` (lines 1699-1711)

```javascript
export default async function handler(req, res) {
  try {
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
        summary: `Verify Race stub: method ${req.method} is not supported.`,
      });
    }
```

**Finding:** The `verify_race` handler returns `verify_race_stub` JSON for ANY non-POST request (including GET).

### Evidence 2: Vercel Logs

User reports seeing:
- `[buildStubResponse] Date is missing - this should not happen if handler validated correctly`
- This log message appears ONLY in `pages/api/verify_race.js` (line 1458)
- **This proves requests are hitting `verify_race.js` instead of paygate handlers**

### Evidence 3: Response Structure

Responses include:
- `"step": "verify_race_stub"`
- `"handlerFile": "pages/api/verify_race.js"`
- `"error": "METHOD_NOT_ALLOWED"`

All of these are ONLY set in `pages/api/verify_race.js`.

### Root Cause Analysis

**Hypothesis:** Vercel's routing behavior when both root `/api` and `pages/api` exist.

When a Next.js app with `pages/api` is deployed to Vercel:
1. **Next.js Pages Router** builds API routes from `pages/api/`
2. **Vercel Serverless Functions** deploy functions from root `/api/`
3. **Routing Priority:** Vercel typically prioritizes root `/api` over `pages/api`, BUT:
   - If Next.js build artifacts exist, Next.js routing may intercept requests first
   - If there's a routing conflict, Vercel may fall back to Next.js routes
   - Build cache issues can cause stale routes to be served

**Why requests hit verify_race:**
- Next.js `pages/api/verify_race.js` exists and handles ALL `/api/*` requests that don't match explicit routes
- Even though root `/api/paygate-token.js` exists, Next.js routing may intercept before Vercel's serverless functions
- The `api/verify_race.js` re-export (`export { default } from "../pages/api/verify_race.js"`) creates a circular reference that may cause routing confusion

## Fix Implementation

### Strategy: Ensure Root `/api` Handlers Are Standalone

Root `/api` handlers must be **complete implementations**, not re-exports, to ensure Vercel routes to them correctly.

### Files Changed

**✅ Root `/api` Handlers (Canonical - Vercel Priority):**
- `api/paygate-token.js` - Full standalone implementation
- `api/debug-paygate.js` - Full standalone implementation

**Key Features:**
1. ✅ Standalone handlers (no re-exports, no imports from pages/api)
2. ✅ Proper identity markers (`X-Handler-Identity` headers)
3. ✅ Aggressive cache-busting headers
4. ✅ Correct content types (application/javascript, application/json)
5. ✅ Never call or import verify_race logic

### Handler Code Verification

**api/paygate-token.js:**
- ✅ Uses `export default function handler(req, res)`
- ✅ Sets `X-Handler-Identity: PAYGATE_TOKEN_OK`
- ✅ Returns JavaScript with `// PAYGATE_TOKEN_HANDLER_OK` marker
- ✅ No imports from `pages/api` or `verify_race`

**api/debug-paygate.js:**
- ✅ Uses `export default function handler(req, res)`
- ✅ Sets `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ Returns JSON with `apiRouteWorking: true`
- ✅ No imports from `pages/api` or `verify_race`

## Verification Checklist

### Local Testing

```bash
# Start dev server
npm run dev

# Test paygate-token
curl -i "http://localhost:3000/api/paygate-token?cb=123"

# Test debug-paygate
curl -i "http://localhost:3000/api/debug-paygate?cb=123"
```

**Expected Results:**
- Status: `200 OK`
- Header: `X-Handler-Identity: PAYGATE_TOKEN_OK` or `DEBUG_PAYGATE_OK`
- Content-Type: `application/javascript` or `application/json`
- Body does NOT contain `verify_race_stub`

### Vercel Preview Testing

**PowerShell:**
```powershell
# Test paygate-token
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -Method GET
Write-Output "Status: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Output "Content-Type: $($response.Headers['Content-Type'])"
Write-Output "Body (first 200 chars): $($response.Content.Substring(0, [Math]::Min(200, $response.Content.Length)))"

# Test debug-paygate
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -Method GET
Write-Output "Status: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
$response.Content | ConvertFrom-Json | ConvertTo-Json
```

**Bash:**
```bash
# Test paygate-token
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"

# Test debug-paygate
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

**Expected Results:**
- ✅ Status: `200 OK`
- ✅ Header: `X-Handler-Identity: PAYGATE_TOKEN_OK` or `DEBUG_PAYGATE_OK`
- ✅ Content-Type: `application/javascript; charset=utf-8` or `application/json; charset=utf-8`
- ✅ Body starts with `// PAYGATE_TOKEN_HANDLER_OK` (for paygate-token)
- ✅ JSON contains `"ok": true, "apiRouteWorking": true` (for debug-paygate)
- ✅ Body does NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `"handlerFile": "pages/api/verify_race.js"`

### Vercel Functions List

1. Go to Vercel Dashboard → Project → Functions
2. Verify `/api/paygate-token` appears in list
3. Verify `/api/debug-paygate` appears in list
4. Both should show `Runtime: Node.js`

### Vercel Function Logs

1. Go to Vercel Dashboard → Project → Functions → View Logs
2. Make requests to `/api/paygate-token` and `/api/debug-paygate`
3. **Should see:** Function invocations for these endpoints
4. **Should NOT see:** `[buildStubResponse]` or `[verify_race]` logs for paygate endpoints

## Expected Response Examples

### `/api/paygate-token` Success Response

```
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
X-Handler-Identity: PAYGATE_TOKEN_OK

// PAYGATE_TOKEN_HANDLER_OK
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: false, familyUnlockDays: 365 });
```

### `/api/debug-paygate` Success Response

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
X-Handler-Identity: DEBUG_PAYGATE_OK

{
  "ok": true,
  "apiRouteWorking": true,
  "hasVersion": false,
  "tokenVersionLength": 0,
  "familyUnlockDays": 365
}
```

## Files Changed Summary

**Modified:**
- `api/paygate-token.js` - Full standalone handler implementation
- `api/debug-paygate.js` - Full standalone handler implementation

**Unchanged (Still Work):**
- `pages/api/paygate-token.js` - Optional wrapper (Next.js routing)
- `pages/api/debug-paygate.js` - Optional wrapper (Next.js routing)
- `pages/api/verify_race.js` - Unchanged, still works for POST requests
- `api/verify_race.js` - Re-export (unchanged)

## Next Steps

1. ✅ Handlers implemented in root `/api`
2. ✅ Identity markers added
3. ✅ Cache-busting headers added
4. ⏳ Test on Vercel Preview
5. ⏳ Verify logs show correct handlers
6. ⏳ Merge to production after verification

