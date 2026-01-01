# Routing Audit Evidence Table

## Request → Routed Handler → Why

| Request | Actual Handler (Bug) | Expected Handler | Root Cause |
|---------|---------------------|------------------|------------|
| `GET /api/paygate-token` | `pages/api/verify_race.js` (returns stub) | `pages/api/paygate-token.js` | Routing conflict between root `/api/` and `pages/api/` |
| `GET /api/debug-paygate` | `pages/api/verify_race.js` (returns stub) | `pages/api/debug-paygate.js` | Routing conflict between root `/api/` and `pages/api/` |

## Evidence Findings

### ✅ NO Explicit Rewrite Mechanism Found

1. **vercel.json**: ❌ Does NOT exist
2. **next.config.cjs**: ✅ Clean - no rewrites, redirects, or headers
   ```javascript
   const nextConfig = {
     // Enable API routes (this is the default, but explicit for clarity)
     // Do NOT use output: 'export' as that disables API routes
   };
   ```
3. **middleware.ts/js**: ❌ Does NOT exist
4. **Catch-all routes**: ❌ NONE found
   - No `pages/api/[...slug].js`
   - No `pages/api/[[...slug]].js`
   - No `api/[...slug].js`
   - No `api/[[...slug]].js`
5. **pages/api/index.js**: ❌ Does NOT exist

### 🔍 Structural Conflict Identified

**Root `/api/` Directory Structure:**
- `api/verify_race.js` EXISTS (60 bytes - re-export shim)
  ```javascript
  export { default } from "../pages/api/verify_race.js";
  ```
- `api/paygate-token.js` - ❌ DELETED (removed in previous commit)
- `api/debug-paygate.js` - ❌ DELETED (removed in previous commit)
- Many other endpoints exist in root `/api/` (analyze.js, predict_wps.js, etc.)

**Pages `/api/` Directory Structure:**
- `pages/api/paygate-token.js` - ✅ EXISTS (full handler)
- `pages/api/debug-paygate.js` - ✅ EXISTS (full handler)
- `pages/api/verify_race.js` - ✅ EXISTS (full handler)

### 🎯 Prime Suspect: `api/verify_race.js` Re-Export Shim

**File:** `api/verify_race.js`
**Content:**
```javascript
export { default } from "../pages/api/verify_race.js";
```

**Hypothesis:** 
When both root `/api/` and `pages/api/` exist, Vercel's routing can become ambiguous. The presence of `api/verify_race.js` as a re-export might cause Vercel to use it as a fallback handler when routing conflicts occur.

However, since `api/paygate-token.js` and `api/debug-paygate.js` were already deleted, the issue might be:
1. Vercel deployment cache still has old routing
2. Next.js build artifacts in `.next/` causing routing confusion
3. The `api/verify_race.js` re-export is somehow still interfering

### 🔧 Verification of Handlers

**pages/api/paygate-token.js:**
- ✅ Exists
- ✅ Has identity header: `X-Handler-Identity: PAYGATE_TOKEN_OK`
- ✅ Returns JavaScript (not JSON)
- ✅ Has cache-busting headers

**pages/api/debug-paygate.js:**
- ✅ Exists
- ✅ Has identity header: `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ Returns JSON
- ✅ Has cache-busting headers

## Root Cause Conclusion

**No explicit rewrite mechanism exists.** The routing conflict is structural:

1. **Next.js Pages Router** project should use `pages/api/*` exclusively
2. Root `/api/` directory contains many handlers (including `verify_race.js` re-export)
3. Having both creates routing ambiguity in Vercel's deployment
4. Even though `api/paygate-token.js` and `api/debug-paygate.js` were deleted, the presence of `api/verify_race.js` and other root `/api/` handlers may still cause routing conflicts

## Solution

Since this is a Next.js Pages Router project and handlers exist in `pages/api/`, we should:
1. ✅ Already done: Removed duplicate handlers from root `/api/` for paygate endpoints
2. ⚠️ Consider: The `api/verify_race.js` re-export might still cause issues, but it may be needed for other endpoints that rely on root `/api/` structure
3. ✅ Ensure: Handlers in `pages/api/` have proper identity headers and cache headers (already done)
4. ⚠️ Add: Identity header to `verify_race.js` stub response for debugging

