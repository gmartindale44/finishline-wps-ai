# Photo Extract Endpoint Fix

## Why 405 Happened

**Problem:** Frontend POSTs to `/api/photo_extract_openai_b64` returned `405 Method Not Allowed`.

**Root Cause:**
- The handler existed in `./api/photo_extract_openai_b64.js` (root-level Vercel serverless function)
- When `./api` folder was disabled (renamed to `./api_disabled`), the handler was no longer accessible
- No handler existed in `pages/api/photo_extract_openai_b64.js` (Next.js API route)
- Next.js returned `405 Method Not Allowed` because no handler was found for that route

## What Changed

**Created:** `pages/api/photo_extract_openai_b64.js`

**Features:**
- ✅ Supports POST method (returns 405 for other methods with clear error message)
- ✅ Handles multiple payload formats from frontend:
  - `{ imagesB64: string[], kind?: string }` (new format)
  - `{ b64: string }` (legacy format)
  - `{ data_b64: string }` (legacy format)
  - `{ data: string }` (legacy format)
  - `{ imagesBase64: string[] }` (alternative format)
- ✅ Validates input safely (400 for bad input)
- ✅ Calls OpenAI Vision API for OCR processing
- ✅ Returns JSON with proper structure
- ✅ Sets `X-Handler-Identity: PHOTO_EXTRACT_OK` header
- ✅ Sets `Cache-Control: no-store` headers
- ✅ Defensive error handling (400 for bad input, 500 for OCR failure)

**Headers:**
- `Content-Type: application/json; charset=utf-8`
- `X-Handler-Identity: PHOTO_EXTRACT_OK`
- `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`

## How to Test

### PowerShell Test

```powershell
$PreviewUrl = "https://<YOUR-PREVIEW-URL>.vercel.app"

# Test with minimal payload
$testB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
$body = @{ b64 = $testB64 } | ConvertTo-Json

$r = Invoke-WebRequest -Uri "$PreviewUrl/api/photo_extract_openai_b64" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
Write-Host "X-Handler-Identity: $($r.Headers['X-Handler-Identity'])"
$json = $r.Content | ConvertFrom-Json
Write-Host "ok: $($json.ok)"
$json | ConvertTo-Json
```

### Expected Results

**Success (200):**
- Status: `200`
- `X-Handler-Identity: PHOTO_EXTRACT_OK`
- JSON: `{ "ok": true, "model": "gpt-4o-mini", "entries": [...], ... }`

**Bad Input (400):**
- Status: `400`
- `X-Handler-Identity: PHOTO_EXTRACT_OK`
- JSON: `{ "ok": false, "error": "Invalid payload format", ... }`

**Wrong Method (405):**
- Status: `405`
- `X-Handler-Identity: PHOTO_EXTRACT_OK`
- JSON: `{ "ok": false, "error": "POST required", ... }`

### Frontend Test

1. Open Preview URL in browser
2. Click "Extract from Photos" or "Analyze with AI"
3. Select an image file
4. Check Network tab:
   - Request: `POST /api/photo_extract_openai_b64`
   - Status: `200` (not `405`)
   - Response: JSON with `ok: true` and extracted data

## Safety

- ✅ `pages/api/verify_race.js` untouched (no changes)
- ✅ Paygate handlers untouched (no changes)
- ✅ Frontend code untouched (no changes)
- ✅ No rewrites/redirects added
- ✅ No env vars changed
- ✅ Build succeeds

## Files Changed

- `pages/api/photo_extract_openai_b64.js` - Created (new handler)

## Files NOT Changed

- `pages/api/verify_race.js` - ✅ Untouched
- `pages/api/paygate-token.js` - ✅ Untouched
- `pages/api/debug-paygate.js` - ✅ Untouched
- All frontend files - ✅ Untouched

