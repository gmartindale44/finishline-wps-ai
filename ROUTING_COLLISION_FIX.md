# Routing Collision Fix

## What Was Wrong

**Problem:** Both `./api` (root-level Vercel serverless functions) and `./pages/api` (Next.js API routes) existed, causing routing collisions.

**Evidence:**
- Requests to `/api/paygate-token` returned `X-Handler-Identity: VERIFY_RACE_STUB` instead of `PAYGATE_TOKEN_OK`
- Requests to `/api/debug-paygate` returned `verify_race_stub` JSON instead of their own handlers
- Vercel logs showed `[buildStubResponse] Date is missing` for paygate endpoints, proving they were hitting `verify_race` handler

**Root Cause:**
Vercel was prioritizing root `/api` serverless functions, but when handlers were missing or misconfigured, requests fell back to Next.js `pages/api/verify_race.js` handler.

## What Changed

**Action:** Renamed root `./api` folder to `./api_disabled` to eliminate routing collision.

**Files Changed:**
- `./api` → `./api_disabled` (entire folder renamed, 28 files preserved)

**Why This Works:**
- Next.js `pages/api/*` routes are now the single source of truth
- Vercel will no longer create serverless functions from root `/api` directory
- All `/api/*` requests will route exclusively through Next.js `pages/api/*` handlers
- No URL paths changed - only the folder structure that creates conflicting handlers

## How to Verify

### 1. Local Build Check
```powershell
npm run build
```
**Expected:** Build succeeds with no errors

### 2. Vercel Preview Check

After deployment, test these endpoints:

**Test 1: /api/paygate-token**
```powershell
$PreviewUrl = "https://<YOUR-PREVIEW-URL>.vercel.app"
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/paygate-token?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
Write-Host "Content-Type: $($r.Headers['Content-Type'])"
Write-Host "Body (first 200 chars):"
$r.Content.Substring(0, [Math]::Min(200, $r.Content.Length))
```

**Expected:**
- ✅ Status: `200`
- ✅ `X-Handler-Identity: PAYGATE_TOKEN_OK`
- ✅ `Content-Type: application/javascript; charset=utf-8`
- ✅ Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, JSON structure

**Test 2: /api/debug-paygate**
```powershell
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/debug-paygate?cb=123" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
$json = $r.Content | ConvertFrom-Json
Write-Host "handler: $($json.handler)"
$json | ConvertTo-Json
```

**Expected:**
- ✅ Status: `200`
- ✅ `X-Handler-Identity: DEBUG_PAYGATE_OK`
- ✅ `Content-Type: application/json; charset=utf-8`
- ✅ JSON contains: `"handler": "debug-paygate"`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`

**Test 3: /api/verify_race (POST) - Regression Check**
```powershell
$body = @{date="2025-12-31";track="Turfway Park";raceNo="8"} | ConvertTo-Json
$r = Invoke-WebRequest -Uri "$PreviewUrl/api/verify_race" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
$r.Content.Substring(0, [Math]::Min(200, $r.Content.Length))
```

**Expected:**
- ✅ Status: `200`
- ✅ Body contains verify result (NOT `verify_race_stub`)
- ✅ Behavior identical to before (unchanged)

## Files Preserved

All 28 files from `./api` are preserved in `./api_disabled`:
- No code was deleted
- All handlers remain available for reference
- Can be restored if needed (though not recommended)

## Safety

- ✅ `pages/api/verify_race.js` untouched (no changes)
- ✅ All existing `/api` endpoints continue to work via `pages/api/*`
- ✅ No URL paths changed
- ✅ Frontend fetch calls to `/api/*` remain unchanged

## Rollback

If needed, rename `./api_disabled` back to `./api`:
```powershell
Move-Item -Path api_disabled -Destination api
```

However, this will reintroduce the routing collision issue.

