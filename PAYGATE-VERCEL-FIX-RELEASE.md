# PayGate Vercel Routing Fix - Release Notes

## Root Cause

**Problem:** Requests to `/api/paygate-token` and `/api/debug-paygate` were returning `verify_race_stub` JSON from `pages/api/verify_race.js` instead of executing their own handlers.

**Root Cause:** Vercel prioritizes root `/api` directory (serverless functions) over Next.js `pages/api/` (API routes). When paygate endpoints existed only as re-export shims or in `pages/api/`, Vercel's routing fell back to `api/verify_race.js`, which re-exports `pages/api/verify_race.js` and returns `verify_race_stub` for non-POST requests.

**Why This Fix Works:** By implementing **full serverless function handlers directly in root `/api`**, Vercel routes to these handlers without any fallback. The handlers are standalone Node.js functions with proper headers and cache-control, ensuring reliable routing on Vercel.

## Fix Applied

Created **canonical handlers in root `/api`** (not re-exports):

1. **`api/paygate-token.js`** - Full serverless function handler
   - Returns JavaScript with `// PAYGATE_TOKEN_HANDLER_OK` marker
   - Sets `X-Handler-Identity: PAYGATE_TOKEN_OK` header
   - Aggressive cache-busting headers
   - Supports multiple env var names for backward compatibility

2. **`api/debug-paygate.js`** - Full serverless function handler
   - Returns JSON with `ok: true, apiRouteWorking: true`
   - Sets `X-Handler-Identity: DEBUG_PAYGATE_OK` header
   - Aggressive cache-busting headers
   - Supports multiple env var names for backward compatibility

## Files Changed

### Modified
- `api/paygate-token.js` - Replaced re-export with full handler implementation
- `api/debug-paygate.js` - Replaced re-export with full handler implementation

### Unchanged (Still Work)
- `pages/api/paygate-token.js` - Remains as optional wrapper (Next.js routing)
- `pages/api/debug-paygate.js` - Remains as optional wrapper (Next.js routing)
- `pages/api/verify_race.js` - Unchanged, still works for POST requests
- All other API endpoints - Unchanged

## Environment Variables Supported

**Token/Version (checked in order):**
- `FL_FAMILY_UNLOCK_TOKEN_VERSION` (pre-computed version, used directly)
- `FAMILY_UNLOCK_TOKEN_VERSION` (pre-computed version, used directly)
- `FAMILY_UNLOCK_TOKEN` (raw token, hashed to get version)
- `FAMILY_PASS_TOKEN` (raw token, hashed to get version)
- `NEXT_PUBLIC_FL_FAMILY_UNLOCK_TOKEN_VERSION` (client-side fallback, only if server env missing)

**Days (checked in order):**
- `FL_FAMILY_UNLOCK_DAYS`
- `FAMILY_UNLOCK_DAYS`
- `FAMILY_PASS_DAYS`
- Default: `365`

## Verification Checklist

### Vercel Functions List
1. Go to Vercel Dashboard → Project → Functions
2. Confirm `/api/paygate-token` appears in the list
3. Confirm `/api/debug-paygate` appears in the list
4. Confirm both show `Runtime: Node.js`

### Test Endpoints on Preview URL

**Test 1: `/api/paygate-token`**
```bash
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"
```

**Must See:**
- Status: `200 OK`
- Header: `X-Handler-Identity: PAYGATE_TOKEN_OK`
- Header: `Content-Type: application/javascript; charset=utf-8`
- Header: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- Body contains: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`

**Must NOT See:**
- JSON response
- `"step": "verify_race_stub"`
- `"handlerFile": "pages/api/verify_race.js"`
- `"error": "METHOD_NOT_ALLOWED"`

**Test 2: `/api/debug-paygate`**
```bash
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

**Must See:**
- Status: `200 OK`
- Header: `X-Handler-Identity: DEBUG_PAYGATE_OK`
- Header: `Content-Type: application/json; charset=utf-8`
- Header: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- JSON contains: `"ok": true, "apiRouteWorking": true, "hasVersion": boolean, "tokenVersionLength": number`

**Must NOT See:**
- `"step": "verify_race_stub"`
- `"handlerFile": "pages/api/verify_race.js"`
- `"error": "METHOD_NOT_ALLOWED"`

### Vercel Function Logs

1. Go to Vercel Dashboard → Project → Functions → View Logs
2. Make requests to `/api/paygate-token` and `/api/debug-paygate`
3. **Should see:** Function invocations for these endpoints
4. **Should NOT see:** Logs showing `verify_race` handler being called for paygate endpoints

### Verify Other Endpoints Still Work

```bash
# verify_race should still work (POST only, returns stub for GET)
curl -i -X POST "https://<PREVIEW-URL>/api/verify_race" \
  -H "Content-Type: application/json" \
  -d '{"track":"Test Track"}'
```

**Expected:** Returns verify result (not verify_race_stub) for POST requests.

## Commit Details

- **Branch:** `hotfix/restore-paygate-lkg`
- **Commit:** (to be filled after commit)
- **Files Changed:** 2 files (api/paygate-token.js, api/debug-paygate.js)

