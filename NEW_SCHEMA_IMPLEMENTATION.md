# New Schema Implementation - ApiOk/ApiErr Envelope

## Overview

This document describes the new standardized API response schema that eliminates FUNCTION_INVOCATION_FAILED and "OCR returned non-JSON" errors.

## Response Envelopes

### Success Response (ApiOk)

```json
{
  "ok": true,
  "data": {
    "spans": [...],
    "count": 5
  },
  "requestId": "abc123def456789..."
}
```

### Error Response (ApiErr)

```json
{
  "ok": false,
  "error": {
    "code": "payload_too_large",
    "message": "Image too large; please upload a smaller image",
    "details": {
      "size_mb": 4.2,
      "max_mb": 3.5
    }
  },
  "requestId": "abc123def456789..."
}
```

## Backend Implementation

### File Structure

```
apps/api/
├── common/
│   ├── schemas.py         # ApiOk, ApiErr, helpers
│   └── middleware.py      # Global error handler
├── photo_extract_openai_b64.py  # Hardened OCR endpoint
└── api_main.py           # Main FastAPI app
```

### Key Files

#### `apps/api/common/schemas.py`

Defines:
- `ApiOk(BaseModel)` - Success envelope
- `ApiErr(BaseModel)` - Error envelope
- `make_request_id()` - UUID generator
- `json_ok(data, request_id, status=200)` - Helper for success responses
- `json_err(code, message, request_id, status=400, details=None)` - Helper for error responses

#### `apps/api/common/middleware.py`

- Global exception handler that catches ALL unhandled exceptions
- Attaches `request_id` to every request
- Returns `ApiErr` JSON (never HTML) on exception
- Adds `/api/health` endpoint

#### `apps/api/photo_extract_openai_b64.py`

Hardened OCR handler with:
- Content-Type validation (415 if not JSON)
- Request schema validation with Pydantic
- Payload size checks (413 if > 3.5MB decoded)
- Per-image timeout (25s) with retry on transient errors (429, 5xx)
- Total budget timeout (45s, stays under Vercel 60s limit)
- Provider error normalization (502 with code `ocr_provider_error`)
- Always returns `ApiOk` or `ApiErr`

### Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `bad_content_type` | 415 | Request not application/json |
| `invalid_request` | 400 | Schema validation failed |
| `no_images` | 400 | Empty images array |
| `payload_too_large` | 413 | Image > 3.5MB decoded |
| `timeout` | 504 | Exceeded time budget |
| `ocr_provider_error` | 502 | OpenAI/provider failed |
| `ocr_unavailable` | 503 | OCR service not configured |
| `internal_error` | 500 | Unhandled exception |

## Frontend Implementation

### File Structure

```
apps/web/
├── net.js                 # Safe fetch wrapper
├── debug-ui.js           # Debug accordion
└── INTEGRATION_EXAMPLE.js # Usage examples
```

### Key Files

#### `apps/web/net.js`

Provides:
- `async safeJson(res)` - Parse JSON safely, never throws
- `async apiPost(url, body)` - POST with consistent error handling
- `showErrorToast(error, requestId)` - Display error with request ID
- `storeRequestDebug(endpoint, response)` - Store for debug UI

Usage:
```javascript
const response = await window.apiPost("/api/finishline/photo_extract_openai_b64", {
  images: ["data:image/jpeg;base64,..."]
});

if (response.ok) {
  // Success
  const { spans, count } = response.data;
  console.log(`Got ${count} spans`);
} else {
  // Error
  window.showErrorToast(response.error, response.requestId);
}
```

#### `apps/web/debug-ui.js`

Creates a debug accordion (visible with `?debug=1` or on localhost) showing:
- Last Request ID
- Last Endpoint
- Last Status (ok/error/code)
- "Copy for Support" button (copies full JSON)

### Migrating from Old Code

**Before:**
```javascript
const res = await fetch(url, {
  method: "POST",
  body: JSON.stringify(body)
});

const raw = await res.text();
let data;
try {
  data = JSON.parse(raw);
} catch {
  alert("OCR returned non-JSON");
  return;
}

if (data.error) {
  alert(data.error);
  return;
}
```

**After:**
```javascript
const response = await window.apiPost(url, body);

window.storeRequestDebug(url, response);

if (response.ok) {
  // Use response.data
} else {
  window.showErrorToast(response.error, response.requestId);
}
```

## Testing

### Unit Tests (pytest)

```bash
# Install test dependencies
pip install -r tests/requirements.txt

# Run tests
pytest tests/test_ocr_endpoint.py -v
```

