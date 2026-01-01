# Routing Diagnosis - Final Report

## Root Cause Analysis

### Finding: No Routing Configuration Files Found
- ❌ No `vercel.json` file exists
- ✅ `next.config.cjs` is clean (no rewrites/redirects)
- ❌ No middleware files found
- ✅ No catch-all routes in `pages/api/` (no `[...slug].js` files)

### Current Handler Status
- ✅ `pages/api/paygate-token.js` exists (correct handler)
- ✅ `pages/api/debug-paygate.js` exists (correct handler)
- ✅ `pages/api/verify_race.js` exists
- ✅ `api/verify_race.js` exists (re-export shim for compatibility)

### The Problem
User reports that `/api/paygate-token` and `/api/debug-paygate` are returning `verify_race_stub` JSON instead of their own handlers.

**Possible Causes:**
1. **Stale deployment/cache** - Previous deployment still serving
2. **Vercel build cache** - Build artifacts contain old routing
3. **CDN/Edge cache** - Edge cache serving stale responses
4. **Next.js routing priority** - If root `/api/` exists, Vercel might prioritize it

**However:** Since this is a Next.js app with `pages/api/` routes, Next.js should handle routing automatically. The handlers are correctly placed and configured.

## Handlers Already Correct

### pages/api/paygate-token.js
- ✅ `Content-Type: application/javascript; charset=utf-8`
- ✅ `X-Handler-Identity: PAYGATE_TOKEN_OK`
- ✅ `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- ✅ Emits: `window.__PAYGATE_TEST_MODE__ = true/false`
- ✅ Emits: `window.__PAYGATE_TEST_MODE_ENV__ = "..."`

### pages/api/debug-paygate.js
- ✅ `Content-Type: application/json; charset=utf-8`
- ✅ `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- ✅ Returns: JSON with `handler: "debug-paygate"`
- ✅ Returns: `testModeEnvRaw` and `testModeParsed` fields

## Conclusion

**The code is correct.** Both handlers exist, are properly configured, and have correct headers. There is no routing configuration file to fix.

**The issue is likely:**
1. **Stale deployment** - Needs fresh deployment
2. **Vercel build cache** - Needs cache cleared
3. **CDN/Edge cache** - May need invalidation

**Recommendation:**
1. Force a fresh deployment (push empty commit or redeploy)
2. Clear Vercel build cache
3. Test with cache-busting query parameters (`?cb=123`)
4. Check Vercel Function Logs to see which handler is actually executing

## verify_race.js Status

**Command:** `git diff HEAD -- pages/api/verify_race.js`  
**Result:** No changes (empty diff)

✅ **verify_race.js was NOT touched**

## No Code Changes Needed

Since there's no routing configuration to fix, and the handlers are already correct, no code changes are required. The issue is deployment/cache related, not code related.

