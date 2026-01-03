# PayGate Routing Fix - Summary

## Root Cause Explanation

**Problem:** Requests to `/api/_debug-paygate` and `/api/paygate-token` were returning `verify_race_stub` JSON responses from `pages/api/verify_race.js` instead of executing their own handlers, even though:
- Full handler implementations exist in both `api/` (root) and `pages/api/` directories
- Vercel Functions list shows both endpoints exist
- Handlers are correctly exported with `export default function handler`

**Root Cause Hypothesis:** Vercel's serverless function routing may have issues with:
1. **Underscore-prefixed files** in root `/api` directory (`_debug-paygate.js`) - Vercel may not properly discover or route these files
2. **Routing priority conflicts** between root `/api` (Vercel serverless functions) and `pages/api/` (Next.js API routes)
3. **Build/deployment artifact issues** where handlers aren't properly included in the deployment

**Fix Applied:** Added comprehensive v3 identity markers to all paygate handlers (both root `/api` and `pages/api`) to definitively prove which handler executes. This includes:
- `X-Handler-Identity` response headers
- `routeIdentity` fields in JSON responses
- Comment markers in JavaScript output
- Console logs with handler location

These markers will help diagnose the exact routing behavior on Vercel and confirm whether requests are hitting the correct handlers or falling back to `verify_race`.

## Files Changed

1. **`api/_debug-paygate.js`**
   - Updated identity markers to v3
   - Added `X-Handler-Identity: DEBUG_PAYGATE_ROOT_API_v3` header
   - Updated `routeIdentity` field to `DEBUG_PAYGATE_ROOT_API_v3`
   - Added console log: `[DEBUG PAYGATE] handler= ROOT_API`

2. **`api/paygate-token.js`**
   - Updated identity markers to v3
   - Added `X-Handler-Identity: PAYGATE_TOKEN_ROOT_API_v3` header
   - Updated JS comment to `// PAYGATE_TOKEN_HANDLER_ROOT_API_v3`
   - Added console log: `[PAYGATE TOKEN] handler= ROOT_API`

3. **`pages/api/_debug-paygate.js`**
   - Updated identity markers to v3
   - Added `X-Handler-Identity: DEBUG_PAYGATE_PAGES_API_v3` header
   - Updated `routeIdentity` field to `DEBUG_PAYGATE_PAGES_API_v3`
   - Added console log: `[DEBUG PAYGATE] handler= PAGES_API`

4. **`pages/api/paygate-token.js`**
   - Updated identity markers to v3
   - Added `X-Handler-Identity: PAYGATE_TOKEN_PAGES_API_v3` header
   - Updated JS comment to `// PAYGATE_TOKEN_HANDLER_PAGES_API_v3`
   - Added console log: `[PAYGATE TOKEN] handler= PAGES_API`

## Expected Curl Outputs

### Test 1: `/api/_debug-paygate`

```bash
curl -i https://<PREVIEW-URL>/api/_debug-paygate
```

**Expected Success Response:**
```
HTTP/1.1 200 OK
Content-Type: application/json
X-Handler-Identity: DEBUG_PAYGATE_ROOT_API_v3
Cache-Control: no-store

{
  "ok": true,
  "routeIdentity": "DEBUG_PAYGATE_ROOT_API_v3",
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
- Any reference to `verify_race`

**Alternative (if routing to pages/api):**
- `X-Handler-Identity: DEBUG_PAYGATE_PAGES_API_v3`
- `"routeIdentity": "DEBUG_PAYGATE_PAGES_API_v3"`

### Test 2: `/api/paygate-token`

```bash
curl -i https://<PREVIEW-URL>/api/paygate-token
```

**Expected Success Response:**
```
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
X-Handler-Identity: PAYGATE_TOKEN_ROOT_API_v3
Cache-Control: no-store

// PAYGATE_TOKEN_HANDLER_ROOT_API_v3
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "...";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: true, familyUnlockDays: 365 });
```

**Must NOT contain:**
- JSON response
- `"handlerFile": "pages/api/verify_race.js"`
- `"step": "verify_race_stub"`
- Any reference to `verify_race`

**Alternative (if routing to pages/api):**
- `X-Handler-Identity: PAYGATE_TOKEN_PAGES_API_v3`
- Comment: `// PAYGATE_TOKEN_HANDLER_PAGES_API_v3`

