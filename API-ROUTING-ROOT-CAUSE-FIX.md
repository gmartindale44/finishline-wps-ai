# API Routing Root Cause & Fix

## 🔍 Root Cause Analysis

### Problem
`/api/_debug-paygate` and `/api/paygate-token` were being routed to `pages/api/verify_race.js` instead of their own handlers, returning:
- `"handlerFile":"pages/api/verify_race.js"`
- `"step":"verify_race_stub"`
- `"error":"METHOD_NOT_ALLOWED"`

### Root Cause
**Vercel prioritizes root-level `/api` directory over `pages/api/` for API routes.**

1. **Root `/api` directory exists** with some files that re-export from `pages/api/`:
   - `api/verify_race.js` → `export { default } from "../pages/api/verify_race.js"`
   - `api/verify_backfill.js` → `export { default } from "../pages/api/verify_backfill.js"`
   - `api/cse_resolver.js` → `export { default } from "../pages/api/cse_resolver.js"`

2. **Missing re-export files:**
   - `api/paygate-token.js` ❌ (does not exist)
   - `api/_debug-paygate.js` ❌ (does not exist)

3. **Vercel routing behavior:**
   - When `/api/paygate-token` is requested, Vercel looks in root `/api/` first
   - Since `api/paygate-token.js` doesn't exist, it falls back to a catch-all or default route
   - This routes to `api/verify_race.js` (which re-exports `pages/api/verify_race.js`)
   - Result: `verify_race.js` handler executes instead of `paygate-token.js`

### Evidence
- `api/verify_race.js` exists and re-exports from `pages/api/verify_race.js`
- `api/paygate-token.js` and `api/_debug-paygate.js` were missing
- Other API routes that work have corresponding files in root `/api/`

## ✅ Fix Applied

### Files Created

1. **`api/paygate-token.js`**
   ```javascript
   export { default } from "../pages/api/paygate-token.js";
   ```

2. **`api/_debug-paygate.js`**
   ```javascript
   export { default } from "../pages/api/_debug-paygate.js";
   ```

### Why This Works
- Vercel now finds the re-export files in root `/api/`
- These files correctly route to the actual handlers in `pages/api/`
- Matches the pattern used by other working API routes (`verify_race.js`, `verify_backfill.js`, etc.)

## 🧪 Verification Steps

### 1. Test `/api/_debug-paygate`
```bash
curl -i https://<deployment>/api/_debug-paygate
```

**Expected Response:**
```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "hasToken": true,
  "hasVersion": true,
  "tokenVersionLength": 12,
  "familyUnlockDays": 365,
  "apiRouteWorking": true
}
```

**Should NOT return:**
- `"handlerFile":"pages/api/verify_race.js"`
- `"step":"verify_race_stub"`
- `"error":"METHOD_NOT_ALLOWED"`

### 2. Test `/api/paygate-token`
```bash
curl -i https://<deployment>/api/paygate-token
```

**Expected Response:**
```
HTTP/1.1 200 OK
Content-Type: application/javascript
Cache-Control: public, max-age=300

window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "abc123def456";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: true, familyUnlockDays: 365 });
```

**Should NOT return:**
- JSON with `"handlerFile":"pages/api/verify_race.js"`
- `"step":"verify_race_stub"`
- HTML error page

### 3. Test Family Plan URL Unlock
```bash
# Open in browser (incognito)
https://<deployment>/?paid=1&plan=family
```

**Expected:**
- Premium content unlocks
- Console shows: `[PayGate] Unlocked via URL params: { plan: 'family', durationDays: 180, ... }`
- localStorage contains `plan: "family"` and `expiry` ~180 days from now
- **No console error:** "Unexpected token <" from paygate-token script

### 4. Verify Build Output
After deployment, verify build includes:
- `.next/server/pages/api/_debug-paygate.js` ✅
- `.next/server/pages/api/paygate-token.js` ✅
- `.next/server/pages/api/verify_race.js` ✅

## 📋 Files Modified

1. **`api/paygate-token.js`** (NEW)
   - Re-exports from `pages/api/paygate-token.js`
   - Matches pattern used by other API routes

2. **`api/_debug-paygate.js`** (NEW)
   - Re-exports from `pages/api/_debug-paygate.js`
   - Matches pattern used by other API routes

## 🔧 Alternative Solutions Considered

1. **Remove root `/api` directory** ❌
   - Would break other working API routes
   - Too risky for production

2. **Configure Vercel to prioritize `pages/api`** ❌
   - Would require `vercel.json` configuration
   - Could break existing routing
   - Not recommended per project docs

3. **Create re-export files** ✅ (CHOSEN)
   - Minimal change
   - Matches existing pattern
   - Safe and consistent

## 📝 Commit Message

```
fix: add missing API route re-exports for paygate endpoints

Root cause: Vercel prioritizes root /api directory over pages/api/.
Missing re-export files caused /api/paygate-token and /api/_debug-paygate
to be routed to verify_race.js instead of their own handlers.

Fix: Create api/paygate-token.js and api/_debug-paygate.js that
re-export from pages/api/, matching the pattern used by other API routes.

Fixes: /api/paygate-token and /api/_debug-paygate returning verify_race_stub
```

## ✅ Testing Checklist

- [ ] `/api/_debug-paygate` returns JSON with `apiRouteWorking: true`
- [ ] `/api/paygate-token` returns JavaScript (not JSON)
- [ ] No `verify_race_stub` in responses
- [ ] No `METHOD_NOT_ALLOWED` errors
- [ ] `/?paid=1&plan=family` unlocks premium content
- [ ] No console errors when loading paygate-token script
- [ ] Other API routes still work (verify_race, tracks, etc.)

