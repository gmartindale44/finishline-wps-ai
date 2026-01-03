# PayGate Security Audit Report

**Date**: 2025-01-XX  
**Project**: FinishLine WPS AI  
**Auditor**: Security Review  
**Scope**: Complete PayGate access control enforcement analysis

---

## EXECUTIVE SUMMARY

**VERDICT**: **Frontend-only gating**

PayGate access control is **exclusively enforced in the browser**. All API endpoints are **publicly accessible** without server-side PayGate validation. An attacker can bypass PayGate by:

1. Calling API endpoints directly (curl, Postman, custom scripts)
2. Modifying frontend JavaScript to set `window.__FL_PAYGATE__.isUnlocked = () => true`
3. Manipulating localStorage to inject fake unlock tokens
4. Bypassing UI checks entirely

**CRITICAL FINDING**: No server-side PayGate enforcement exists on any API endpoint.

---

## 1. PAYGATE MECHANISM LOCATIONS

### 1.1 Frontend PayGate Logic

#### File: `public/js/paygate-helper.js`
- **Type**: Frontend-only (UI gating)
- **Enforcement**: Client-side JavaScript
- **Trusted Data**: 
  - `localStorage.getItem('fl:paygate:access')` - JSON object with `{ expiry, plan, tokenVersion }`
  - `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__` - Token version hash (exposed via `/api/paygate-token`)
  - `window.__PAYGATE_TEST_MODE__` - Test mode flag (env var controlled)
  - `window.__PAYGATE_ENFORCE__` - Enforcement flag (env var controlled)
- **Bypass Methods**:
  - ✅ **Direct API calls**: All endpoints accept requests without PayGate checks
  - ✅ **localStorage manipulation**: User can set `fl:paygate:access` with fake expiry
  - ✅ **JavaScript override**: User can redefine `window.__FL_PAYGATE__.isUnlocked = () => true`
  - ✅ **URL params**: `?paid=1&plan=day` unlocks without server validation
  - ✅ **Bypass key**: `?bypass=1&key=FLTEST2025` (hardcoded in frontend)

**Key Functions**:
- `isUnlocked()` - Checks localStorage + token version (lines 23-161)
- `unlock(durationMs, plan, tokenVersion)` - Writes to localStorage (lines 164-185)
- `checkUrlParams()` - Handles URL unlock params (lines 188-323)

#### File: `public/js/results-panel.js`
- **Type**: Frontend-only (UI gating)
- **Enforcement**: Hides premium content if `paygate.isUnlocked() === false`
- **Trusted Data**: Same as `paygate-helper.js`
- **Bypass Methods**: Same as above
- **Lines**: 998-1005 (unlock check), 1023-1042 (teaser display), 1045-1111 (premium content)

### 1.2 Server-Side PayGate Endpoints

#### File: `pages/api/paygate-token.js`
- **Type**: Configuration endpoint (NOT access control)
- **Purpose**: Exposes token version hash and config flags to frontend
- **Access Control**: ❌ NONE (public GET endpoint)
- **Returns**: JavaScript that sets `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`, `window.__PAYGATE_TEST_MODE__`, `window.__PAYGATE_ENFORCE__`
- **Security**: Token version is a hash (safe to expose), but does NOT validate access

#### File: `pages/api/debug-paygate.js`
- **Type**: Debug endpoint (NOT access control)
- **Purpose**: Returns PayGate configuration for debugging
- **Access Control**: ❌ NONE (public GET endpoint)
- **Returns**: JSON with token version, test mode, enforce flags

#### File: `pages/api/family-unlock.js`
- **Type**: Token validation endpoint (NOT API access control)
- **Purpose**: Validates family unlock token via timing-safe comparison
- **Access Control**: ❌ NONE (validates token but does NOT gate API access)
- **Returns**: `{ ok: true, tokenVersion }` if token matches
- **Note**: This endpoint is ONLY used to unlock the frontend localStorage. It does NOT protect any API endpoints.

---

## 2. API ENDPOINTS - PAYGATE ENFORCEMENT STATUS

### 2.1 Premium API Endpoints (NO SERVER-SIDE ENFORCEMENT)

