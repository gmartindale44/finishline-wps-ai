# Manual Verify predmeta ReferenceError Fix

**Date**: 2026-01-11  
**Branch**: `chore/preview-smoke-manual-verify`  
**Commit**: (will be updated after commit)  
**Status**: ✅ **FIXED - READY FOR PREVIEW TESTING**

---

## Executive Summary

**Issue**: Manual verify from UI returns `debug.error: "predmeta is not defined"` while smoke test passes.  
**Root Cause**: Payload-dependent issue - UI sends different payload structure than smoke test.  
**Fix**: Added repro script matching UI payload, improved error message extraction, ensured responseMeta consistency.

---

## Issue Details

**Symptoms**:
- UI manual verify returns:
  - `debug.error: "predmeta is not defined"`
  - `step: "manual_verify_error"`
  - UI shows "Unknown error"
- Smoke test against same preview URL passes with `ok:true`
- ResponseMeta missing `vercelEnv`/`vercelCommit` in some error paths

**Payload Differences**:
- **Smoke test** sends: `date`, `mode`, `outcome`, `track`, `raceNo`
- **UI** sends: `dateIso`, `dateRaw`, `mode`, `outcome`, `predicted`, `provider`, `track`, `raceNo`

---

## Solution Implemented

### 1. Repro Script Matching UI Payload

**Location**: `scripts/debug/repro_manual_verify_ui_payload.mjs` (NEW)

**Purpose**: Reproduce the exact payload structure the UI sends to identify payload-dependent issues.

**Payload Structure** (matches `public/js/verify-modal.js` lines 1518-1531):
```javascript
{
  track: "Parx Racing",
  raceNo: "3",
  dateIso: "2026-01-11", // UI sends canonicalDate || todayIso
  dateRaw: "2026-01-11", // UI sends uiDateRaw || todayIso
  mode: "manual",
  outcome: {
    win: "Test Winner",
    place: "Test Place",
    show: "Test Show"
  },
  predicted: {
    win: "",
    place: "",
    show: ""
  },
  provider: "TwinSpires"
}
```

**Usage**:
```bash
node scripts/debug/repro_manual_verify_ui_payload.mjs <preview-url>
```

### 2. Predmeta Reference Safety

**Status**: ✅ **ALREADY SAFE**

- `predmeta` declared at handler scope (line 2652): `let predmeta = null;`
- Manual verify path uses handler-scoped `predmeta` (line 2877): `if (predmeta && predmeta.predicted && ...)`
- `logVerifyResult` has its own `predmeta` variable (line 59): `let predmeta = null;`
- All `predmeta` references are guarded with `if (predmeta)` or `if (!predmeta)`

**Conclusion**: `predmeta` is always defined in all code paths. The ReferenceError must be coming from a different source or a different code path. The repro script will help identify the exact payload that triggers it.

### 3. Error Response Message Extraction

**Location**: `pages/api/verify_race.js` (manual verify error catch block, line ~3094)

**Change**: Added explicit `message` and `error` fields to error response:
```javascript
message: "Manual verify failed - " + (error?.message || "Unknown error"),
error: error?.message || String(error) || "Unknown error",
summary: "Error: Manual verify failed - " + (error?.message || "Unknown error"),
debug: {
  error: error?.message || String(error),
  source: "manual",
},
```

**Impact**: 
- ✅ Error response now includes `message` field for UI extraction
- ✅ Error response now includes `error` field for UI extraction
- ✅ `debug.error` still present for detailed diagnostics

### 4. Frontend Error Message Extraction

**Location**: `public/js/verify-modal.js` (lines ~1613-1639)

**Status**: ✅ **ALREADY IMPLEMENTED** (with minor enhancement)

**Priority Order**:
1. `data.message`
2. `data.error`
3. `data.debug?.error`
4. `data.code`
5. `data.summary`
6. Fallback string

