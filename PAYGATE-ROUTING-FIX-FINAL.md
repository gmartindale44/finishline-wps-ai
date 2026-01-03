# PayGate Routing Fix - Final

## Root Cause

**Problem:** Requests to `/api/_debug-paygate` and `/api/paygate-token` were returning `verify_race_stub` JSON from `pages/api/verify_race.js` instead of executing their own handlers.

**Root Cause:** Vercel's serverless function routing for the root `/api` directory was conflicting with Next.js `pages/api` routing. When both root `/api` and `pages/api` handlers existed for the same endpoints, Vercel prioritized root `/api` but encountered routing conflicts (possibly due to underscore-prefixed files or build artifacts), causing requests to fall back to `api/verify_race.js` (a re-export that always exists).

**Evidence:**
- No rewrites/redirects found in `next.config.cjs`
- No middleware found in root or `src`
- No catch-all routes (`[...slug].js`) found
- No custom server code found
- Root `/api` handlers existed but weren't executing
- Vercel Functions list showed endpoints existed, but requests hit `verify_race`

## Fix Applied

**Solution:** Removed root `/api` paygate handlers entirely. Now relying **ONLY** on `pages/api/` handlers (Next.js API routes), which eliminates routing conflicts.

**Files Changed:**
1. **Deleted:** `api/_debug-paygate.js` (root handler)
2. **Deleted:** `api/debug-paygate.js` (duplicate)
3. **Deleted:** `api/paygate-token.js` (root handler)
4. **Updated:** `pages/api/_debug-paygate.js` - Added `X-Handler-Identity: DEBUG_PAYGATE_OK`
5. **Updated:** `pages/api/paygate-token.js` - Added `X-Handler-Identity: PAYGATE_TOKEN_OK`

## Expected Curl Outputs

### Test 1: `/api/_debug-paygate`

```bash
curl -i https://<PREVIEW-URL>/api/_debug-paygate
```

**Expected:**
```
HTTP/1.1 200 OK
Content-Type: application/json
X-Handler-Identity: DEBUG_PAYGATE_OK

{
  "ok": true,
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

### Test 2: `/api/paygate-token`

```bash
curl -i https://<PREVIEW-URL>/api/paygate-token
```

**Expected:**
```
HTTP/1.1 200 OK
Content-Type: application/javascript
X-Handler-Identity: PAYGATE_TOKEN_OK
Cache-Control: public, max-age=300

// PAYGATE_TOKEN_HANDLER_OK
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "...";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: true, familyUnlockDays: 365 });
```

**Must NOT contain:**
- JSON response
- `verify_race_stub`
- `METHOD_NOT_ALLOWED`

## Commit Details

- **Branch:** `hotfix/restore-paygate-lkg`
- **Commit:** `9cd3e662`
- **Message:** `fix: stop paygate endpoints from rewriting to verify_race`
- **Files Changed:** 5 files (3 deletions, 2 modifications)

## Verification Checklist

### Vercel Preview

1. **Wait for deployment** (2-5 minutes)
2. **Test `/api/_debug-paygate`:**
   - [ ] Status: `200 OK`
   - [ ] Header: `X-Handler-Identity: DEBUG_PAYGATE_OK`
   - [ ] Content-Type: `application/json`
   - [ ] JSON contains: `"apiRouteWorking": true`
   - [ ] Does NOT contain: `"step": "verify_race_stub"`

3. **Test `/api/paygate-token`:**
   - [ ] Status: `200 OK`
   - [ ] Header: `X-Handler-Identity: PAYGATE_TOKEN_OK`
   - [ ] Content-Type: `application/javascript`
   - [ ] Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
   - [ ] Does NOT contain: JSON or `verify_race_stub`

4. **Check Vercel Logs:**
   - [ ] See: `[DEBUG PAYGATE] handler= PAGES_API`
   - [ ] See: `[PAYGATE TOKEN] handler= PAGES_API`
   - [ ] Does NOT see: `verify_race` logs for paygate requests

5. **Test Family Plan URL:**
   - [ ] `/?paid=1&plan=family` unlocks premium
   - [ ] No console errors
   - [ ] Script loads successfully

## Why This Fix Works

By removing root `/api` handlers and relying only on `pages/api/`, we eliminate the routing conflict. Next.js handles `pages/api/` routes directly without Vercel serverless function interference. This is the standard Next.js approach and avoids any potential conflicts with Vercel's root `/api` directory routing.