#### `/api/predict_wps` (POST)
- **File**: `pages/api/predict_wps.js`
- **Server-side PayGate check**: ❌ **NONE**
- **Access**: ✅ **PUBLIC** (anyone can call directly)
- **Frontend check**: ✅ Yes (in `results-panel.js` line 998, `finishline-picker-bootstrap.js` line 543)
- **Bypass**: Call `POST /api/predict_wps` directly with valid JSON payload

#### `/api/photo_extract_openai_b64` (POST)
- **File**: `pages/api/photo_extract_openai_b64.js`
- **Server-side PayGate check**: ❌ **NONE**
- **Access**: ✅ **PUBLIC** (anyone can call directly)
- **Frontend check**: ✅ Yes (in `finishline-picker-bootstrap.js` line 301)
- **Bypass**: Call `POST /api/photo_extract_openai_b64` directly with base64 images

#### `/api/verify_race` (POST)
- **File**: `pages/api/verify_race.js`
- **Server-side PayGate check**: ❌ **NONE**
- **Access**: ✅ **PUBLIC** (anyone can call directly)
- **Frontend check**: ✅ Yes (in `verify-modal.js` line 1268, `verify-tab.js` line 88)
- **Bypass**: Call `POST /api/verify_race` directly with race data

#### `/api/log_prediction` (POST)
- **File**: `pages/api/log_prediction.js`
- **Server-side PayGate check**: ❌ **NONE**
- **Access**: ✅ **PUBLIC** (anyone can call directly)
- **Frontend check**: ✅ Yes (in `finishline-picker-bootstrap.js` line 674)
- **Bypass**: Call `POST /api/log_prediction` directly

#### `/api/green_zone` (POST)
- **File**: `pages/api/green_zone.ts`
- **Server-side PayGate check**: ❌ **NONE**
- **Access**: ✅ **PUBLIC** (anyone can call directly)
- **Frontend check**: ✅ Yes (in `green-zone-panel.js` line 48)
- **Bypass**: Call `POST /api/green_zone` directly

#### `/api/calibration_status` (GET)
- **File**: `pages/api/calibration_status.js`
- **Server-side PayGate check**: ❌ **NONE**
- **Access**: ✅ **PUBLIC** (anyone can call directly)
- **Frontend check**: ✅ Yes (in `results-panel.js` line 732)
- **Bypass**: Call `GET /api/calibration_status` directly

### 2.2 Public API Endpoints (No PayGate Expected)

#### `/api/health` (GET)
- **File**: `pages/api/health.js`
- **Purpose**: Health check
- **PayGate**: ❌ Not applicable (public endpoint)

#### `/api/log_prediction` (POST)
- **File**: `pages/api/log_prediction.js`
- **Purpose**: Logging (calibration data)
- **PayGate**: ❌ Not enforced (logging endpoint)

#### `/api/verify_race` (POST)
- **File**: `pages/api/verify_race.js`
- **Purpose**: Race verification
- **PayGate**: ❌ Not enforced (verification endpoint)

---

## 3. PAYGATE ENFORCEMENT ANALYSIS

### 3.1 Frontend Enforcement

**Location**: `public/js/results-panel.js` (lines 998-1005)

```javascript
const isUnlocked = !PAYWALL_ENABLED || (() => {
  try {
    return paygate.isUnlocked();
  } catch (err) {
    return false; // fail-closed
  }
})();
```

**What it does**:
- Checks `localStorage.getItem('fl:paygate:access')`
- Validates expiry timestamp
- For "family" plan, checks token version matches `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`
- Hides premium UI elements if `isUnlocked === false`

**What it does NOT do**:
- ❌ Does NOT prevent API calls
- ❌ Does NOT validate with server
- ❌ Does NOT check Stripe subscription status
- ❌ Does NOT verify payment

### 3.2 Server-Side Enforcement

**Status**: ❌ **NONE FOUND**

**Evidence**:
- No middleware files (`middleware.ts`, `middleware.js`) found
- No PayGate checks in any API route handler
- No `req.headers.authorization` validation
- No cookie/session validation
- No Stripe webhook verification for API access
- No server-side `isUnlocked()` equivalent