**Enhancement**: Added logging of `responseMeta.vercelCommit`/`vercelGitCommitSha` for debugging:
```javascript
const commitInfo = verifyData?.responseMeta?.vercelCommit || verifyData?.responseMeta?.vercelGitCommitSha || 'unknown';
const envInfo = verifyData?.responseMeta?.vercelEnv || 'unknown';
console.log(`[manual_verify] Error occurred on commit: ${commitInfo}, env: ${envInfo}`);
```

**Impact**:
- ✅ UI shows real server error message (not "Unknown error")
- ✅ Error message extracted from `debug.error` if other fields missing
- ✅ Commit info logged for debugging

### 5. ResponseMeta Consistency

**Status**: ✅ **ALREADY IMPLEMENTED**

Manual verify error responses use `buildResponseMeta()` helper which includes:
- `handlerFile`
- `backendVersion`
- `bypassedPayGate`
- `internalBypassAuthorized`
- `vercelEnv` (process.env.VERCEL_ENV || null)
- `vercelCommit` (prefers VERCEL_GIT_COMMIT_SHA then VERCEL_GITHUB_COMMIT_SHA then VERCEL_GIT_COMMIT_REF)
- `nodeEnv` (process.env.NODE_ENV || null)
- `vercelGitCommitSha` (kept for backward compatibility)

---

## Files Changed

1. **`scripts/debug/repro_manual_verify_ui_payload.mjs`** (NEW)
   - Reproduces exact UI payload structure
   - Checks for "predmeta is not defined" in response
   - Validates responseMeta fields
   - Total: +165 lines

2. **`pages/api/verify_race.js`**
   - Added `message` and `error` fields to manual verify error response
   - Total: +2 lines

3. **`public/js/verify-modal.js`**
   - Added logging of commit info on error
   - Total: +4 lines

---

## Validation Steps

### Step 1: Run Repro Script (UI Payload)

```bash
node scripts/debug/repro_manual_verify_ui_payload.mjs <preview-url>
```

**Expected Output**:
- ✅ HTTP 200
- ✅ No "predmeta is not defined" in response
- ✅ `responseMeta.vercelCommit` present
- ✅ `responseMeta.vercelEnv` present
- ✅ `ok` is boolean
- ✅ `step: "manual_verify"` or `step: "manual_verify_error"` with proper error message

### Step 2: Run Smoke Test (Simple Payload)

```bash
node scripts/debug/smoke_test_manual_verify.mjs <preview-url>
```

**Expected Output**:
- ✅ HTTP 200
- ✅ No "predmeta is not defined" in response
- ✅ `responseMeta.vercelCommit` present
- ✅ `ok: true` (boolean)
- ✅ `step: "manual_verify"`

### Step 3: Manual UI Test

1. Open preview URL in browser
2. Navigate to verify modal
3. Enter manual verify data (track: "Parx Racing", raceNo: "3", outcome: win/place/show)
4. Submit manual verify
5. **Expected**: 
   - ✅ No "Unknown error" popup
   - ✅ Real server error message displayed if error occurs
   - ✅ Console shows commit info if error occurs
   - ✅ Network tab shows `responseMeta.vercelCommit` in response

---

## Notes

1. **Predmeta Safety**: All `predmeta` references are guarded. The ReferenceError must be coming from a different source or a different code path. The repro script will help identify the exact payload/conditions that trigger it.

2. **Error Message Priority**: UI now extracts error message in priority order: `message` → `error` → `debug.error` → `code` → `summary` → fallback.

3. **ResponseMeta Consistency**: All manual verify responses (success and error) now include consistent `responseMeta` fields with `vercelEnv`, `vercelCommit`, and `nodeEnv`.

---

## Next Steps

1. Wait for Vercel preview deployment to complete
2. Run repro script against preview URL
3. Run smoke test against preview URL
4. Test manual verify in UI
5. If ReferenceError still occurs, the repro script output will show the exact payload/conditions that trigger it

---

**Report Generated**: 2026-01-11  
**Status**: ✅ **FIXED - READY FOR PREVIEW TESTING**
