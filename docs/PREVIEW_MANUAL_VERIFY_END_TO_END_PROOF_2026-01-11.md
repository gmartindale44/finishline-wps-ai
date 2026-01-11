# Preview Manual Verify End-to-End Proof Report

**Date:** 2026-01-11  
**Branch:** `chore/preview-smoke-manual-verify`  
**Goal:** Confirm manual verify works end-to-end and writes logs to Upstash  
**Status:** 🔄 **IN PROGRESS** - Awaiting preview URL and test execution

---

## EXECUTIVE SUMMARY

**Objective:**
1. Confirm manual verify works end-to-end (no "predmeta is not defined" error)
2. Confirm verify logs are written to Upstash for races Geoff runs today
3. Confirm verify_race automated path still works and writes logs
4. Produce proof report with real key names, timestamps, TTL

**Constraints:**
- Preview-only (no production changes)
- No PRs (work on branch, push for Vercel preview)
- Do not merge to master yet

**Current Status:**
- ✅ Test branch created: `chore/preview-smoke-manual-verify`
- ✅ Smoke test suite created: `scripts/debug/smoke_verify_suite.mjs`
- ✅ Scan script updated: `scripts/debug/scan_recent_verify_keys.mjs`
- ✅ Branch pushed to origin
- 🔄 **Awaiting:** Vercel preview URL, test execution, scan results

---

## A. CURRENT STATE / BASELINE

### Preview URL

**Status:** 🔄 **AWAITING VERCEL DEPLOYMENT**

**Branch:** `chore/preview-smoke-manual-verify`

**Estimated Preview URL (based on Vercel naming pattern):**
```
https://finishline-wps-ai-git-chore-preview-smoke-manual-verify-hired-hive.vercel.app
```

**To Find Actual Preview URL:**
1. Check Vercel Dashboard: https://vercel.com/hired-hive/finishline-wps-ai
2. Look for deployment for branch `chore/preview-smoke-manual-verify`
3. Copy the preview URL from the deployment details

**Actual Preview URL (to be filled):**
```
[TO BE FILLED AFTER VERCEL DEPLOYMENT]
```

### PAYGATE_SERVER_ENFORCE Status

**Expected:** `PAYGATE_SERVER_ENFORCE=false` (PayGate should not block API calls in preview)

**Verification Method:**
- Check API response for PayGate blocking
- If `error: "PayGate locked"` in response, PayGate is enforcing (unexpected)
- If API calls succeed without authentication, PayGate is not enforcing (expected)

**Actual Status (to be filled after test):**
```
[TO BE FILLED AFTER TEST EXECUTION]
```

---

## B. TEST BRANCH AND SCRIPTS

### Branch Created

**Branch:** `chore/preview-smoke-manual-verify`  
**Commit:** [Latest commit SHA]  
**Remote:** `origin/chore/preview-smoke-manual-verify`

**Files Added/Modified:**
- `scripts/debug/smoke_verify_suite.mjs` (NEW)
- `scripts/debug/scan_recent_verify_keys.mjs` (UPDATED)

### Smoke Test Suite

**Script:** `scripts/debug/smoke_verify_suite.mjs`

**Features:**
- Tests manual verify mode (POST /api/verify_race with mode: "manual")
- Tests auto verify mode (POST /api/verify_race without mode)
- After each API call, scans Redis to confirm verify key exists
- Prints: ok, step, raceId, verifyKey, created_at_ms, ttl, confidence_pct/t3m_pct
- Saves results to `temp_smoke_verify_results.json`

**Usage:**
```bash
node scripts/debug/smoke_verify_suite.mjs <preview-url>
```

### Scan Script

**Script:** `scripts/debug/scan_recent_verify_keys.mjs`

**Features:**
- Scans Upstash for verify keys matching track/date patterns
- Supports multiple fallback patterns for track name matching
- Outputs: key name, ok, step, track, raceNo, created_at_ms, ttl, outcome/predicted summary
- Saves results to `temp_recent_verify_keys.json`

**Usage:**
```bash
node scripts/debug/scan_recent_verify_keys.mjs 2026-01-11 meadowlands "charles town"
```

---

## C. GEOFF'S RACES VERIFICATION

### Scan Configuration

**Date:** 2026-01-11  
**Tracks:** Meadowlands, Charles Town

**Patterns Scanned:**
1. Exact match: `fl:verify:meadowlands-2026-01-11*`
2. Exact match: `fl:verify:charles-town-2026-01-11*`
3. Fallback: `fl:verify:*meadowlands*2026-01-11*`
4. Fallback: `fl:verify:*charles-town*2026-01-11*`
5. Fallback: `fl:verify:*2026-01-11*meadow*`
6. Fallback: `fl:verify:*2026-01-11*charles*`

### Scan Results

**Status:** 🔄 **PENDING TEST EXECUTION**

**Expected Results:**
- Verify keys for Geoff's races (1 Meadowlands, 4 Charles Town) if they were run today
- Keys should have `ok: true`, `step: "manual_verify"`, correct date (2026-01-11)
- TTL should be ~90 days (7776000 seconds)

**Actual Results (to be filled):**
```
[TO BE FILLED AFTER SCAN EXECUTION]
```

---

## D. TEST EXECUTION

### Manual Verify Test

**Status:** 🔄 **PENDING PREVIEW URL**

**Test Configuration:**
- Mode: `manual`
- Track: `Meadowlands`
- Date: `2026-01-11`
- Race No: `8`
- Outcome: `{ win: "Smoke Test Winner", place: "Smoke Test Place", show: "Smoke Test Show" }`

