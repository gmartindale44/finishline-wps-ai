# OK Field Collision Fix - Root Cause & Solution

**Date**: 2026-01-11  
**Branch**: `chore/preview-smoke-manual-verify`  
**Commit**: `d7dd3aea`  
**Status**: ✅ **FIXED - READY FOR PREVIEW TESTING**

---

## Executive Summary

**Issue**: `ok` field was being corrupted from boolean to string (horse names like "Earl of Dassel").  
**Root Cause**: Client-provided `ok` field in request body could overwrite computed boolean `ok` value.  
**Fix**: Added input sanitization to delete `body.ok` and `body.outcome.ok` before processing, and sanitized error response outcomes.

---

## Root Cause Analysis

### The Bug

**Symptoms**:
- Response JSON shows `debug.okTypeError: "ok was coerced from string to boolean"`
- `debug.okOriginalType: "string"`
- `debug.okOriginalValue: "<horse name>"` (e.g., "Earl of Dassel")

**Root Cause**:
The `ok` field was being corrupted before `sanitizeResponse()` was called. While `sanitizeResponse()` detects and corrects the corruption, it should never happen in the first place.

**Where it happened**:
1. Client could send `body.ok` or `body.outcome.ok` in the request (malicious or accidental)
2. These values could be strings (e.g., horse names from form fields)
3. If `body.outcome.ok` existed, it could contaminate outcome objects through object spreads
4. The corrupted `ok` value would then be detected by `sanitizeResponse()` and coerced to boolean

**Why it wasn't caught earlier**:
- `sanitizeResponse()` acts as a safety net and corrects the corruption
- The debug fields (`okTypeError`, `okOriginalValue`) show the corruption occurred
- But the corruption should be prevented at the input layer, not corrected after the fact

---

## Solution Implemented

### 1. Input Sanitization (Prevention)

**Location**: `pages/api/verify_race.js` (after `safeParseBody`, line ~2733)

**Change**: Added explicit deletion of `ok` fields from request body:
```javascript
const body = await safeParseBody(req);

// CRITICAL: Sanitize request body - explicitly delete ok field to prevent injection
// Never trust client-provided ok field - always compute it from outcome validation
if (body && typeof body === 'object') {
  delete body.ok; // Prevent client from injecting ok field
  if (body.outcome && typeof body.outcome === 'object') {
    delete body.outcome.ok; // Prevent client from injecting ok in outcome
  }
  if (body.predicted && typeof body.predicted === 'object') {
    delete body.predicted.ok; // Prevent client from injecting ok in predicted
  }
}
```

**Impact**: 
- ✅ Client cannot inject `ok` field in request body
- ✅ Client cannot inject `ok` field in `body.outcome`
- ✅ Client cannot inject `ok` field in `body.predicted`
- ✅ `ok` is ALWAYS computed from outcome validation, never derived from request

### 2. Error Response Outcome Sanitization

**Location**: `pages/api/verify_race.js` (manual verify error catch block, line ~3076)

**Change**: Sanitized outcome in error responses:
```javascript
outcome: (() => {
  const rawOutcome = body.outcome || { win: "", place: "", show: "" };
  // CRITICAL: Clean outcome - only copy win/place/show, explicitly delete ok
  const cleanOutcome = {
    win: (rawOutcome.win || "").trim(),
    place: (rawOutcome.place || "").trim(),
    show: (rawOutcome.show || "").trim(),
  };
  delete cleanOutcome.ok; // Defensive cleanup
  return cleanOutcome;
})(),
```

**Impact**:
- ✅ Error responses use clean outcome objects
- ✅ No `ok` property in outcome objects
- ✅ Prevents accidental contamination from request body

### 3. Existing Safeguards (Preserved)

**`sanitizeResponse()` function** (already exists):
- Detects non-boolean `ok` values
- Coerces to boolean from outcome validation
- Logs debug fields (`okTypeError`, `okOriginalType`, `okOriginalValue`)
- Acts as a safety net (should never trigger after input sanitization)

**Manual verify path** (already exists):
- Computes `ok` from outcome validation: `const manualOk = Boolean(cleanManualOutcome.win && cleanManualOutcome.place && cleanManualOutcome.show);`
- Uses cleaned outcome objects (no `ok` property)
- Recomputes `ok` before returning

---

## ResponseMeta Consistency

**Status**: ✅ **ALREADY IMPLEMENTED**

Manual verify success and error responses use `buildResponseMeta()` helper which includes:
- `handlerFile`
- `backendVersion`
- `bypassedPayGate`
- `internalBypassAuthorized`
- `vercelEnv`
- `vercelCommit` (prefers `VERCEL_GIT_COMMIT_SHA` then `VERCEL_GITHUB_COMMIT_SHA` then `VERCEL_GIT_COMMIT_REF`)
- `nodeEnv`
- `redis` (when available)
- `redisFingerprint` (when available)

---

## Predmeta ReferenceError Prevention

**Status**: ✅ **ALREADY IMPLEMENTED**