Tests cover:
- Empty body → 400
- Empty images array → 400
- Too many images → 400
- Oversized image → 413 with `payload_too_large`
- Bad content-type → 415
- Provider error → 502 with `ocr_provider_error`
- Happy path → 200 with `ApiOk`
- All responses are JSON
- All responses have `X-Request-Id` header

### Manual Testing

1. **Health Check:**
   ```bash
   curl http://localhost:8000/api/health
   ```
   Expected:
   ```json
   {"ok":true,"data":{"status":"ok","service":"FinishLine WPS AI"},"requestId":"..."}
   ```

2. **Empty Images Error:**
   ```bash
   curl -X POST http://localhost:8000/api/finishline/photo_extract_openai_b64_v2 \
     -H "Content-Type: application/json" \
     -d '{"images":[]}'
   ```
   Expected:
   ```json
   {"ok":false,"error":{"code":"no_images","message":"No images provided"},"requestId":"..."}
   ```

3. **Debug UI:**
   - Navigate to `http://localhost:8000?debug=1`
   - Open browser console
   - Run: `console.log(window.LAST_REQUEST)`

## Deployment Checklist

### Vercel Configuration

Ensure `vercel.json` has:
```json
{
  "functions": {
    "api/**/*.py": {
      "runtime": "python3.11",
      "maxDuration": 60,
      "memory": 1024
    }
  }
}
```

### Environment Variables

Required:
- `FINISHLINE_OPENAI_API_KEY` or `OPENAI_API_KEY`

Optional:
- `FINISHLINE_OCR_ENABLED=true` (default)
- `FINISHLINE_DATA_PROVIDER=stub` (for testing)

### Post-Deploy Verification

1. **Health endpoint:**
   ```bash
   curl https://your-app.vercel.app/api/health
   ```
   Should return JSON with `{"ok":true,...}`

2. **OCR endpoint (expected error):**
   ```bash
   curl -X POST https://your-app.vercel.app/api/finishline/photo_extract_openai_b64_v2 \
     -H "Content-Type: application/json" \
     -d '{"images":[]}'
   ```
   Should return JSON with `{"ok":false,...}`

3. **Check headers:**
   ```bash
   curl -I https://your-app.vercel.app/api/health
   ```
   Should include: `X-Request-Id: ...`

4. **Test UI:**
   - Open app
   - Add `?debug=1` to URL
   - Debug accordion should appear
   - Try Extract → check Last Request ID populated

## Troubleshooting

### Still Getting HTML Errors

1. Check middleware is installed:
   ```python
   # In api_main.py
   if SCHEMA_AVAILABLE:
       install_error_middleware(app)
   ```

2. Check logs for import errors:
   ```bash
   vercel logs --follow
   ```

3. Verify files deployed:
   ```
   apps/api/common/schemas.py
   apps/api/common/middleware.py
   ```

### "OCR returned non-JSON" Still Appearing

1. Check frontend is using new `apiPost`:
   ```javascript
   // Should be:
   const response = await window.apiPost(url, body);
   
   // NOT:
   const res = await fetch(url, ...);
   const data = await res.json();  // ❌
   ```

2. Check `net.js` is loaded:
   ```html
   <script src="net.js"></script>
   ```

3. Verify in console:
   ```javascript
   console.log(typeof window.apiPost);  // Should be "function"
   ```

### Request ID Not Showing

1. Check `X-Request-Id` header in response:
   ```javascript
   fetch(url).then(r => console.log(r.headers.get('x-request-id')));
   ```

2. Check middleware adds header:
   ```python
   # In middleware.py
   response.headers["X-Request-Id"] = request_id
   ```

3. Check debug UI is enabled:
   - Add `?debug=1` to URL
   - Should see accordion at bottom-left

## Migration Timeline

1. ✅ **Phase 1**: New schema + middleware (backward compatible)
2. ✅ **Phase 2**: V2 OCR endpoint (`/photo_extract_openai_b64_v2`)
3. ✅ **Phase 3**: Frontend `net.js` + debug UI
4. ⏳ **Phase 4**: Update all button handlers to use `apiPost`
5. ⏳ **Phase 5**: Deprecate legacy endpoints

## Support

When reporting issues, include:
1. Request ID (from error toast or debug UI)
2. Endpoint called
3. Error code and message
4. Browser console screenshot
5. Output from "Copy for Support" button

Example support ticket:
```
Issue: OCR failed with timeout

Request ID: abc123def456
Endpoint: /api/finishline/photo_extract_openai_b64_v2
Error: {"code":"timeout","message":"OCR processing exceeded 45s time budget"}
Browser: Chrome 120
Console: (screenshot)
Support JSON: (paste from "Copy for Support")
```

