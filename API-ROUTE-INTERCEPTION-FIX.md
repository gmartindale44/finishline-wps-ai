# API Route Interception Fix

## Problem
`/api/paygate-token` and `/api/_debug-paygate` are being intercepted and routed to `verify_race` logic, returning responses like:
- `verify_race_stub / METHOD_NOT_ALLOWED`
- `Date is missing - this should not happen if handler validated correctly`

## Root Cause Analysis
The issue appears to be server-side routing (Vercel/Next.js), but client-side guards have been added as a fail-safe to prevent any client-side interception.

## Files Modified

### 1. `public/js/paygate-helper.js`
**Change:** Added early return guard in `checkUrlParams()` to prevent processing when pathname starts with `/api/`

```javascript
// CRITICAL: Never intercept /api/* paths - these are server routes
const pathname = window.location.pathname;
if (pathname && pathname.startsWith('/api/')) {
  return { unlocked: false, bypassUsed: false };
}
```

**Location:** Line ~150 (after window.location check, before URL parsing)

**Also added:** Guard in family unlock fetch to ensure API URL is valid:
```javascript
// CRITICAL: Ensure /api/* paths are never intercepted
const apiUrl = '/api/family-unlock';
if (!apiUrl.startsWith('/api/')) {
  console.warn('[PayGate] Invalid API URL, skipping:', apiUrl);
  return { unlocked: false, bypassUsed: false };
}
```

## Verification Steps

### 1. Test `/api/_debug-paygate`
```bash
curl -i https://<prod>/api/_debug-paygate
```
**Expected:** JSON response with `apiRouteWorking: true`
**Should NOT:** Return `verify_race_stub` or `METHOD_NOT_ALLOWED`

### 2. Test `/api/paygate-token`
```bash
curl -i https://<prod>/api/paygate-token
```
**Expected:** JavaScript response with `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`
**Should NOT:** Return `verify_race_stub` or HTML error page

### 3. Test Family Plan URL Unlock
```bash
# Open in incognito browser
https://<prod>/?paid=1&plan=family
```
**Expected:**
- Premium content unlocks
- Console shows: `[PayGate] Unlocked via URL params: { plan: 'family', durationDays: 180, ... }`
- localStorage contains `plan: "family"` and `expiry` ~180 days from now
- **No console error:** "Unexpected token <" from paygate-token

### 4. Verify Script Tag Loading
Open browser DevTools → Network tab:
- `/api/paygate-token` should return `200 OK` with `Content-Type: application/javascript`
- Response body should start with: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = ...`
- **Should NOT:** Return JSON with `step: "verify_race_stub"`

## Additional Notes

### Client-Side Guards Added
1. **Pathname check:** `checkUrlParams()` now returns early if `pathname.startsWith('/api/')`
2. **API URL validation:** Family unlock fetch validates API URL before making request

### Server-Side Investigation Needed
If the issue persists after these fixes, the problem is likely:
1. **Vercel routing misconfiguration** - Check Vercel project settings
2. **Next.js catch-all route** - Verify no `pages/api/[...slug].js` exists
3. **Middleware interception** - Check for `middleware.js` or `middleware.ts`
4. **Build output issue** - Verify API routes are included in `.next/server/pages/api/`

### Next Steps if Issue Persists
1. Check Vercel function logs for `/api/paygate-token` requests
2. Verify build output includes `pages/api/paygate-token.js`
3. Test locally: `npm run dev` then `curl http://localhost:3000/api/paygate-token`
4. Check Vercel deployment logs for routing errors

## Files Changed
- `public/js/paygate-helper.js` - Added `/api/*` path guards

## Testing Checklist
- [ ] `/api/_debug-paygate` returns JSON (not verify_race_stub)
- [ ] `/api/paygate-token` returns JavaScript (not verify_race_stub)
- [ ] `/?paid=1&plan=family` unlocks premium content
- [ ] No console errors when loading `/api/paygate-token` as script tag
- [ ] localStorage correctly stores family plan unlock
- [ ] PayGate fail-closed behavior still works (premium hidden by default)