**Searched locations**:
- `pages/api/*.js` - No PayGate checks
- `apps/api/*.py` - No PayGate checks (FastAPI endpoints)
- Root directory - No middleware files
- `lib/*` - No PayGate helpers

---

## 4. SECURITY QUESTIONS - YES/NO ANSWERS

### Q1: Can a user bypass PayGate by calling API endpoints directly?
**Answer**: ✅ **YES**

**Proof**:
- All API endpoints (`/api/predict_wps`, `/api/photo_extract_openai_b64`, `/api/verify_race`, etc.) accept requests without any PayGate validation
- Example bypass:
  ```bash
  curl -X POST https://your-domain.vercel.app/api/predict_wps \
    -H "Content-Type: application/json" \
    -d '{"horses": [...], "track": "...", ...}'
  ```
- No server-side checks prevent this

### Q2: Are any paid-only API routes unprotected server-side?
**Answer**: ✅ **YES - ALL OF THEM**

**Proof**:
- `/api/predict_wps` - No server-side PayGate check
- `/api/photo_extract_openai_b64` - No server-side PayGate check
- `/api/verify_race` - No server-side PayGate check
- `/api/green_zone` - No server-side PayGate check
- `/api/calibration_status` - No server-side PayGate check

**All premium endpoints are publicly accessible.**

### Q3: Is Stripe verification enforced on the server for paid access?
**Answer**: ❌ **NO**

**Proof**:
- No Stripe webhook handlers found
- No Stripe subscription validation in API routes
- No `stripe.subscriptions.retrieve()` calls
- No `stripe.checkout.sessions.retrieve()` calls
- PayGate unlock is based solely on:
  - URL params (`?paid=1&plan=day`)
  - localStorage (`fl:paygate:access`)
  - Family token validation (for family plan only)

**Stripe links redirect with URL params, but server never validates the payment.**

### Q4: Is access enforced per-request or only at page load?
**Answer**: **Only at page load (frontend only)**

**Proof**:
- PayGate check happens in `results-panel.js` when rendering predictions (line 998)
- No per-request validation on API endpoints
- Frontend checks `paygate.isUnlocked()` before showing premium content
- API calls are made regardless of unlock status (frontend just hides results)

---

## 5. TRUSTED DATA SOURCES

### 5.1 Frontend Trusted Data

1. **localStorage** (`fl:paygate:access`)
   - **Format**: `{ expiry: number, plan: string, tokenVersion: string }`
   - **Trust Level**: ❌ **ZERO** (user-controlled)
   - **Bypass**: User can set any value via DevTools

2. **URL Parameters**
   - **Format**: `?paid=1&plan=day` or `?success=1&plan=core`
   - **Trust Level**: ❌ **ZERO** (user-controlled)
   - **Bypass**: User can add params to any URL

3. **Bypass Key**
   - **Format**: `?bypass=1&key=FLTEST2025`
   - **Trust Level**: ❌ **ZERO** (hardcoded in frontend)
   - **Bypass**: Key is visible in `paygate-helper.js` line 16

4. **Token Version** (`window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`)
   - **Format**: 12-char SHA-256 hash
   - **Trust Level**: ⚠️ **LOW** (exposed via `/api/paygate-token`, but validates against server for family plan)
   - **Bypass**: User can override `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`

5. **Test Mode Flag** (`window.__PAYGATE_TEST_MODE__`)
   - **Format**: Boolean (from env var)
   - **Trust Level**: ⚠️ **MEDIUM** (server-controlled, but frontend can override)
   - **Bypass**: User can set `window.__PAYGATE_TEST_MODE__ = true`

### 5.2 Server-Side Trusted Data

1. **Family Unlock Token** (`FAMILY_UNLOCK_TOKEN` env var)
   - **Usage**: Validated in `/api/family-unlock` via timing-safe comparison
   - **Trust Level**: ✅ **HIGH** (server-side secret)
   - **Note**: Only used for family plan unlock, NOT for API access control

2. **Stripe Payment Links**
   - **Usage**: Redirect with `?paid=1&plan=day` after payment
   - **Trust Level**: ⚠️ **LOW** (no server-side validation of payment)
   - **Bypass**: User can manually add `?paid=1&plan=day` to any URL