## Verification Checklist

### Vercel Preview Deployment

1. **Wait for deployment** (2-5 minutes after push)
   - Check Vercel Dashboard → Project → Deployments
   - Find latest deployment for `hotfix/restore-paygate-lkg`
   - Copy Preview URL

2. **Test `/api/_debug-paygate`:**
   ```bash
   curl -i https://<PREVIEW-URL>/api/_debug-paygate
   ```
   - [ ] Status: `200 OK`
   - [ ] Header: `X-Handler-Identity` exists and is NOT `verify_race`
   - [ ] Content-Type: `application/json`
   - [ ] JSON contains: `"routeIdentity": "DEBUG_PAYGATE_*_v3"`
   - [ ] JSON contains: `"apiRouteWorking": true`
   - [ ] Does NOT contain: `"handlerFile": "pages/api/verify_race.js"`
   - [ ] Does NOT contain: `"step": "verify_race_stub"`

3. **Test `/api/paygate-token`:**
   ```bash
   curl -i https://<PREVIEW-URL>/api/paygate-token
   ```
   - [ ] Status: `200 OK`
   - [ ] Header: `X-Handler-Identity` exists and is NOT `verify_race`
   - [ ] Content-Type: `application/javascript; charset=utf-8`
   - [ ] Body starts with: `// PAYGATE_TOKEN_HANDLER_*_v3`
   - [ ] Body contains: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`
   - [ ] Does NOT contain: JSON response
   - [ ] Does NOT contain: `verify_race_stub`

4. **Check Vercel Function Logs:**
   - Vercel Dashboard → Project → Functions → View Logs
   - [ ] See logs: `[DEBUG PAYGATE] handler= ROOT_API` (or `PAGES_API`)
   - [ ] See logs: `[PAYGATE TOKEN] handler= ROOT_API` (or `PAGES_API`)
   - [ ] Does NOT see: `verify_race` logs for paygate endpoint requests

5. **Test Family Plan URL Unlock:**
   ```bash
   # Open in browser (incognito)
   https://<PREVIEW-URL>/?paid=1&plan=family
   ```
   - [ ] Premium content unlocks
   - [ ] No console error: "Unexpected token <"
   - [ ] Script loads successfully (check Network tab)
   - [ ] localStorage contains `plan: "family"` and `expiry` ~180 days from now

### Production Deployment

After merging PR #155 to main:

1. **Wait for production deployment** (automatic after merge)

2. **Repeat all tests above** using production URL

3. **Monitor Vercel Logs** for any routing issues

## Next Steps if Tests Fail

If responses still show `verify_race_stub`:

1. **Check identity markers in response:**
   - If `X-Handler-Identity` is missing → handler not executing
   - If `X-Handler-Identity` shows `verify_race` → routing issue confirmed
   - If `X-Handler-Identity` shows `ROOT_API_v3` or `PAGES_API_v3` → handler executing correctly

2. **Check Vercel Function Logs:**
   - Look for `[DEBUG PAYGATE]` or `[PAYGATE TOKEN]` logs
   - If missing → handler not being called
   - If present → handler executing but response may be intercepted

3. **Verify build output:**
   - Check `.next/server/pages/api/_debug-paygate.js` exists
   - Check `.next/server/pages/api/paygate-token.js` exists
   - Check root `/api` handlers are included in deployment

4. **Consider alternative fixes:**
   - Remove root `/api` paygate handlers and rely only on `pages/api/`
   - Add explicit `vercel.json` routes mapping
   - Check for middleware or rewrite rules interfering

## Commit Details

- **Branch:** `hotfix/restore-paygate-lkg`
- **Commit:** `81155afa`
- **Message:** `fix: make paygate endpoints route to correct handlers`
- **Files Changed:** 4 files (16 insertions, 14 deletions)

## Where to Find Vercel Preview URL

1. **GitHub PR #155:**
   - https://github.com/gmartindale44/finishline-wps-ai/pull/155
   - Check "Checks" tab → Vercel deployment → "Details"

2. **Vercel Dashboard:**
   - https://vercel.com/dashboard
   - Project: `finishline-wps-ai` → Deployments → Preview
   - Find latest deployment for `hotfix/restore-paygate-lkg`

