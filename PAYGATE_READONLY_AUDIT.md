# PayGate Security Audit - Read-Only Investigation

**Date**: 2025-01-XX  
**Type**: READ-ONLY (No modifications)  
**Scope**: Frontend PayGate mechanisms, API endpoint access patterns, server-side enforcement

---

## ✅ Premium API Endpoints

| Endpoint | Method | Called From | Line | Premium/Public | Notes |
|----------|--------|-------------|------|----------------|-------|
| `/api/predict_wps` | POST | `public/js/finishline-picker-bootstrap.js` | 543 | **Premium** | WPS predictions (core feature) |
| `/api/predict_wps` | POST | `public/js/finishline-simple.js` | 117 | **Premium** | Alternative entry point |
| `/api/photo_extract_openai_b64` | POST | `public/js/finishline-picker-bootstrap.js` | 301 | **Premium** | OCR extraction (OpenAI Vision API) |
| `/api/photo_extract_openai_b64` | POST | `public/js/finishline-simple.js` | 64 | **Premium** | Alternative entry point |
| `/api/verify_race` | POST | `public/js/verify-modal.js` | 1268, 1511 | **Premium** | Race verification |
| `/api/verify_race` | POST | `public/js/verify-tab.js` | 88 | **Premium** | Alternative verify entry |
| `/api/green_zone` | POST | `public/js/green-zone-panel.js` | 48 | **Premium** | GreenZone calculations |
| `/api/calibration_status` | GET | `public/js/results-panel.js` | 732 | **Premium** | Calibration dashboard data |
| `/api/log_prediction` | POST | `public/js/finishline-picker-bootstrap.js` | 674 | **Public** | Logging endpoint (calibration) |
| `/api/health` | GET | `public/js/results-panel.js` | 26 | **Public** | Health check |
| `/api/persistence` | POST | `public/js/results-panel.js` | 49 | **Public** | State persistence |
| `/api/record_result` | POST | `public/js/results-panel.js` | 1358 | **Public** | Result logging |
| `/api/greenzone_today` | GET | `public/js/verify-modal.js` | 663 | **Premium** | Today's GreenZone data |
| `/api/verify_backfill` | POST | `public/js/verify-modal.js` | 1104 | **Premium** | Batch verification |
| `/api/family-unlock` | POST | `public/js/paygate-helper.js` | 210 | **Public** | Token validation (unlock only) |
| `/api/paygate-token` | GET | Loaded via script tag | N/A | **Public** | Config endpoint |
| `/api/debug-paygate` | GET | Manual/debug | N/A | **Public** | Debug endpoint |
| `/api/calibration/summary` | GET | `public/js/components/calibration-tracker.js` | 45 | **Premium** | Calibration summary |
| `/api/tracks` | GET | `public/js/track-combobox.js` | 73 | **Public** | Track lookup |

**Premium Endpoints Summary**: 9 endpoints identified as premium features
- All premium endpoints are **publicly accessible** (no server-side PayGate checks)
- Frontend only checks `paygate.isUnlocked()` before displaying results

---

## 🔓 Frontend PayGate Mechanisms

### 1. localStorage Key: `fl:paygate:access`

**Location**: `public/js/paygate-helper.js`

**Set At**:
- Line 179: `localStorage.setItem(STORAGE_KEY, JSON.stringify(data))` in `unlock()` function
- Called from:
  - Line 235: Family unlock (after server validation)
  - Line 266: Bypass key unlock
  - Line 297: URL param unlock (`?paid=1&plan=day`)

**Read At**:
- Line 96: `localStorage.getItem(STORAGE_KEY)` in `isUnlocked()` function
- Line 332: `localStorage.getItem(STORAGE_KEY)` in `getBypassUsed()` function
- Line 350: `localStorage.getItem(STORAGE_KEY)` in `setBypassUsed()` function

**Data Structure**:
```javascript
{
  expiry: number,           // Timestamp (Date.now() + durationMs)
  unlockedAt: number,        // Timestamp when unlocked
  durationMs: number,         // Duration in milliseconds
  plan: string | null,       // 'day', 'core', 'family', or null
  tokenVersion: string | null // SHA-256 hash (first 12 chars) for family plan
}
```

