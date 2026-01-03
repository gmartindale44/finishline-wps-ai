# PayGate Route Diagnosis Report

## 1. Router Type Identification

### ✅ VERDICT: Next.js Pages Router Only

**Evidence:**
- ✅ `/pages` directory exists with API routes
- ❌ `/app` directory does NOT exist
- ✅ Next.js version: `14.2.0` (from package.json)
- ✅ Uses `pages/api/*.js` pattern for API routes

**Next.js Version:**
```json
"next": "^14.2.0"
```

**Router Type:** Pages Router (not App Router)

---

## 2. API Routes Structure

### `/pages/api` Directory Contents:

```
pages/api/
├── _debug-paygate.js          ✅ EXISTS
├── audit_dataset.js
├── calibration_status.js
├── calibration_verify_v1.js
├── cse_resolver.js
├── export_reconciliations.js
├── family-unlock.js           ✅ EXISTS
├── green_zone.ts
├── greenzone_today.js
├── gz_upcoming.js
├── paygate-token.js           ✅ EXISTS
├── tracks.js
├── verify_backfill.js
└── verify_race.js
```

### Expected Endpoints:
- ✅ `/api/paygate-token` → `pages/api/paygate-token.js` (EXISTS)
- ✅ `/api/_debug-paygate` → `pages/api/_debug-paygate.js` (EXISTS)
- ✅ `/api/family-unlock` → `pages/api/family-unlock.js` (EXISTS)

---

## 3. Paygate-Related Code Locations

### Search Results:

#### "paygate-token"
- `pages/api/paygate-token.js` - Route handler (EXISTS)
- `public/js/paygate-helper.js:6` - Comment reference
- `public/index.html:131` - Script tag: `<script src="/api/paygate-token"></script>`
- `PAYGATE-RESTORE-SUMMARY.md` - Documentation

#### "_debug-paygate"
- `pages/api/_debug-paygate.js` - Route handler (EXISTS)
- `PAYGATE-RESTORE-SUMMARY.md` - Documentation

#### "PayGate" / "paygate"
- `public/js/paygate-helper.js` - Main paygate logic (318 lines)
- `public/js/results-panel.js` - UI gating based on paygate
- `public/index.html:131-132` - Script loading order

#### "fl:paygate:access"
- `public/js/paygate-helper.js:15` - Storage key constant
- Used throughout for localStorage access control

#### "tokenVersion"
- `pages/api/paygate-token.js:20-23` - Computes tokenVersion
- `pages/api/family-unlock.js:50` - Returns tokenVersion
- `pages/_document.js:7-9` - Injects tokenVersion
- `public/js/paygate-helper.js` - Multiple references for rotation checks

#### "family-unlock"
- `pages/api/family-unlock.js` - Server-side validation endpoint (EXISTS)
- `public/js/paygate-helper.js:162-204` - Client-side fetch to `/api/family-unlock`

#### "plan=family"
- `public/js/paygate-helper.js:242-244` - URL param handling (180 days)
- `FAMILY-PLAN-URL-UNLOCK.md` - Documentation

#### "paid=1"
- `public/js/paygate-helper.js:236` - URL param handling
- Supports: `?paid=1&plan=day|core|family`

#### "fail-closed"
- `public/js/paygate-helper.js:2` - Design principle comment
- `public/js/paygate-helper.js:22,26,44,47,90,111,113` - Multiple fail-closed checks
- `public/js/results-panel.js:9,11,145,150,997,1002` - Fail-closed behavior

---

## 4. API Route Files (Full Contents)

### ✅ `/api/paygate-token` - EXISTS

**File:** `pages/api/paygate-token.js`

```javascript
// pages/api/paygate-token.js
// Returns a JavaScript file that sets the family unlock token from env var
// This works for static HTML files that can't use Next.js _document.js

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Set content type to JavaScript
  res.setHeader('Content-Type', 'application/javascript');
  
  // Get token from environment variable
  const token = process.env.FAMILY_UNLOCK_TOKEN || null;
  
  // Get configurable family unlock duration (default 365 days)
  const familyUnlockDays = parseInt(process.env.FAMILY_UNLOCK_DAYS || '365', 10);
  
  // Compute token version (first 12 chars of SHA-256 hash, safe to expose)
  let tokenVersion = null;
  if (token) {
    tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  }
  
  // Return JavaScript that sets window variables (DO NOT expose raw token)
  // Only expose tokenVersion (safe hash) and familyUnlockDays
  const js = `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = ${JSON.stringify(tokenVersion)};
