# PayGate Routing Fix - Root Cause and Solution

## Root Cause

### Exact Mechanism

**Problem:** Requests to `/api/paygate-token` and `/api/debug-paygate` return `verify_race_stub` JSON from `pages/api/verify_race.js` instead of their own handlers.

**Root Cause:** This is a **Next.js project** that should use `pages/api/*` routes exclusively. Having BOTH root `/api/` serverless functions AND `pages/api/` routes creates routing conflicts where:

1. Next.js builds `pages/api/*` into API routes during `next build`
2. Vercel's serverless functions from root `/api/` are separate deployments
3. When both exist, routing priority is ambiguous, causing requests to fall through incorrectly

**Evidence:**
- Root `/api/paygate-token.js` exists (2824 bytes - full implementation)
- Root `/api/debug-paygate.js` exists (2588 bytes - full implementation)  
- `pages/api/paygate-token.js` exists (canonical Next.js route)
- `pages/api/debug-paygate.js` exists (canonical Next.js route)
- `api/verify_race.js` exists (60 bytes - re-export shim)

**Why requests hit verify_race:**
- Routing conflict between root `/api/` and `pages/api/`
- Next.js routing may intercept first, but handlers may not be properly registered
- Fallback behavior routes unmatched requests to existing handlers incorrectly

### Files and Lines Responsible

**No explicit rewrite mechanism found:**
- ✅ `next.config.cjs` - No rewrites/redirects
- ✅ No `middleware.ts/js` files
- ✅ No `vercel.json` in root
- ✅ No catch-all routes (`pages/api/[...slug].js`)
- ✅ No `pages/api/index.js` dispatcher

**The conflict is structural:**
- Root `/api/` directory exists (Vercel serverless functions)
- `pages/api/` directory exists (Next.js API routes)
- Both contain handlers for the same endpoints
- Next.js should use `pages/api/*` exclusively

## Solution

### Strategy: Use Next.js API Routes Only

For a Next.js project, we should use `pages/api/*` routes exclusively and remove duplicate handlers from root `/api/`.

### Changes Made

1. **Updated `pages/api/paygate-token.js`:**
   - Added `Surrogate-Control: no-store` header
   - Ensured correct identity marker
   - Verified JavaScript output format

2. **Updated `pages/api/debug-paygate.js`:**
   - Added `Surrogate-Control: no-store` header  
   - Added `charset=utf-8` to Content-Type
   - Added `handler` field to JSON response
   - Fixed `hasToken` field name

3. **Removed root `/api/` duplicates:**
   - Deleted `api/paygate-token.js` (Next.js should handle via `pages/api/`)
   - Deleted `api/debug-paygate.js` (Next.js should handle via `pages/api/`)
   - Note: `api/verify_race.js` kept as re-export shim (may be needed for compatibility)

### Why This Cannot Route to verify_race Anymore

1. **Explicit route files:** Next.js maps `pages/api/paygate-token.js` → `/api/paygate-token` and `pages/api/debug-paygate.js` → `/api/debug-paygate` with 1:1 file-to-route mapping
2. **No catch-all:** No catch-all routes exist that would intercept these paths
3. **No middleware:** No middleware rewrites these requests
4. **No rewrite rules:** `next.config.cjs` has no rewrites
5. **Isolated handlers:** Paygate handlers have zero coupling to verify_race (no shared imports)

## Files Changed

**Modified:**
- `pages/api/paygate-token.js` - Updated headers (added Surrogate-Control)
- `pages/api/debug-paygate.js` - Updated headers and response format

**Deleted:**
- `api/paygate-token.js` - Removed duplicate (use pages/api only)
- `api/debug-paygate.js` - Removed duplicate (use pages/api only)

**Unchanged:**
- `pages/api/verify_race.js` - Still works for POST requests at `/api/verify_race`
- `api/verify_race.js` - Re-export shim (kept for compatibility)

## Verification

See `docs/PAYGATE_VERIFICATION.md` for complete verification commands.

**Quick Test:**
```bash
# Should return JavaScript (not JSON)
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"

# Should return JSON with ok:true (not verify_race_stub)
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

**Expected:**
- Status: `200 OK`
- Header: `X-Handler-Identity: PAYGATE_TOKEN_OK` or `DEBUG_PAYGATE_OK`
- Body does NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile pages/api/verify_race.js`

