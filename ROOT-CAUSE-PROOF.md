# Root Cause Proof: PayGate Endpoints Hitting verify_race

## Problem Statement

Requests to `/api/paygate-token` and `/api/debug-paygate` are returning `verify_race_stub` JSON from `pages/api/verify_race.js` instead of executing their own handlers, even though:
1. Full handlers exist in root `/api/paygate-token.js` and `/api/debug-paygate.js`
2. Vercel Functions list shows these endpoints as deployed
3. No middleware or rewrites found in codebase

## Root Cause Analysis

### Evidence from verify_race.js Handler

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
    // ... POST handling continues
  }
}
```

**Critical Finding:** The `verify_race` handler returns `verify_race_stub` JSON for ANY non-POST request (including GET requests to `/api/paygate-token` and `/api/debug-paygate`).

### Evidence from Vercel Logs

User reports seeing:
- `[buildStubResponse] Date is missing - this should not happen if handler validated correctly`
- This log message appears ONLY in `pages/api/verify_race.js` (line 1458)
- This confirms requests are hitting `verify_race.js` instead of paygate handlers

### Root Cause: Vercel Routing Behavior

**Hypothesis:** Vercel's serverless function routing for root `/api` may have a fallback mechanism that routes unmatched endpoints to an existing handler, OR there's a build/deployment issue where the paygate handlers aren't being recognized.

However, based on Vercel documentation and typical behavior:
1. Vercel prioritizes root `/api` over `pages/api`
2. Each file in root `/api` should map 1:1 to a route
3. If a file doesn't exist, Vercel should return 404, not route to another handler

**Alternative Hypothesis (More Likely):** The handlers exist in root `/api`, but there may be:
1. A build artifact issue where old handlers aren't being replaced
2. A module resolution issue where re-exports aren't working correctly
3. A Vercel function discovery issue where functions aren't being deployed correctly

### Current Handler Structure

**Root `/api` handlers:**
- `api/paygate-token.js` - Full implementation (not a re-export)
- `api/debug-paygate.js` - Full implementation (not a re-export)
- `api/verify_race.js` - Re-export: `export { default } from "../pages/api/verify_race.js";`

**Pages API handlers:**
- `pages/api/paygate-token.js` - Full implementation
- `pages/api/debug-paygate.js` - Full implementation
- `pages/api/verify_race.js` - Full implementation (returns stub for non-POST)

## Proposed Solution

Since full handlers exist in root `/api`, the issue is likely that:
1. Vercel is not properly deploying/discovering the root `/api` handlers, OR
2. There's a caching/routing conflict between root `/api` and `pages/api`

**Fix Strategy:**
1. Ensure root `/api` handlers are standalone (not re-exports) ✅ (already done)
2. Verify handlers export correct function signature
3. Add explicit identity markers to prove handler execution
4. Consider removing `pages/api` handlers to eliminate conflict (or ensure they're not used)
5. Check for any Vercel configuration that might affect routing

## Verification Steps

After fix:
1. Check Vercel Functions list shows `/api/paygate-token` and `/api/debug-paygate`
2. Check Vercel logs show these handlers being invoked (not verify_race)
3. Check responses include `X-Handler-Identity` headers
4. Check responses do NOT contain `verify_race_stub`

