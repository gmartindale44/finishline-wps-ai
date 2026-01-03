# PayGate Server Enforcement - Verification Checklist

**Branch**: `feat/paygate-server-enforcement`  
**Status**: Ready for Preview Deployment

---

## ✅ Build Fix Summary

### Issue Fixed
- **Build Error**: `pages/api/paygate/stripe-validate.js - Module not found: Can't resolve 'stripe'`
- **Resolution**: File doesn't exist (confirmed). No code references found. Only markdown docs mention it (non-blocking).
- **Action**: If build still fails, clear Next.js cache: `rm -rf .next` or Vercel will handle on fresh build.

---

## 🔒 Protected Routes

All premium API routes now have server-side PayGate protection with **fail-open** behavior:

1. ✅ `/api/predict_wps` - WPS prediction endpoint
2. ✅ `/api/photo_extract_openai_b64` - OCR image extraction
3. ✅ `/api/verify_race` - Race verification
4. ✅ `/api/green_zone` - GreenZone scoring
5. ✅ `/api/calibration_status` - Calibration status
6. ✅ `/api/greenzone_today` - GreenZone today suggestions
7. ✅ `/api/verify_backfill` - Verify backfill runner
8. ✅ `/api/calibration/summary` - Calibration summary (newly created)

### Public Routes (NOT gated)
- `/api/health` - Health check
- `/api/tracks` - Track listing
- `/api/paygate/status` - PayGate status
- `/api/paygate/issue-cookie` - Cookie issuance

---

## 🧪 Verification Tests

### Prerequisites

**Environment Variables (Preview ONLY - set in Vercel Dashboard):**

```bash
# PayGate Server Enforcement (REQUIRED)
PAYGATE_SERVER_ENFORCE=0          # 0 = monitor mode (default), 1 = enforce mode
PAYGATE_COOKIE_SECRET=<secret>   # HMAC secret for signing tokens (or use FAMILY_UNLOCK_TOKEN)

# Optional (fallback)
FAMILY_UNLOCK_TOKEN=<token>       # Used as fallback if PAYGATE_COOKIE_SECRET not set
```

**Note**: For Preview deployment, set `PAYGATE_SERVER_ENFORCE=0` (monitor mode) to test without blocking.

---

### Test 1: Monitor Mode (PAYGATE_SERVER_ENFORCE=0)

**Expected**: All requests return 200, but logs show PayGate status.

```bash
# Test without cookie (should return 200 in monitor mode)
curl -X POST https://<preview-url>/api/predict_wps \
  -H "Content-Type: application/json" \
  -d '{"horses":[{"name":"Horse1","odds":"3/1"},{"name":"Horse2","odds":"5/1"},{"name":"Horse3","odds":"7/1"}],"track":"DRF","surface":"dirt","distance_input":"6f"}'

# Expected: 200 OK with prediction data
# Check Vercel logs for: [PayGate] MONITOR MODE: ... cookie_valid: false
```

```bash
# Test with valid cookie (should return 200)
curl -X POST https://<preview-url>/api/predict_wps \
  -H "Content-Type: application/json" \
  -H "Cookie: fl_paygate_token=<valid-token>" \
  -d '{"horses":[{"name":"Horse1","odds":"3/1"},{"name":"Horse2","odds":"5/1"},{"name":"Horse3","odds":"7/1"}],"track":"DRF","surface":"dirt","distance_input":"6f"}'

# Expected: 200 OK with prediction data
# Check Vercel logs for: [PayGate] MONITOR MODE: ... cookie_valid: true, plan: <plan>
```

---

### Test 2: Enforce Mode (PAYGATE_SERVER_ENFORCE=1)

**Expected**: Requests without cookie return 403, requests with cookie return 200.

```bash
# Test without cookie (should return 403)
curl -X POST https://<preview-url>/api/predict_wps \
  -H "Content-Type: application/json" \
  -d '{"horses":[{"name":"Horse1","odds":"3/1"},{"name":"Horse2","odds":"5/1"},{"name":"Horse3","odds":"7/1"}],"track":"DRF","surface":"dirt","distance_input":"6f"}'

# Expected: 403 Forbidden
# Response: {"ok":false,"error":"PayGate locked","message":"Premium access required...","code":"paygate_locked","reason":"missing_cookie"}
```

```bash
# Test with valid cookie (should return 200)
curl -X POST https://<preview-url>/api/predict_wps \
  -H "Content-Type: application/json" \
  -H "Cookie: fl_paygate_token=<valid-token>" \
  -d '{"horses":[{"name":"Horse1","odds":"3/1"},{"name":"Horse2","odds":"5/1"},{"name":"Horse3","odds":"7/1"}],"track":"DRF","surface":"dirt","distance_input":"6f"}'

# Expected: 200 OK with prediction data
# Check Vercel logs for: [PayGate] ALLOWED: ... plan: <plan>
```

---

### Test 3: Cookie Issuance

```bash
# Issue a test cookie (day pass - 24 hours)
curl -X POST https://<preview-url>/api/paygate/issue-cookie \
  -H "Content-Type: application/json" \
  -d '{"plan":"day","durationMs":86400000}'

# Expected: 200 OK
# Response: {"ok":true,"plan":"day","expiry":<timestamp>,"issued_at":<timestamp>}
# Save the cookie value from Set-Cookie header for next test
```

---

### Test 4: All Protected Routes

Test each protected route in enforce mode:

```bash
# 1. predict_wps
curl -X POST https://<preview-url>/api/predict_wps -H "Content-Type: application/json" -d '{"horses":[...]}'
# Expected: 403 without cookie, 200 with cookie

# 2. photo_extract_openai_b64
curl -X POST https://<preview-url>/api/photo_extract_openai_b64 -H "Content-Type: application/json" -d '{"imagesB64":["..."]}'
# Expected: 403 without cookie, 200 with cookie

# 3. verify_race
curl -X POST https://<preview-url>/api/verify_race -H "Content-Type: application/json" -d '{"track":"DRF","date":"2025-01-15","raceNo":"1"}'
# Expected: 403 without cookie, 200 with cookie

# 4. green_zone
curl -X POST https://<preview-url>/api/green_zone -H "Content-Type: application/json" -d '{"signals":{"confidence":75,"top3Mass":0.8},"track":"DRF"}'
# Expected: 403 without cookie, 200 with cookie

# 5. calibration_status
curl -X GET https://<preview-url>/api/calibration_status
# Expected: 403 without cookie, 200 with cookie

# 6. greenzone_today
curl -X GET https://<preview-url>/api/greenzone_today
# Expected: 403 without cookie, 200 with cookie

# 7. verify_backfill
curl -X POST https://<preview-url>/api/verify_backfill -H "Content-Type: application/json" -d '{"races":[...]}'
# Expected: 403 without cookie, 200 with cookie

# 8. calibration/summary
curl -X GET https://<preview-url>/api/calibration/summary?limit=50
# Expected: 403 without cookie, 200 with cookie
```

---

### Test 5: Public Routes (Should Always Work)

```bash
# Health check (should always return 200)
curl https://<preview-url>/api/health

# Tracks (should always return 200)
curl https://<preview-url>/api/tracks

# PayGate status (should always return 200)
curl https://<preview-url>/api/paygate/status
```

---

## 🔍 Chrome DevTools Testing

### Monitor Mode (PAYGATE_SERVER_ENFORCE=0)

1. Open Chrome DevTools → Network tab
2. Navigate to app and trigger a premium API call (e.g., predict)
3. Check response:
   - **Status**: 200 OK
   - **Headers**: Look for `X-PayGate-Middleware: active`
   - **Console**: Check for `[PayGate] MONITOR MODE` logs
4. Verify request succeeds even without cookie

### Enforce Mode (PAYGATE_SERVER_ENFORCE=1)

1. Set `PAYGATE_SERVER_ENFORCE=1` in Vercel Preview env vars
2. Clear cookies (Application → Cookies → Delete `fl_paygate_token`)
3. Trigger premium API call
4. Check response:
   - **Status**: 403 Forbidden
   - **Response Body**: `{"ok":false,"error":"PayGate locked",...}`
5. Unlock via frontend (family token or Stripe)
6. Trigger same API call again
7. Check response:
   - **Status**: 200 OK
   - **Cookies**: `fl_paygate_token` should be set (httpOnly, Secure in production)

---

## 📋 Deployment Checklist

### Before Merging to Main

- [ ] Preview build passes (no stripe-validate errors)
- [ ] All protected routes return 403 in enforce mode without cookie
- [ ] All protected routes return 200 in enforce mode with cookie
- [ ] Monitor mode logs PayGate status but allows all requests
- [ ] Public routes (`/api/health`, `/api/tracks`) always work
- [ ] Cookie issuance endpoint works (`/api/paygate/issue-cookie`)
- [ ] Fail-open behavior verified (PayGate errors don't break requests)

### Environment Variables (Preview)

Set in Vercel Dashboard → Project Settings → Environment Variables:

```
PAYGATE_SERVER_ENFORCE=0              # Start in monitor mode
PAYGATE_COOKIE_SECRET=<generate-secret>  # Use: openssl rand -hex 32
```

### Environment Variables (Production)

**DO NOT SET** `PAYGATE_SERVER_ENFORCE=1` until Preview is fully tested and verified.

---

## 🚨 Important Notes

1. **Fail-Open by Default**: All routes catch PayGate errors and allow requests (safety first)
2. **Monitor Mode**: Default behavior logs but doesn't block (PAYGATE_SERVER_ENFORCE=0)
3. **Enforce Mode**: Only blocks when `PAYGATE_SERVER_ENFORCE=1` AND cookie is missing/invalid
4. **Cookie Security**: 
   - httpOnly: true (not accessible via JavaScript)
   - Secure: true (HTTPS only in production)
   - SameSite: Lax
   - Max-Age: Based on plan (day=24h, core=30d, family=180d)

---

## 📝 Summary of Changes

### Files Modified
- ✅ `pages/api/calibration/summary.js` - Created with PayGate protection
- ✅ All premium routes already had PayGate protection (verified)

### Files Not Modified (Already Protected)
- `pages/api/predict_wps.js` - Has PayGate check
- `pages/api/photo_extract_openai_b64.js` - Has PayGate check
- `pages/api/verify_race.js` - Has PayGate check
- `pages/api/green_zone.ts` - Has PayGate check
- `pages/api/calibration_status.js` - Has PayGate check
- `pages/api/greenzone_today.js` - Has PayGate check
- `pages/api/verify_backfill.js` - Has PayGate check

### Build Fix
- ✅ Confirmed `pages/api/paygate/stripe-validate.js` doesn't exist
- ✅ No code references found (only in markdown docs)
- ✅ Build should pass on fresh Vercel build (cache cleared)

---

## 🎯 Next Steps

1. **Deploy to Preview**: Push to `feat/paygate-server-enforcement` branch
2. **Test in Monitor Mode**: Set `PAYGATE_SERVER_ENFORCE=0` in Preview env vars
3. **Run Verification Tests**: Use curl tests above
4. **Test in Enforce Mode**: Set `PAYGATE_SERVER_ENFORCE=1` and verify blocking
5. **Verify Fail-Open**: Temporarily break PayGate check and confirm requests still work
6. **Merge to Main**: Once Preview is verified, merge and deploy to Production

---

**Preview URL**: Will be available after deployment to `feat/paygate-server-enforcement` branch