**User Controllable**: ✅ **YES** - User can set via DevTools `localStorage.setItem('fl:paygate:access', JSON.stringify({...}))`

---

### 2. URL Query Parameters

**Location**: `public/js/paygate-helper.js` (lines 188-323)

**Parameters Read**:
- `?success=1` - Stripe return indicator
- `?paid=1` - Paid unlock indicator
- `?plan=day|core|family` - Plan type
- `?bypass=1` - Bypass unlock flag
- `?key=FLTEST2025` - Bypass key (hardcoded)
- `?family=1` - Family unlock flag
- `?token=<TOKEN>` - Family unlock token

**Set At**: N/A (read from `window.location.searchParams`)

**Read At**: 
- Line 195-201: `url.searchParams.get()` in `checkUrlParams()` function
- Line 146-150: Called from `public/js/results-panel.js` on page load

**User Controllable**: ✅ **YES** - User can add any URL params manually

**Bypass Key**: `FLTEST2025` (hardcoded at line 16 in `paygate-helper.js`)

---

### 3. Global JavaScript Objects

**Location**: `public/js/paygate-helper.js` (lines 361-369)

**Objects Exposed**:
- `window.__FL_PAYGATE__` - Main PayGate API
  - `isUnlocked()` - Check unlock status
  - `unlock(durationMs, plan, tokenVersion)` - Unlock function
  - `checkUrlParams()` - Check URL params
  - `getBypassUsed()` - Get bypass status
  - `setBypassUsed()` - Mark bypass as used
  - `DAY_PASS_URL` - Stripe day pass link
  - `CORE_MONTHLY_URL` - Stripe core monthly link