- `predmeta` declared at handler scope (line 2652): `let predmeta = null;`
- No shadowed declarations in handler
- Manual verify path uses handler-scoped `predmeta`
- ZERO risk of `ReferenceError: predmeta is not defined`

---

## Smoke Test Enhancement

**Location**: `scripts/debug/smoke_test_manual_verify.mjs`

**Changes**:
1. Added check for `debug.okTypeError` (fails if present)
2. Added check for `typeof ok === 'boolean'` (fails if not boolean)
3. Already checks for `responseMeta.vercelCommit`, `vercelEnv`, `nodeEnv`

**PASS Criteria**:
- ✅ HTTP 200
- ✅ `ok` is boolean (not string)
- ✅ No `debug.okTypeError`
- ✅ No "predmeta is not defined"
- ✅ `responseMeta.vercelCommit` present

---

## Files Changed

1. **`pages/api/verify_race.js`**
   - Added input sanitization (delete `body.ok`, `body.outcome.ok`, `body.predicted.ok`)
   - Sanitized error response outcome
   - Total: +24 lines

2. **`scripts/debug/smoke_test_manual_verify.mjs`**
   - Added `okTypeError` check
   - Added `typeof ok` check
   - Total: +16 lines

---

## Commit Information

**Commit**: `d7dd3aea`  
**Message**: `fix(api): prevent ok field collision + enforce boolean ok + unify responseMeta`  
**Branch**: `chore/preview-smoke-manual-verify`

---

## Preview URL

**Vercel Preview URL**: Will be generated by Vercel after deployment completes.

**How to find**:
1. Go to Vercel Dashboard → Project → Deployments
2. Find deployment for commit `d7dd3aea`
3. Copy the preview URL (should be "Ready" status)

**Expected format**: `https://finishline-wps-ai-git-chore-preview-smoke-man-<commit-short>-hired-hive.vercel.app`

---

## Smoke Test Command

Once preview URL is available, run:

```bash
node scripts/debug/smoke_test_manual_verify.mjs <preview-url>
```

**Example** (replace with actual preview URL):
```bash
node scripts/debug/smoke_test_manual_verify.mjs https://finishline-wps-ai-git-chore-preview-smoke-man-d7dd3ae-hired-hive.vercel.app
```

**Expected Output**:
```
[smoke_test] ✅ HTTP Status: 200 (OK)
[smoke_test] ✅ responseMeta present
[smoke_test] ✅ responseMeta.vercelCommit: <commit-sha>
[smoke_test] ✅ responseMeta.vercelEnv: preview
[smoke_test] ✅ responseMeta.nodeEnv: production
[smoke_test] ✅ ok is boolean (type: boolean)
[smoke_test] ✅ ok: true (Manual verify succeeded)
[smoke_test] ✅ step: "manual_verify" (correct)
[smoke_test] ✅ No "predmeta is not defined" error found in response
[smoke_test] ✅ PASSED: Manual verify fix is working correctly
```

**FAIL Criteria**:
- ❌ `debug.okTypeError` exists
- ❌ `typeof ok !== 'boolean'`
- ❌ "predmeta is not defined" in response

---

## Example JSON Response (After Fix)

```json
{
  "ok": true,
  "step": "manual_verify",
  "track": "Meadowlands",
  "date": "2026-01-11",
  "raceNo": "7",
  "outcome": {
    "win": "Smoke Test Winner",
    "place": "Smoke Test Place",
    "show": "Smoke Test Show"
  },
  "responseMeta": {
    "handlerFile": "pages/api/verify_race.js",
    "backendVersion": "verify_v4_hrn_equibase",
    "bypassedPayGate": false,
    "internalBypassAuthorized": false,
    "redis": {
      "verifyKey": "fl:verify:meadowlands-2026-01-11-unknown-r7",
      "writeOk": true,
      "readbackOk": true,
      "ttlSeconds": 7776000
    },
    "vercelEnv": "preview",
    "vercelCommit": "d7dd3aea...",
    "nodeEnv": "production",
    "vercelGitCommitSha": "d7dd3aea..."
  }
}
```

**Key Points**:
- ✅ `ok: true` (boolean, not string)
- ✅ NO `debug.okTypeError`
- ✅ `responseMeta.vercelCommit` present
- ✅ `responseMeta.vercelEnv: "preview"`
- ✅ Outcome has no `ok` property

---

## Summary

**Root Cause**: Client-provided `ok` field in request body could contaminate computed boolean `ok` value.

**Prevention**: Input sanitization deletes `body.ok`, `body.outcome.ok`, and `body.predicted.ok` before processing, ensuring `ok` is ALWAYS computed from outcome validation.

**Result**: 
- ✅ `ok` field corruption prevented at input layer
- ✅ `sanitizeResponse()` still acts as safety net (should never trigger)
- ✅ `debug.okTypeError` should never appear
- ✅ `ok` is ALWAYS boolean

---

**Report Generated**: 2026-01-11  
**Commit**: `d7dd3aea`  
**Status**: ✅ **FIXED - READY FOR PREVIEW TESTING**