---

## 6. BYPASS VECTORS

### 6.1 Direct API Calls

**Method**: Call API endpoints directly without going through frontend

**Example**:
```bash
# Bypass PayGate for predictions
curl -X POST https://your-domain.vercel.app/api/predict_wps \
  -H "Content-Type: application/json" \
  -d '{
    "horses": [{"name": "Horse1", "odds": "3/1"}],
    "track": "Aqueduct",
    "date": "2025-01-15",
    "surface": "dirt"
  }'
```

**Impact**: ✅ **FULL ACCESS** to all premium features

### 6.2 localStorage Manipulation

**Method**: Set fake unlock data in localStorage

**Example**:
```javascript
// In browser DevTools Console
localStorage.setItem('fl:paygate:access', JSON.stringify({
  expiry: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year
  plan: 'core',
  tokenVersion: null
}));
// Refresh page
```

**Impact**: ✅ **FULL ACCESS** to premium UI

### 6.3 JavaScript Override

**Method**: Override PayGate functions

**Example**:
```javascript
// In browser DevTools Console
window.__FL_PAYGATE__.isUnlocked = () => true;
// Or
Object.defineProperty(window.__FL_PAYGATE__, 'isUnlocked', {
  value: () => true,
  writable: false
});
```

**Impact**: ✅ **FULL ACCESS** to premium UI

### 6.4 URL Parameter Manipulation

**Method**: Add unlock params to URL

**Example**:
```
https://your-domain.vercel.app/?paid=1&plan=core
```

**Impact**: ✅ **FULL ACCESS** to premium UI (until page refresh)

### 6.5 Bypass Key Usage

**Method**: Use hardcoded bypass key

**Example**:
```
https://your-domain.vercel.app/?bypass=1&key=FLTEST2025
```

**Impact**: ✅ **FULL ACCESS** to premium UI (30 days)

---

## 7. FINAL VERDICT

### **VERDICT: Frontend-only gating**

**Summary**:
- ✅ PayGate exists and functions correctly for **honest users**
- ❌ PayGate provides **ZERO protection** against determined attackers
- ❌ All premium API endpoints are **publicly accessible**
- ❌ No server-side validation of payments or subscriptions
- ❌ No Stripe webhook integration for access control

**Security Level**: **LOW** (UI-only protection)

---

## 8. SECURITY RISK SUMMARY

### 8.1 What is Safe

✅ **Family unlock token validation** (`/api/family-unlock`)
- Uses timing-safe comparison
- Validates against server-side secret
- Prevents token brute-force attacks

✅ **Token version rotation**
- Family plan tokens can be rotated by changing `FAMILY_UNLOCK_TOKEN` env var
- Frontend checks token version on unlock
- Prevents reuse of old tokens

✅ **Fail-closed design**
- If PayGate helper fails to load, defaults to locked state
- Prevents accidental unlocks on errors

### 8.2 What is Vulnerable

❌ **All premium API endpoints**
- `/api/predict_wps` - Publicly accessible
- `/api/photo_extract_openai_b64` - Publicly accessible
- `/api/verify_race` - Publicly accessible
- `/api/green_zone` - Publicly accessible
- `/api/calibration_status` - Publicly accessible

❌ **localStorage-based access control**
- User can manipulate `fl:paygate:access` via DevTools
- No server-side validation of unlock status

❌ **URL parameter unlocks**
- `?paid=1&plan=day` unlocks without server validation
- No verification that payment actually occurred

❌ **Bypass key**
- Hardcoded in frontend (`FLTEST2025`)
- Visible to anyone who reads `paygate-helper.js`
- Cannot be rotated without code deployment

❌ **Stripe payment validation**
- No webhook handlers to verify payments
- No subscription status checks
- Payment links redirect with URL params, but server never validates

### 8.3 What Would Be Required to Harden Fully

#### **Option 1: Server-Side PayGate Middleware** (Recommended)

