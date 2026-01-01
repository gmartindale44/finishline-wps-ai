# Safety Verification - PayGate Routing Fix

## Changes Made - Safety Compliance Check

### ✅ VERIFY_RACE.JS - SAFE CHANGES ONLY

**File:** `pages/api/verify_race.js`
**Change:** Added debug header to stub response (line 1704)

```javascript
// BEFORE:
return res.status(200).json({
  ...stub,
  ok: false,
  step: "verify_race_stub",
  error: "METHOD_NOT_ALLOWED",
  message: `Expected POST, received ${req.method}`,
  summary: `Verify Race stub: method ${req.method} is not supported.`,
});

// AFTER:
res.setHeader('X-Handler-Identity', 'VERIFY_RACE_STUB');  // ← ONLY ADDITION
return res.status(200).json({
  ...stub,
  ok: false,
  step: "verify_race_stub",
  error: "METHOD_NOT_ALLOWED",
  message: `Expected POST, received ${req.method}`,
  summary: `Verify Race stub: method ${req.method} is not supported.`,
});
```

**Safety Analysis:**
- ✅ Header-only change (does not affect JSON response body)
- ✅ Does not change POST behavior (header added only in non-POST stub path)
- ✅ Does not change request schema validation
- ✅ Does not change response format
- ✅ Does not remove stub logic
- ✅ Does not refactor or simplify code
- ✅ Does not move or merge handlers

**Impact:** DEBUG-ONLY header for tracing. Zero functional impact.

### ✅ PAYGATE HANDLERS - ISOLATION CHANGES ONLY

**Files Changed:**
- `pages/api/paygate-token.js` - Added cache headers, identity header
- `pages/api/debug-paygate.js` - Added cache headers, identity header, handler field

**Safety Analysis:**
- ✅ Zero coupling to verify_race (no imports, no shared code)
- ✅ Isolated handlers with their own identity headers
- ✅ No changes to verify_race.js POST path
- ✅ No changes to verify_race.js stub logic (except debug header)

### ✅ ROOT /API DUPLICATES - REMOVED

**Files Deleted:**
- `api/paygate-token.js` - Removed duplicate (routing conflict source)
- `api/debug-paygate.js` - Removed duplicate (routing conflict source)

**Safety Analysis:**
- ✅ Only removed duplicates of paygate handlers
- ✅ Did NOT touch `api/verify_race.js` (kept as-is for compatibility)
- ✅ Did NOT touch `pages/api/verify_race.js` logic

## Compliance Checklist

### ✅ Rule 1: DO NOT delete/rewrite/refactor verify_race
- Status: COMPLIANT
- Action: Only added debug header, no logic changes

### ✅ Rule 2: DO NOT change verify_race POST behavior
- Status: COMPLIANT
- Action: POST path untouched, header only added to non-POST stub

### ✅ Rule 3: DO NOT remove stub logic
- Status: COMPLIANT
- Action: Stub logic preserved, only header added

### ✅ Rule 4: DO NOT simplify/optimize verify_race
- Status: COMPLIANT
- Action: No code simplification or optimization

### ✅ Rule 5: DO NOT move/merge verify_race
- Status: COMPLIANT
- Action: File remains in `pages/api/verify_race.js`

## Required Verification Commands

### 1. Verify verify_race POST Still Works

```bash
curl -X POST https://<PREVIEW-URL>/api/verify_race \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-12-31","track":"Turfway Park","raceNo":"8"}'
```

**Expected:**
- Status: `200 OK`
- Response: JSON with verify result (not stub)
- No changes from previous behavior

### 2. Verify verify_race GET Returns Stub (Unchanged Behavior)

```bash
curl -i https://<PREVIEW-URL>/api/verify_race
```

**Expected:**
- Status: `200 OK`
- Header: `X-Handler-Identity: VERIFY_RACE_STUB` (NEW - debug only)
- Response: JSON with `step: "verify_race_stub"`, `error: "METHOD_NOT_ALLOWED"`
- Behavior: Identical to before (only header added)

### 3. Verify Paygate Routes Correctly

```bash
# Should return JavaScript, NOT verify_race_stub
curl -i https://<PREVIEW-URL>/api/paygate-token?cb=123

# Should return JSON with ok:true, NOT verify_race_stub
curl -i https://<PREVIEW-URL>/api/debug-paygate?cb=123
```

**Expected:**
- Status: `200 OK`
- Header: `X-Handler-Identity: PAYGATE_TOKEN_OK` or `DEBUG_PAYGATE_OK`
- Body: Does NOT contain `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile pages/api/verify_race.js`

## Summary

**All changes are SAFE and COMPLIANT with critical safety rules:**
- ✅ verify_race.js: Header-only change (debug tracing)
- ✅ Paygate handlers: Isolated changes (no verify_race coupling)
- ✅ Root /api duplicates: Removed (routing conflict resolution)
- ✅ verify_race POST behavior: UNCHANGED
- ✅ verify_race stub logic: PRESERVED (header added only)
- ✅ Production workflows: UNAFFECTED