**Expected Results:**
- ✅ HTTP 200
- ✅ `ok: true`
- ✅ `step: "manual_verify"`
- ✅ No `error: "predmeta is not defined"` in response
- ✅ Verify key exists in Redis: `fl:verify:meadowlands-2026-01-11-unknown-r8`
- ✅ Key has `ok: true`, `step: "manual_verify"`, correct date/raceNo
- ✅ TTL ~90 days

**Actual Results (to be filled):**
```
[TO BE FILLED AFTER TEST EXECUTION]
```

### Auto Verify Test

**Status:** 🔄 **PENDING PREVIEW URL**

**Test Configuration:**
- Mode: (omitted - triggers auto verify)
- Track: `Charles Town`
- Date: `2026-01-03`
- Race No: `1`

**Expected Results:**
- ✅ HTTP 200 (even if HRN blocks with 403, response should be 200 JSON)
- ✅ Response is valid JSON (not crash)
- ✅ Verify key may or may not exist (depending on HRN blocking)
- ✅ If key exists, should have correct track/date/raceNo

**Actual Results (to be filled):**
```
[TO BE FILLED AFTER TEST EXECUTION]
```

### Scan Results (After Tests)

**Status:** 🔄 **PENDING TEST EXECUTION**

**Command:**
```bash
node scripts/debug/scan_recent_verify_keys.mjs 2026-01-11 meadowlands "charles town"
```

**Expected Results:**
- At least 1 verify key from smoke test (manual verify)
- Verify keys for Geoff's races (if run today)

**Actual Results (to be filled):**
```
[TO BE FILLED AFTER SCAN EXECUTION]
```

---

## E. EVIDENCE AND PROOF

### Verify Keys Found

**Status:** 🔄 **PENDING TEST EXECUTION**

**Keys from Smoke Test (to be filled):**
```
[TO BE FILLED]
```

**Keys from Geoff's Races (to be filled):**
```
[TO BE FILLED]
```

### Key Details

**Status:** 🔄 **PENDING TEST EXECUTION**

For each key found, document:
- Key name (full Redis key)
- `ok` field value
- `step` field value
- `track`, `date`, `raceNo` fields
- `created_at_ms` or `ts` timestamp
- TTL (seconds and days/hours)
- `confidence_pct` (if present)
- `t3m_pct` (if present)
- Outcome summary (win/place/show)
- Predicted summary (if present)

**Actual Details (to be filled):**
```
[TO BE FILLED AFTER SCAN EXECUTION]
```

### API Response Evidence

**Status:** 🔄 **PENDING TEST EXECUTION**

**Manual Verify Response (to be filled):**
```json
[TO BE FILLED - Redact any secrets]
```

**Auto Verify Response (to be filled):**
```json
[TO BE FILLED - Redact any secrets]
```

---

## F. DIAGNOSIS AND FIXES (IF NEEDED)

### Issues Found

**Status:** 🔄 **PENDING TEST EXECUTION**

**Issues (to be filled if any):**
```
[TO BE FILLED IF ISSUES FOUND]
```

### Proposed Fixes

**Status:** 🔄 **PENDING DIAGNOSIS**

**Fixes (to be filled if needed):**
```
[TO BE FILLED IF FIXES NEEDED]
```

---

## G. GO/NO-GO RECOMMENDATION

**Status:** 🔄 **PENDING TEST EXECUTION**

### Criteria for GO

1. ✅ Manual verify API call succeeds (HTTP 200, no ReferenceError)
2. ✅ Manual verify writes verify key to Upstash
3. ✅ Auto verify API call succeeds (HTTP 200, valid JSON response)
4. ✅ Auto verify writes verify key to Upstash (if HRN doesn't block)
5. ✅ Verify keys have correct format, fields, and TTL
6. ✅ Geoff's races (if run today) are logged correctly

### GO/NO-GO Decision

**Status:** 🔄 **PENDING TEST EXECUTION**

**Decision (to be filled):**
```
[TO BE FILLED AFTER TEST EXECUTION]
```

**Reasoning:**
```
[TO BE FILLED AFTER TEST EXECUTION]
```

---

## H. NEXT STEPS

**After Test Execution:**

1. ✅ Fill in actual preview URL
2. ✅ Fill in test results (API responses, verify keys)
3. ✅ Fill in scan results (Geoff's races)
4. ✅ Fill in GO/NO-GO recommendation
5. ⏳ If GO: Document readiness for merge/promotion
6. ⏳ If NO-GO: Document issues and proposed fixes

---

## APPENDIX

### Commands Reference

**Push branch:**
```bash
git push origin chore/preview-smoke-manual-verify
```

**Run smoke test:**
```bash
node scripts/debug/smoke_verify_suite.mjs <preview-url>
```

**Run scan:**
```bash
node scripts/debug/scan_recent_verify_keys.mjs 2026-01-11 meadowlands "charles town"
```

**Check Vercel deployments:**
- Dashboard: https://vercel.com/hired-hive/finishline-wps-ai
- Look for branch: `chore/preview-smoke-manual-verify`

### Files Created/Modified

1. **`scripts/debug/smoke_verify_suite.mjs`** (NEW)
   - End-to-end smoke test for manual and auto verify
   - Verifies verify keys are written to Upstash

2. **`scripts/debug/scan_recent_verify_keys.mjs`** (UPDATED)
   - Improved pattern matching for track names
   - Additional fallback patterns for partial matches

3. **`docs/PREVIEW_MANUAL_VERIFY_END_TO_END_PROOF_2026-01-11.md`** (THIS FILE)
   - Proof report template
   - To be filled with actual test results

---

**Report Generated:** 2026-01-11  
**Generated By:** Automated test suite setup  
**Status:** 🔄 **IN PROGRESS** - Awaiting preview URL and test execution