**Implementation**:
1. Create Next.js middleware (`middleware.ts`) that checks PayGate status
2. Validate unlock status on every API request
3. Store unlock status in:
   - **Option A**: Signed JWT cookie (validated server-side)
   - **Option B**: Server-side session (Redis/database)
   - **Option C**: Stripe subscription ID (validated via Stripe API)

**Required changes**:
- Add `middleware.ts` in project root
- Validate unlock status before API route handlers execute
- Return `403 Forbidden` if user is not unlocked
- Integrate Stripe webhooks to update unlock status

**Example structure**:
```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/predict_wps')) {
    const unlockStatus = validateUnlockStatus(request);
    if (!unlockStatus) {
      return NextResponse.json({ ok: false, error: 'PayGate locked' }, { status: 403 });
    }
  }
  // ... other protected routes
}
```

#### **Option 2: Stripe Webhook Integration**

**Implementation**:
1. Create `/api/stripe-webhook` endpoint
2. Verify Stripe webhook signatures
3. On `checkout.session.completed`, store subscription ID in database/Redis
4. On API requests, check subscription status via Stripe API or database

**Required changes**:
- Add Stripe webhook handler
- Store subscription IDs (user ID → subscription ID mapping)
- Validate subscription status on each API request
- Handle subscription cancellations/expirations

#### **Option 3: JWT-Based Access Tokens**

**Implementation**:
1. On successful unlock (Stripe payment or family token), issue signed JWT
2. Store JWT in httpOnly cookie (not accessible to JavaScript)
3. Validate JWT on every API request
4. Include expiry and plan in JWT payload

**Required changes**:
- Add JWT signing/verification library
- Issue JWTs on unlock (via `/api/unlock` endpoint)
- Validate JWTs in API route handlers or middleware
- Set httpOnly cookies (prevents JavaScript access)

#### **Option 4: Hybrid Approach** (Best Security)

**Implementation**:
1. **Frontend**: Keep UI gating for UX (hides premium content)
2. **Backend**: Add server-side validation for all API endpoints
3. **Stripe**: Integrate webhooks to track real subscriptions
4. **Tokens**: Use httpOnly cookies for unlock status

**Required changes**:
- All of the above
- Maintain frontend checks for UX
- Add server-side enforcement for security

---

## 9. RECOMMENDATIONS

### **Immediate Actions** (High Priority)

1. ✅ **Add server-side PayGate middleware**
   - Protect all premium API endpoints
   - Validate unlock status on every request
   - Return `403 Forbidden` if locked

2. ✅ **Integrate Stripe webhooks**
   - Verify payments server-side
   - Store subscription status in database/Redis
   - Validate subscriptions on API requests

3. ✅ **Remove hardcoded bypass key**
   - Move to environment variable
   - Rotate regularly
   - Log bypass usage

### **Short-Term Actions** (Medium Priority)

4. ✅ **Add JWT-based access tokens**
   - Issue signed tokens on unlock
   - Store in httpOnly cookies
   - Validate on every API request

5. ✅ **Add rate limiting**
   - Prevent abuse of public endpoints
   - Limit requests per IP/user
   - Use Vercel Edge Config or Upstash Redis

6. ✅ **Add audit logging**
   - Log all API requests with unlock status
   - Track bypass attempts
   - Monitor for abuse patterns

### **Long-Term Actions** (Low Priority)

7. ✅ **Implement user accounts**
   - Associate subscriptions with user IDs
   - Track usage per user
   - Enable subscription management

8. ✅ **Add subscription management UI**
   - Allow users to view subscription status
   - Enable cancellation/upgrades
   - Show usage statistics

---

## 10. CONCLUSION

The current PayGate implementation provides **UI-only protection** suitable for **honest users** but offers **zero security** against determined attackers. All premium API endpoints are publicly accessible and can be called directly without any PayGate validation.

**To achieve production-grade security**, the following must be implemented:

1. ✅ Server-side PayGate middleware
2. ✅ Stripe webhook integration
3. ✅ JWT-based access tokens (httpOnly cookies)
4. ✅ Subscription status validation

**Current Risk Level**: **HIGH** (all premium features are publicly accessible)

**Recommended Action**: Implement server-side enforcement before production launch.

---

**End of Security Audit Report**

