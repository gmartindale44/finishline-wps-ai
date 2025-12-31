# PayGate Routing Investigation & Fix

## Investigation Results

### A) Routing Configuration Check

**1. Next.js Config (`next.config.cjs`):**
- ✅ No rewrites/redirects/headers found
- ✅ No basePath or trailingSlash configuration
- ✅ No output: 'export' (API routes enabled)

**2. Vercel Config:**
- ✅ No `vercel.json` found in repo root
- ✅ No custom routing configuration

**3. Middleware:**
- ✅ No `middleware.js` or `middleware.ts` in root
- ✅ Only Python middleware in `apps/api/common/middleware.py` (not relevant)

**4. Catch-All Routes:**
- ✅ No `pages/api/[...slug].js` found
- ✅ No `pages/api/[[...slug]].js` found
- ✅ No `api/[...slug].js` found
- ✅ No `api/[[...slug]].js` found
- ✅ No `api/index.js` or `pages/api/index.js` found

**5. Root `/api` Directory:**
- ✅ `api/paygate-token.js` exists (full handler implementation)
- ✅ `api/_debug-paygate.js` exists (full handler implementation)
- ✅ `api/verify_race.js` exists (re-export: `export { default } from "../pages/api/verify_race.js"`)
- ✅ No catch-all or index file in root `/api`

**6. `pages/api` Directory:**
- ✅ `pages/api/paygate-token.js` exists (full handler)
- ✅ `pages/api/_debug-paygate.js` exists (full handler)
- ✅ `pages/api/verify_race.js` exists (full handler, requires POST)

### Root Cause Hypothesis

**Vercel prioritizes root `/api` directory over `pages/api/`**, but there may be a routing issue where:
1. Vercel's function discovery is not finding the root `/api` handlers
2. OR there's a fallback mechanism routing unknown paths to `verify_race.js`
3. OR the underscore prefix in `_debug-paygate.js` is causing routing issues

**Evidence:**
- `api/verify_race.js` is a re-export that points to `pages/api/verify_race.js`
- When requests hit `/api/paygate-token` or `/api/_debug-paygate`, they're getting `verify_race_stub` responses
- This suggests Vercel is routing to `api/verify_race.js` (the re-export) instead of the explicit handlers

## Fix Applied

### Identity Markers Added (v2)

All four handlers now include identity markers to prove which code executes:

**1. `api/paygate-token.js`:**
- Comment in JS output: `// PAYGATE_TOKEN_HANDLER_ROOT_API_v2`
- Header: `X-Handler-Identity: PAYGATE_TOKEN_ROOT_API_v2`
- Log: `[PAYGATE TOKEN] handler= ROOT_API url= ... method= ...`

**2. `api/_debug-paygate.js`:**
- JSON field: `routeIdentity: 'DEBUG_PAYGATE_ROOT_API_v2'`
- Header: `X-Handler-Identity: DEBUG_PAYGATE_ROOT_API_v2`
- Log: `[DEBUG PAYGATE] handler= ROOT_API url= ... method= ...`

**3. `pages/api/paygate-token.js`:**
- Comment in JS output: `// PAYGATE_TOKEN_HANDLER_PAGES_API_v2`
- Header: `X-Handler-Identity: PAYGATE_TOKEN_PAGES_API_v2`
- Log: `[PAYGATE TOKEN] handler= PAGES_API url= ... method= ...`

**4. `pages/api/_debug-paygate.js`:**
- JSON field: `routeIdentity: 'DEBUG_PAYGATE_PAGES_API_v2'`
- Header: `X-Handler-Identity: DEBUG_PAYGATE_PAGES_API_v2`
- Log: `[DEBUG PAYGATE] handler= PAGES_API url= ... method= ...`

## Test Plan

### Test 1: `/api/_debug-paygate`

```bash
curl -i https://<PREVIEW-URL>/api/_debug-paygate
```

**Expected Success:**
```
HTTP/1.1 200 OK
Content-Type: application/json
X-Handler-Identity: DEBUG_PAYGATE_ROOT_API_v2
Cache-Control: no-store

{
  "ok": true,
  "routeIdentity": "DEBUG_PAYGATE_ROOT_API_v2",
  "apiRouteWorking": true,
  "hasToken": true,
  "hasVersion": true,
  "tokenVersionLength": 12,
  "familyUnlockDays": 365
}
```

**Must NOT contain:**
- `"handlerFile": "pages/api/verify_race.js"`
- `"step": "verify_race_stub"`
- `"error": "METHOD_NOT_ALLOWED"`
- `X-Handler-Identity` header with "verify_race" or missing

**Vercel Logs Should Show:**
```
[DEBUG PAYGATE] handler= ROOT_API url= /api/_debug-paygate method= GET
```

### Test 2: `/api/paygate-token`

```bash
curl -i https://<PREVIEW-URL>/api/paygate-token
```

**Expected Success:**
```
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
X-Handler-Identity: PAYGATE_TOKEN_ROOT_API_v2
Cache-Control: no-store

// PAYGATE_TOKEN_HANDLER_ROOT_API_v2
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "...";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: true, familyUnlockDays: 365 });
```

**Must NOT contain:**
- JSON response
- `"handlerFile": "pages/api/verify_race.js"`
- `"step": "verify_race_stub"`
- `X-Handler-Identity` header with "verify_race" or missing

**Vercel Logs Should Show:**
```
[PAYGATE TOKEN] handler= ROOT_API url= /api/paygate-token method= GET
```

### Test 3: Family Plan URL Unlock

```bash
# Open in browser (incognito)
https://<PREVIEW-URL>/?paid=1&plan=family
```

**Expected:**
- Premium content unlocks
- Console shows: `[PayGate] Unlocked via URL params: { plan: 'family', durationDays: 180, ... }`
- localStorage contains `plan: "family"` and `expiry` ~180 days from now
- **No console error:** "Unexpected token <" from paygate-token script
- Script loads successfully (check Network tab)

### Test 4: Verify Vercel Function Logs

In Vercel Dashboard → Project → Functions → View Logs:

**Should see:**
- `[PAYGATE TOKEN] handler= ROOT_API` for `/api/paygate-token` requests
- `[DEBUG PAYGATE] handler= ROOT_API` for `/api/_debug-paygate` requests

**Should NOT see:**
- `[verify_race]` logs for paygate endpoint requests
- `[buildStubResponse]` logs for paygate endpoint requests

## Files Changed

1. `api/paygate-token.js` - Added v2 identity markers
2. `api/_debug-paygate.js` - Added v2 identity markers
3. `pages/api/paygate-token.js` - Added v2 identity markers
4. `pages/api/_debug-paygate.js` - Added v2 identity markers

## Next Steps

1. **Deploy and Test:** Wait for Vercel Preview deployment (2-5 minutes)
2. **Run Test Plan:** Execute all 4 tests above
3. **Check Logs:** Verify Vercel function logs show correct handler execution
4. **Diagnose:** Based on identity markers in responses, determine:
   - If `ROOT_API` handlers are executing → routing is correct
   - If `PAGES_API` handlers are executing → Vercel is using pages/api instead
   - If `verify_race` is executing → investigate further (check Vercel function discovery)

## If Tests Still Fail

If responses still show `verify_race_stub`:
1. Check Vercel function logs to see which handler actually executed
2. Verify build output includes both handlers in `.next/server/pages/api/` and root `/api`
3. Check Vercel project settings for any custom routing rules
4. Consider adding explicit `vercel.json` routes as last resort

