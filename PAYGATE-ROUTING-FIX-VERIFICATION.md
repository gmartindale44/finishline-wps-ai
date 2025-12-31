# PayGate Routing Fix - Verification Summary

## Root Cause (from ROUTING_DIAGNOSIS.md)

**Problem:** Vercel prioritizes root `/api` (serverless functions) over Next.js `pages/api/` (API routes). When `/api/paygate-token` or `/api/debug-paygate` requests came in:

1. Vercel checked root `/api` directory first
2. Since `api/paygate-token.js` and `api/debug-paygate.js` didn't exist
3. Vercel routed to `api/verify_race.js` as fallback
4. `api/verify_race.js` re-exports `pages/api/verify_race.js`, which returns `verify_race_stub` for non-POST requests

**Exact File Responsible:** `api/verify_race.js` (re-export shim)

## Fix Applied

Created re-export shims in root `/api` that point to `pages/api` handlers:

1. **`api/paygate-token.js`** - Re-exports from `pages/api/paygate-token.js`
2. **`api/debug-paygate.js`** - Re-exports from `pages/api/debug-paygate.js`

This ensures Vercel routes correctly while maintaining canonical handlers in `pages/api/`.

## Files Changed

### Created
- `api/paygate-token.js` - Re-export shim
- `api/debug-paygate.js` - Re-export shim
- `ROUTING_DIAGNOSIS.md` - Root cause documentation

### Modified
- `pages/api/paygate-token.js` - Updated `X-Handler-Identity` to `PAYGATE_TOKEN_OK`
- `pages/api/debug-paygate.js` - Updated `X-Handler-Identity` to `DEBUG_PAYGATE_OK`

## Handler Code

### `api/paygate-token.js`
```javascript
// api/paygate-token.js
// Re-export handler from pages/api to ensure Vercel routes correctly
// Vercel prioritizes root /api over pages/api, so we need this shim

export { default } from "../pages/api/paygate-token.js";
```

### `api/debug-paygate.js`
```javascript
// api/debug-paygate.js
// Re-export handler from pages/api to ensure Vercel routes correctly
// Vercel prioritizes root /api over pages/api, so we need this shim

export { default } from "../pages/api/debug-paygate.js";
```

### `pages/api/paygate-token.js` (canonical handler)
- Sets `X-Handler-Identity: PAYGATE_TOKEN_OK`
- Returns JavaScript with comment: `// PAYGATE_TOKEN_HANDLER_OK`
- Content-Type: `application/javascript; charset=utf-8`
- Cache-Control: `no-store, no-cache, must-revalidate, proxy-revalidate`

### `pages/api/debug-paygate.js` (canonical handler)
- Sets `X-Handler-Identity: DEBUG_PAYGATE_OK`
- Returns JSON with `ok: true, apiRouteWorking: true`
- Content-Type: `application/json`
- Cache-Control: `no-store, no-cache, must-revalidate, proxy-revalidate`

## Verification Checklist

### Test 1: `/api/paygate-token`

```bash
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"
```

**Expected:**
```
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
X-Handler-Identity: PAYGATE_TOKEN_OK

// PAYGATE_TOKEN_HANDLER_OK
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "...";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: true, familyUnlockDays: 365 });
```

**Must NOT contain:**
- JSON response
- `"handlerFile": "pages/api/verify_race.js"`
- `"step": "verify_race_stub"`
- `"error": "METHOD_NOT_ALLOWED"`
- Any reference to `verify_race`

### Test 2: `/api/debug-paygate`

```bash
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

**Expected:**
```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
X-Handler-Identity: DEBUG_PAYGATE_OK

{
  "ok": true,
  "apiRouteWorking": true,
  "hasToken": true,
  "tokenVersionLength": 12,
  "familyUnlockDays": 365
}
```

**Must NOT contain:**
- `"handlerFile": "pages/api/verify_race.js"`
- `"step": "verify_race_stub"`
- `"error": "METHOD_NOT_ALLOWED"`
- Any reference to `verify_race`

### Test 3: `/api/verify_race` (should still work)

```bash
curl -i "https://<PREVIEW-URL>/api/verify_race"
```

**Expected:**
- Status: `200 OK`
- Returns `verify_race_stub` JSON (expected for GET request)
- Confirms verify_race handler is not broken

## Local Verification Results

✅ **Tested locally:**
- `/api/paygate-token` returns JavaScript with `// PAYGATE_TOKEN_HANDLER_OK` and `X-Handler-Identity: PAYGATE_TOKEN_OK`
- `/api/debug-paygate` returns JSON with `ok: true` and `X-Handler-Identity: DEBUG_PAYGATE_OK`
- `/api/verify_race` still works correctly (returns verify_race_stub for GET)

## Commit Details

- **Branch:** `hotfix/restore-paygate-lkg`
- **Commit:** `ff967d00`
- **Message:** `fix: add root /api re-exports for paygate endpoints to prevent verify_race routing`
- **Files Changed:** 5 files (139 insertions, 36 deletions)

## Next Steps

1. Wait for Vercel Preview deployment (2-5 minutes)
2. Run verification tests on Preview URL
3. Confirm endpoints return correct content types and headers
4. Confirm responses do NOT contain `verify_race_stub`
5. Merge to main after verification passes

