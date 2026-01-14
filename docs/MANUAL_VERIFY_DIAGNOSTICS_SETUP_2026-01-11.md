# Manual Verify Diagnostics Setup - Stack Trace Capture

**Date**: 2026-01-11  
**Branch**: `chore/preview-smoke-manual-verify`  
**Commit**: (will be updated after commit)  
**Status**: ✅ **DIAGNOSTICS READY - AWAITING STACK TRACE**

---

## Executive Summary

**Goal**: Capture the actual stack trace for the "predmeta is not defined" ReferenceError so we can fix the exact offending line.

**Changes Made**:
1. ✅ `buildStamp` now uses 7-char SHA (matches Vercel UI display)
2. ✅ Full error diagnostics in response (`debug.name`, `debug.stack`, `debug.catcher`)
3. ✅ Server-side console.error logging with stack trace
4. ✅ Regression test script to detect predmeta ReferenceError

---

## Changes Implemented

### 1. buildStamp Uses 7-Char SHA

**Location**: `pages/api/verify_race.js` (`buildResponseMeta` helper)

**Format**: `${vercelEnv || "unknown"}-${commitShort7}`

**Example**: `preview-ffdd8bf` (matches Vercel UI display)

### 2. Full Error Diagnostics

**Location**: `pages/api/verify_race.js` (manual verify catch block)

**Response includes**:
```javascript
debug: {
  error: error?.message || String(error),
  name: error?.name || "UnknownError",
  stack: error?.stack || null, // Full stack trace
  source: "manual",
  catcher: "manual_verify_catch_v2", // Fingerprint to identify catch block
}
```

### 3. Server-Side Error Logging

**Location**: `pages/api/verify_race.js` (manual verify catch block)

**Logs to Vercel runtime logs**:
```javascript
console.error("[manual_verify_error]", {
  name: error?.name,
  message: error?.message,
  stack: error?.stack,
});
```

### 4. Regression Test Script

**Location**: `scripts/debug/test_manual_verify_no_predmeta_error.mjs` (NEW)

**Checks**:
- ✅ HTTP 200
- ✅ `ok` is boolean
- ✅ `responseMeta.buildStamp` exists
- ✅ NO "predmeta is not defined" in response
- ✅ Fails with exit code 1 if predmeta ReferenceError detected

**Usage**:
```bash
node scripts/debug/test_manual_verify_no_predmeta_error.mjs <preview-url>
```

---

## Next Steps (User Action Required)

### Step 1: Confirm Latest Deployment

1. Open Vercel dashboard → Project → Deployments
2. Find deployment for commit `ffdd8bf7` (or latest)
3. Open preview URL
4. Perform manual verify in UI
5. In DevTools Network → `verify_race` → Response:
   - ✅ Confirm `responseMeta.buildStamp` exists (format: `preview-ffdd8bf`)
   - ✅ Confirm `responseMeta.vercelCommit` matches commit SHA
   - ✅ Confirm `debug.stack` exists (or is null)

### Step 2: Check Vercel Runtime Logs

1. Open Vercel dashboard → Project → Functions → `api/verify_race`
2. View runtime logs
3. Look for `[manual_verify_error]` log entry
4. Copy the stack trace

### Step 3: Identify Offending Line

The stack trace will show:
- File name
- Line number
- Function name
- Call stack

Example stack trace format:
```
ReferenceError: predmeta is not defined
    at handler (/var/task/pages/api/verify_race.js:XXXX:XX)
    at async .../node_modules/next/...
```

### Step 4: Fix the Exact Line

Once we have the stack trace, we'll fix the exact line where `predmeta` is referenced without being declared.

---

## Verification Commands

### Test with Repro Script:
```bash
node scripts/debug/repro_manual_verify_ui_payload.mjs <preview-url>
```

### Test with Regression Test:
```bash
node scripts/debug/test_manual_verify_no_predmeta_error.mjs <preview-url>
```

### Expected Output (Success):
```
[regression_test] ✅ HTTP Status: 200
[regression_test] ✅ ok is boolean: true
[regression_test] ✅ responseMeta.buildStamp: preview-ffdd8bf
[regression_test] ✅ No "predmeta is not defined" error found
[regression_test] ✅ PASSED: No predmeta ReferenceError detected
```

### Expected Output (Failure - predmeta ReferenceError):
```
[regression_test] ❌ FAILED: Response contains "predmeta is not defined"
[regression_test] Error details:
[regression_test]   debug.error: predmeta is not defined
[regression_test]   debug.name: ReferenceError
[regression_test]   debug.stack (first 500 chars):
[regression_test] ReferenceError: predmeta is not defined
    at handler (/var/task/pages/api/verify_race.js:XXXX:XX)
    ...
```

---

## Status

✅ **DIAGNOSTICS READY**: All error diagnostics in place  
⏳ **AWAITING STACK TRACE**: Need stack trace from UI test to identify exact offending line  
🔧 **FIX PENDING**: Will fix once stack trace reveals exact location

---

**Report Generated**: 2026-01-11  
**Commit**: (will be updated after commit)  
**Status**: ✅ **DIAGNOSTICS READY - AWAITING STACK TRACE**
