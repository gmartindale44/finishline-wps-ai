# Routing Diagnosis: PayGate Endpoints Hitting verify_race

## Root Cause

**Problem:** Requests to `/api/paygate-token` and `/api/debug-paygate` are returning `verify_race_stub` JSON from `pages/api/verify_race.js` instead of executing their own handlers.

**Root Cause:** Vercel prioritizes the root `/api` directory (serverless functions) over Next.js `pages/api/` (API routes). When a request comes to `/api/paygate-token` or `/api/debug-paygate`:

1. Vercel first checks root `/api` directory for a matching handler
2. Since `api/paygate-token.js` and `api/debug-paygate.js` do NOT exist in root `/api` (they were deleted)
3. Vercel's routing falls back to `api/verify_race.js` (which exists as a re-export)
4. `api/verify_race.js` re-exports `pages/api/verify_race.js`, which returns `verify_race_stub` for non-POST requests

**Evidence:**
- `api/verify_race.js` exists: `export { default } from "../pages/api/verify_race.js";`
- `pages/api/paygate-token.js` exists and is correct
- `pages/api/debug-paygate.js` exists and is correct
- Root `/api` has many other handlers (tracks.js, health.js, etc.) that work correctly
- The issue only affects endpoints that don't exist in root `/api` but exist in `pages/api/`

## Exact File Responsible

**File:** `api/verify_race.js`
- **Location:** Root `/api` directory
- **Content:** `export { default } from "../pages/api/verify_race.js";`
- **Why it's a problem:** Vercel treats this as a serverless function handler for `/api/verify_race`, but when other `/api/*` endpoints don't have root handlers, Vercel may be routing them to this file as a fallback.

## Solution

Since Vercel prioritizes root `/api` over `pages/api/`, we have two options:

1. **Option A (Preferred):** Create explicit handlers in root `/api` for paygate endpoints that re-export from `pages/api/`
2. **Option B:** Remove `api/verify_race.js` and ensure all API routes exist only in `pages/api/`

**Chosen Solution:** Option A - Create re-export handlers in root `/api` for paygate endpoints. This ensures Vercel routes correctly while maintaining the canonical handlers in `pages/api/`.

## Files Created

1. `api/paygate-token.js` - Re-export from `pages/api/paygate-token.js`
2. `api/debug-paygate.js` - Re-export from `pages/api/debug-paygate.js`

These re-exports ensure Vercel routes to the correct handlers while maintaining the canonical handlers in `pages/api/`.

## Local Verification Results

### Test 1: `/api/paygate-token`
```bash
curl -i http://localhost:3000/api/paygate-token?cb=123
```

**Result:**
- Status: `200 OK`
- Content-Type: `application/javascript; charset=utf-8`
- X-Handler-Identity: `PAYGATE_TOKEN_OK`
- Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- Does NOT contain: `verify_race_stub`, JSON, or `METHOD_NOT_ALLOWED`

### Test 2: `/api/debug-paygate`
```bash
curl -i http://localhost:3000/api/debug-paygate?cb=123
```

**Result:**
- Status: `200 OK`
- Content-Type: `application/json`
- X-Handler-Identity: `DEBUG_PAYGATE_OK`
- JSON contains: `"ok": true, "apiRouteWorking": true`
- Does NOT contain: `"step": "verify_race_stub"` or `"handlerFile": "pages/api/verify_race.js"`

### Test 3: `/api/verify_race` (should still work)
```bash
curl -i http://localhost:3000/api/verify_race
```

**Result:**
- Status: `200 OK`
- Returns `verify_race_stub` JSON (expected for GET request)
- This confirms verify_race handler is not broken