window.__FL_FAMILY_UNLOCK_DAYS__ = ${familyUnlockDays};
console.log('[PayGate] Token script loaded:', { hasTokenVersion: ${tokenVersion !== null}, familyUnlockDays: ${familyUnlockDays} });`;
  
  // Cache for 5 minutes (token changes require redeploy anyway)
  res.setHeader('Cache-Control', 'public, max-age=300');
  
  res.status(200).send(js);
}
```

**Expected Route:** `/api/paygate-token` (GET)
**Response:** JavaScript code (Content-Type: application/javascript)

---

### ✅ `/api/_debug-paygate` - EXISTS

**File:** `pages/api/_debug-paygate.js`

```javascript
// pages/api/_debug-paygate.js
// Debug endpoint to verify paygate token configuration

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  try {
    const token = process.env.FAMILY_UNLOCK_TOKEN || null;
    let tokenVersion = null;
    if (token) {
      tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
    }
    
    const familyUnlockDays = parseInt(process.env.FAMILY_UNLOCK_DAYS || '365', 10);
    
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      hasToken: token !== null,
      hasVersion: tokenVersion !== null,
      tokenVersionLength: tokenVersion ? tokenVersion.length : 0,
      familyUnlockDays,
      apiRouteWorking: true
    });
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      hasToken: false,
      hasVersion: false,
      error: err.message,
      apiRouteWorking: false
    });
  }
}
```

**Expected Route:** `/api/_debug-paygate` (GET)
**Response:** JSON (Content-Type: application/json)

---

### ✅ `/api/family-unlock` - EXISTS

**File:** `pages/api/family-unlock.js`

**Expected Route:** `/api/family-unlock` (POST)
**Response:** JSON (Content-Type: application/json)
**Purpose:** Server-side token validation with timing-safe comparison

---

## 5. Next.js Configuration

### `next.config.cjs`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable API routes (this is the default, but explicit for clarity)
  // Do NOT use output: 'export' as that disables API routes
};