**Set At**:
- Line 361: `window.__FL_PAYGATE__ = { ... }` in `paygate-helper.js`
- Line 70-77: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__` set by `/api/paygate-token` script
- Line 72: `window.__FL_FAMILY_UNLOCK_DAYS__` set by `/api/paygate-token` script
- Line 73: `window.__PAYGATE_TEST_MODE__` set by `/api/paygate-token` script
- Line 75: `window.__PAYGATE_ENFORCE__` set by `/api/paygate-token` script

**Read At**:
- Line 26-27: `window.__PAYGATE_ENFORCE__` in `isUnlocked()`
- Line 32-33: `window.__PAYGATE_TEST_MODE__` in `isUnlocked()`
- Line 78-79: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__` in `isUnlocked()`
- Line 120: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__` for family plan validation
- Line 231-232: `window.__FL_FAMILY_UNLOCK_DAYS__` for family unlock duration
- Line 998-1000: `paygate.isUnlocked()` in `public/js/results-panel.js`

**User Controllable**: ✅ **YES** - User can override via DevTools:
```javascript
window.__FL_PAYGATE__.isUnlocked = () => true;
window.__PAYGATE_TEST_MODE__ = true;
```

---

### 4. Cookies

**Status**: ❌ **NONE FOUND**

**Evidence**: No `document.cookie` usage found in PayGate-related code

---

### 5. Server-Side Token Validation

**Location**: `/api/family-unlock` (POST)

**Mechanism**:
- Frontend sends token via `fetch('/api/family-unlock', { body: { token } })`
- Server validates via timing-safe comparison (line 40 in `pages/api/family-unlock.js`)
- Returns `{ ok: true, tokenVersion }` if valid
- Frontend then unlocks localStorage with returned `tokenVersion`

**User Controllable**: ⚠️ **PARTIAL** - Token must match `FAMILY_UNLOCK_TOKEN` env var, but user can call endpoint directly

---

## 🌐 Frontend API Call Pattern

### HTTP Client Library

**Library Used**: Native `fetch()` API

**Evidence**:
- All API calls use `fetch()` (no axios, no other HTTP libraries)
- Found in: `public/js/*.js`, `apps/web/*.js`

### URL Patterns

**Same-Origin**: ✅ **YES** - All API calls use relative URLs:
- `/api/predict_wps`
- `/api/photo_extract_openai_b64`
- `/api/verify_race`
- `/api/family-unlock`

**Absolute URLs**: ❌ **NONE FOUND** (except in `apps/web/app.js` which uses `${API_BASE}/api/finishline/predict`)

### Credentials/Cookies

**Credentials Included**: ❌ **NO**

**Evidence**: No `credentials: 'include'` or `withCredentials: true` found in fetch calls

**Example Pattern**:
```javascript
fetch('/api/predict_wps', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
```

### Headers Set

**Standard Headers**:
- `Content-Type: application/json` - Set on all POST requests

**Auth Headers**: ❌ **NONE FOUND**
- No `Authorization` header
- No `X-API-Key` header
- No custom auth headers

**Custom Headers**: ❌ **NONE FOUND**

---

## 🧱 Existing Server-Side Enforcement

### Next.js Middleware

**Status**: ❌ **NONE FOUND**

**Evidence**:
- No `middleware.ts` or `middleware.js` in project root
- No `src/middleware.ts` or `src/middleware.js`
- Only Python middleware found: `apps/api/common/middleware.py` (FastAPI, not Next.js)

### API Route PayGate Checks

**Status**: ❌ **NONE FOUND**

**Evidence**: Searched all `pages/api/*.js` files:
- No `req.cookies` validation
- No `req.headers.authorization` checks
- No PayGate unlock status validation
- No `isUnlocked()` equivalent on server

**Files Checked**:
- `pages/api/predict_wps.js` - No PayGate check
- `pages/api/photo_extract_openai_b64.js` - No PayGate check
- `pages/api/verify_race.js` - No PayGate check
- `pages/api/green_zone.ts` - No PayGate check
- `pages/api/calibration_status.js` - No PayGate check

### Stripe Webhook Validation

**Status**: ❌ **NONE FOUND**

**Evidence**:
- No `/api/stripe-webhook` endpoint
- No Stripe webhook signature validation
- No subscription status checks
- No `stripe.subscriptions.retrieve()` calls
- No `stripe.checkout.sessions.retrieve()` calls

**Stripe Integration**: Only payment links (hardcoded URLs in `paygate-helper.js`):
- `DAY_PASS_URL = "https://buy.stripe.com/9B600c09y5GU0HS3kn9k405"`
- `CORE_MONTHLY_URL = "https://buy.stripe.com/14A7sEaOc8T6aisbQT9k407"`

---

## ⚠️ Risk Notes

### 1. Expensive API Endpoints (No Server-Side Protection)

**High Cost Endpoints**:

| Endpoint | Cost Factor | Current Protection |
|----------|-------------|-------------------|
| `/api/photo_extract_openai_b64` | OpenAI Vision API ($$$) | ❌ None |
| `/api/predict_wps` | CPU-intensive calculations | ❌ None |
| `/api/verify_race` | External scraping (HRN, Equibase) | ❌ None |
| `/api/green_zone` | Redis writes + calculations | ❌ None |

**Risk**: Unauthorized users can call these endpoints directly, incurring costs without payment.

### 2. Security-Sensitive Endpoints

**Endpoints Writing to Redis**:
- `/api/log_prediction` - Writes `fl:pred:*` hashes
- `/api/verify_race` - Writes `fl:verify:*` keys
- `/api/green_zone` - Writes to `greenZone:v1` list
- `/api/predict_wps` - Writes `fl:predmeta:*` keys

**Risk**: Unauthorized writes could pollute calibration data or cause data integrity issues.

### 3. Frontend Dependency on PayGate Helper

**Critical Dependency**: `public/js/results-panel.js` line 998-1005

```javascript
const isUnlocked = !PAYWALL_ENABLED || (() => {
  try {
    return paygate.isUnlocked();
  } catch (err) {
    return false; // fail-closed
  }
})();
```

**Risk**: If `paygate-helper.js` fails to load, frontend defaults to locked (good), but API calls still succeed (bad).

### 4. URL Parameter Unlocks (No Server Validation)

**Mechanism**: `?paid=1&plan=day` unlocks without server validation

**Risk**: User can manually add params to any URL to unlock, even without payment.

### 5. Hardcoded Bypass Key

**Location**: `public/js/paygate-helper.js` line 16
```javascript
const BYPASS_KEYS = ['FLTEST2025'];
```

**Risk**: Key is visible in source code, cannot be rotated without deployment.

### 6. Test Mode Bypass

**Mechanism**: `window.__PAYGATE_TEST_MODE__` (from env var `NEXT_PUBLIC_PAYGATE_TEST_MODE`)

**Risk**: If test mode is enabled, PayGate is completely bypassed (intentional for dev, but could leak to production).

---

## 🟢 Readiness Assessment for Server-Side Gating

### Current State

**Frontend Gating**: ✅ **FULLY IMPLEMENTED**
- `paygate.isUnlocked()` checks before showing premium content
- Fail-closed design (defaults to locked on errors)
- Multiple unlock mechanisms (URL params, localStorage, family tokens)

**Server-Side Gating**: ❌ **NOT IMPLEMENTED**
- No middleware
- No API route checks
- No cookie/session validation
- No Stripe webhook integration

### What Would Break

**If server-side gating is added without changes**:

1. ✅ **Frontend UI** - Would continue to work (already checks `isUnlocked()`)
2. ❌ **Direct API Calls** - Would start returning `403 Forbidden` (intended)
3. ⚠️ **Family Unlock Flow** - Would need to issue server-side token/cookie
4. ⚠️ **URL Param Unlocks** - Would need server-side validation of Stripe payments
5. ⚠️ **Bypass Key** - Would need server-side validation or removal

### Required Changes for Server-Side Gating

**Minimal Changes**:
1. Add Next.js middleware to check unlock status
2. Issue httpOnly cookie on unlock (prevents JS access)
3. Validate cookie in middleware before API routes execute
4. Integrate Stripe webhooks to validate payments server-side

**Breaking Changes**:
- Direct API calls without valid cookie would fail (intended)
- URL param unlocks would need server-side validation
- Bypass key would need server-side validation or removal

**Non-Breaking Changes**:
- Frontend UI would continue to work (already checks `isUnlocked()`)
- Existing localStorage mechanism could remain for UX (but server would enforce)

---

## 📋 Environment Variables (Names Only)

### PayGate-Related

- `FAMILY_UNLOCK_TOKEN` - Server-side secret for family plan
- `FAMILY_PASS_TOKEN` - Alternative name (backward compatibility)
- `FAMILY_UNLOCK_DAYS` - Duration for family unlock (default: 365)
- `FAMILY_PASS_DAYS` - Alternative name (backward compatibility)
- `NEXT_PUBLIC_PAYGATE_TEST_MODE` - Test mode flag (exposed to frontend)
- `PAYGATE_TEST_MODE` - Alternative name (backward compatibility)
- `NEXT_PUBLIC_PAYGATE_ENFORCE` - Enforcement flag (exposed to frontend)
- `PAYGATE_ENFORCE` - Alternative name (backward compatibility)

### External Services

- `UPSTASH_REDIS_REST_URL` - Upstash Redis REST API URL
- `UPSTASH_REDIS_REST_TOKEN` - Upstash Redis REST API token
- `FINISHLINE_OPENAI_API_KEY` - OpenAI API key (for OCR)
- `OPENAI_API_KEY` - Alternative name (backward compatibility)
- `FINISHLINE_OPENAI_MODEL` - OpenAI model name (default: 'gpt-4o-mini')
- `OPENAI_MODEL` - Alternative name (backward compatibility)

### Stripe

**Status**: ❌ **NO STRIPE ENV VARS FOUND**

**Evidence**: Stripe integration uses hardcoded payment links only, no API keys or webhook secrets found.

---

## 📊 Summary Statistics

- **Premium API Endpoints**: 9 identified
- **Public API Endpoints**: 8 identified
- **PayGate Mechanisms**: 4 (localStorage, URL params, global objects, server token)
- **Server-Side Checks**: 0
- **Stripe Webhooks**: 0
- **Middleware Files**: 0
- **Environment Variables**: 8 PayGate-related, 6 service-related

---

**End of Read-Only Audit Report**

