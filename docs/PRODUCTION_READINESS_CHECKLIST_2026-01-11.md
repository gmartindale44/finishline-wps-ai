# Production Readiness Checklist - Manual Verify Fix

**Date**: 2026-01-11  
**Branch**: `chore/preview-smoke-manual-verify`  
**Final Commit**: `f26d2f20` - fix(preview): define enablePredSnapshots in logVerifyResult scope

## Preview Deployment Status

- ✅ **Commit**: `f26d2f20`
- ✅ **Status**: Ready (build successful)
- ✅ **URL**: `https://finishline-wps-ai-git-chore-preview-smoke-man-d6e9bc-hired-hive.vercel.app`
- ✅ **PAYGATE_SERVER_ENFORCE**: `false` (Preview only - PayGate disabled for testing)

## Preview Verification Results

### Manual Verify Test (via Preview UI/API)

**Request**:
```json
{
  "mode": "manual",
  "track": "Meadowlands",
  "date": "2026-01-11",
  "raceNo": "9",
  "outcome": {
    "win": "Test Winner",
    "place": "Test Place",
    "show": "Test Show"
  }
}
```

**Response Excerpt** (`responseMeta.redis`):
```json
{
  "verifyKey": "fl:verify:meadowlands-2026-01-11-unknown-r9",
  "writeOk": true,
  "writeErr": null,
  "readbackOk": true,
  "readbackErr": null,
  "ttlSeconds": 7776000,
  "valueSize": 1134
}
```

**Response Excerpt** (`responseMeta.redisFingerprint`):
```json
{
  "urlFingerprint": "ash.io",
  "tokenFingerprint": "b745c083",
  "env": "preview-production-f26d2f2",
  "configured": true,
  "urlHost": "picked-grouse-35888.upstash.io",
  "vercelEnv": "preview",
  "vercelGitCommitSha": "f26d2f203f7d2d99f93bdc75fa1f3304599cbf92",
  "nodeEnv": "production"
}
```

### Auto Verify Test Results

- ✅ HTTP 200, `ok: true`
- ✅ `responseMeta.redis.writeOk`: `true`
- ✅ `responseMeta.redis.readbackOk`: `true`
- ✅ `responseMeta.redis.ttlSeconds`: `7776000`
- ✅ `responseMeta.redisFingerprint`: PRESENT

## Important Notes

### Manual Verify Backfill Requirement

**⚠️ CRITICAL**: Earlier manual verifies performed during the `predmeta` ReferenceError crash (before commit `f26d2f20`) were **NOT logged to Upstash**. These races must be **re-entered manually** to backfill the verify logs.

**Affected Period**: Manual verifies performed before the fix was deployed (before commit `f26d2f20`).

**Action Required**: Review any manual verifies performed during the crash period and re-enter them to ensure complete logging coverage.

## Merge & Promote Checklist

### Pre-Merge Verification

- [x] Preview build successful (commit `f26d2f20`)
- [x] Manual verify returns `responseMeta.redis.writeOk=true` and `readbackOk=true`
- [x] Auto verify returns `responseMeta.redis.writeOk=true` and `readbackOk=true`
- [x] Both paths include `responseMeta.redisFingerprint`
- [x] No build errors or runtime errors
- [x] `PAYGATE_SERVER_ENFORCE` remains `false` in Preview (for testing)

### Merge to Master

1. **Create PR** from `chore/preview-smoke-manual-verify` to `master`
   - Title: "fix: manual verify predmeta ReferenceError + server-side Redis proof"
   - Include link to this checklist
   - Review code changes:
     - Removed duplicate `finalOk` declaration
     - Added `enablePredSnapshots` definition in `logVerifyResult` scope
     - Added Redis metadata capture in both manual and auto verify paths

2. **Merge PR** after review approval

### Post-Merge Production Deployment

1. **Wait for Vercel Production Deployment**
   - Confirm deployment is live on `master` branch
   - Verify commit SHA matches merged PR

2. **Configure PayGate for Production**
   - **Decision Required**: Set `PAYGATE_SERVER_ENFORCE` in Vercel Production environment
     - If **enabled** (`true`): API requires authentication (recommended for production)
     - If **disabled** (`false`): API is publicly accessible (use only if explicitly required)
   - **Action**: Update Vercel Production environment variable:
     - Go to Vercel Dashboard → Project Settings → Environment Variables
     - Set `PAYGATE_SERVER_ENFORCE` to desired value for Production
     - Trigger redeploy if needed

3. **Run Smoke Test on Production**
   ```bash
   node scripts/debug/smoke_verify_suite.mjs <production-url>
   ```
   
   **PASS Criteria**:
   - Manual verify: HTTP 200, `ok: true`
   - `responseMeta.redis.writeOk === true`
   - `responseMeta.redis.readbackOk === true`
   - `responseMeta.redis.ttlSeconds` is not null (should be ~7776000)
   - `responseMeta.redisFingerprint` present
   - Auto verify: Same criteria

4. **Verify Production Response Meta**
   - Confirm `responseMeta.redis.verifyKey` matches expected format
   - Confirm `responseMeta.redis.ttlSeconds` is ~7776000 (90 days)
   - Confirm `responseMeta.redisFingerprint` includes production environment info

5. **Production Monitoring**
   - Monitor Vercel logs for any errors
   - Verify manual verify requests are logging to Upstash
   - Check that verify keys are being written with correct TTL

### Post-Deployment Verification

- [ ] Production deployment URL confirmed
- [ ] PayGate configuration set (true/false based on decision)
- [ ] Smoke test passes on production
- [ ] `responseMeta.redis` proof confirmed in production responses
- [ ] Manual verify works end-to-end in production UI
- [ ] No errors in Vercel production logs

## Files Changed

- `pages/api/verify_race.js`:
  - Removed duplicate `finalOk` declaration
  - Added `enablePredSnapshots` definition in `logVerifyResult` scope
  - Modified `logVerifyResult()` to return `redisResult` object
  - Added Redis metadata capture in manual verify path
  - Added Redis metadata capture in auto verify path
  - Added `responseMeta.redis` and `responseMeta.redisFingerprint` to both paths

## Related Documentation

- `docs/MANUAL_VERIFY_PATCH_AND_LOG_CHECK_2026-01-11.md` - Initial bug fix and verification
- `docs/PREVIEW_MANUAL_VERIFY_END_TO_END_PROOF_2026-01-11.md` - Preview end-to-end proof