module.exports = nextConfig;
```

**Analysis:**
- ✅ No `output: 'export'` (API routes enabled)
- ✅ No rewrites/redirects that would interfere with `/api/*`
- ✅ Default Next.js behavior (API routes should work)

---

## 6. Vercel Configuration

### `vercel.json`
**Status:** ❌ FILE DOES NOT EXIST

No `vercel.json` found in repo root. This is GOOD - means no custom routing that could interfere.

---

## 7. Package.json Scripts & Dependencies

### Scripts:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start"
}
```

### Dependencies:
```json
{
  "next": "^14.2.0",
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "@upstash/redis": "^1.28.2",
  "cheerio": "^1.0.0-rc.12",
  "formidable": "^3.5.3",
  "openai": "^4.0.0"
}
```

**Note:** `"type": "module"` - ESM mode enabled

---

## 8. File Tree Structure

### `/pages` Directory:
```
pages/
├── _app.js
├── _document.js
├── api/
│   ├── _debug-paygate.js      ✅
│   ├── audit_dataset.js
│   ├── calibration_status.js
│   ├── calibration_verify_v1.js
│   ├── cse_resolver.js
│   ├── export_reconciliations.js
│   ├── family-unlock.js        ✅
│   ├── green_zone.ts
│   ├── greenzone_today.js
│   ├── gz_upcoming.js
│   ├── paygate-token.js        ✅
│   ├── tracks.js
│   ├── verify_backfill.js
│   └── verify_race.js
├── lab.tsx
└── verify.tsx
```

### `/app` Directory:
**Status:** ❌ DOES NOT EXIST

### `/public/js` Directory (Paygate-Related):
```
public/js/
├── paygate-helper.js          ✅ Main paygate logic
└── results-panel.js           ✅ UI gating
```

---

## 9. Why 404 Might Occur

### Possible Causes:

1. **Build/Deployment Issue:**
   - Next.js might not be building API routes correctly
   - Vercel might be using static export mode
   - Check `.vercelignore` for excluded files

2. **Runtime Configuration:**
   - API routes require `export const config = { runtime: 'nodejs' }` ✅ (present)
   - ESM mode compatibility ✅ (using `import/export`)

3. **Path Resolution:**
   - Next.js Pages Router maps `pages/api/paygate-token.js` → `/api/paygate-token` ✅
   - No conflicting routes in root `/api` directory

4. **Vercel-Specific:**
   - Check if Vercel is detecting Next.js correctly
   - Verify build output includes API routes
   - Check Vercel function logs for errors

---

## 10. Local Testing (If Possible)

### Expected Next.js Routing:

**File:** `pages/api/paygate-token.js`
**Route:** `/api/paygate-token` (GET)
**Handler:** `export default function handler(req, res)`

**File:** `pages/api/_debug-paygate.js`
**Route:** `/api/_debug-paygate` (GET)
**Handler:** `export default function handler(req, res)`

**File:** `pages/api/family-unlock.js`
**Route:** `/api/family-unlock` (POST)
**Handler:** `export default async function handler(req, res)`

### To Test Locally:
```bash
npm run dev
# Then test:
curl -i http://localhost:3000/api/paygate-token
curl -i http://localhost:3000/api/_debug-paygate
curl -X POST http://localhost:3000/api/family-unlock -H "Content-Type: application/json" -d '{"token":"test"}'
```

---

## 11. Summary & Recommendations

### ✅ Routes EXIST:
- `/api/paygate-token` → `pages/api/paygate-token.js` ✅
- `/api/_debug-paygate` → `pages/api/_debug-paygate.js` ✅
- `/api/family-unlock` → `pages/api/family-unlock.js` ✅

### ✅ Configuration CORRECT:
- Next.js Pages Router ✅
- No `output: 'export'` ✅
- No conflicting rewrites ✅
- Runtime config present ✅

### 🔍 Debugging Steps:

1. **Check Vercel Build Logs:**
   - Verify API routes are included in build
   - Check for build errors

2. **Verify Vercel Project Settings:**
   - Framework: Next.js
   - Build Command: `next build`
   - Output Directory: `.next`

3. **Check `.vercelignore`:**
   - ✅ `.vercelignore` exists and explicitly states: "pages/api/ (Next.js API routes)" should NOT be ignored
   - ✅ No patterns that would exclude `pages/api/*.js` files

4. **Test Locally:**
   - Run `npm run dev`
   - Test endpoints directly
   - Verify they work before deployment

5. **Vercel Function Logs:**
   - Check function invocation logs
   - Look for runtime errors

### 🎯 Expected Behavior:

- `/api/paygate-token` should return JavaScript (200 OK)
- `/api/_debug-paygate` should return JSON (200 OK)
- `/api/family-unlock` should return JSON (200 OK for POST, 405 for GET)

**If 404 persists, the issue is likely:**
- Vercel deployment configuration
- Build process not including API routes
- Framework detection issue

---

## 12. Family Pass System Status

### ✅ Implementation Complete:

1. **Token Version System:**
   - `pages/api/paygate-token.js` returns `tokenVersion` (not raw token)
   - `pages/_document.js` injects `tokenVersion` for SSR pages
   - Client checks `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`

2. **Server-Side Validation:**
   - `pages/api/family-unlock.js` validates tokens server-side
   - Uses timing-safe comparison
   - Returns `tokenVersion` on success

3. **Client-Side Storage:**
   - localStorage key: `fl:paygate:access`
   - Stores: `{ plan: "family", expiry, tokenVersion }`
   - Rotation check: compares stored vs current `tokenVersion`

4. **URL Unlock Support:**
   - `?paid=1&plan=family` unlocks for 180 days
   - `?family=1&token=XXX` validates via server endpoint
   - Both paths supported

5. **Fail-Closed Design:**
   - Premium hidden by default
   - Errors default to locked
   - Token rotation revokes access automatically

---

**Report Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Branch:** `hotfix/restore-paygate-lkg`
**Status:** All routes exist, configuration correct, 404 likely deployment/build issue

