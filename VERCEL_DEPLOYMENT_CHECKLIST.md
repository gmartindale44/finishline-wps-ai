# Vercel Deployment Checklist

## Pre-Deployment Checks

### ✅ Dependencies
- [x] `api/requirements.txt` updated with all dependencies
- [x] `apps/api/requirements.txt` matches api/requirements.txt
- [x] Pillow included for image processing
- [x] OpenAI SDK included
- [x] httpx for async HTTP requests

### ✅ Configuration
- [x] `vercel.json` configured:
  - Python 3.11 runtime
  - 60s maxDuration
  - 1536MB memory (for image processing)
- [x] Routes configured for /api/* → api/main.py
- [x] Static files route for apps/web/*

### ✅ Code Structure
- [x] `api/main.py` imports from `apps.api.api_main`
- [x] New modules have no syntax errors
- [x] All imports use relative paths correctly
- [x] Global exception middleware installed
- [x] `/api/health` endpoint added

### ✅ Environment Variables (Set in Vercel Dashboard)

Required:
```
FINISHLINE_OPENAI_API_KEY=sk-...
OPENAI_API_KEY=sk-...  # Fallback
```

Optional:
```
FINISHLINE_OCR_ENABLED=true
FINISHLINE_DATA_PROVIDER=stub
FINISHLINE_TAVILY_API_KEY=tvly-...
FINISHLINE_ALLOWED_ORIGINS=*
```

## Deployment Steps

1. **Commit all changes:**
   ```bash
   git add -A
   git commit -m "chore: ensure Vercel deployment compatibility"
   ```

2. **Push to GitHub:**
   ```bash
   git push origin feat/ocr-form-canonical
   ```

3. **Vercel will auto-deploy** (if connected to GitHub)
   - Or manually: `vercel --prod`

4. **Check deployment logs:**
   - Go to Vercel dashboard
   - Select project → Deployments
   - Click on latest deployment
   - Check "Build Logs" and "Function Logs"

## Post-Deployment Verification

### 1. Health Check
```bash
curl https://your-app.vercel.app/api/health
```
Expected:
```json
{
  "ok": true,
  "data": {"status": "ok", "service": "FinishLine WPS AI"},
  "requestId": "..."
}
```

### 2. Error Handling Test
```bash
curl -X POST https://your-app.vercel.app/api/finishline/photo_extract_openai_b64_v2 \
  -H "Content-Type: application/json" \
  -d '{"images":[]}'
```
Expected:
```json
{
  "ok": false,
  "error": {
    "code": "no_images",
    "message": "No images provided"
  },
  "requestId": "..."
}
```

### 3. Frontend Test
- Open: `https://your-app.vercel.app`
- Add `?debug=1` to URL
- Debug accordion should appear
- Try each button and verify:
  - Requests complete (or show structured errors)
  - Request IDs populate in debug UI
  - No "FUNCTION_INVOCATION_FAILED" errors
  - No "OCR returned non-JSON" alerts

### 4. Check Response Headers
```bash
curl -I https://your-app.vercel.app/api/health
```
Should include:
```
Content-Type: application/json
X-Request-Id: ...
```

## Common Deployment Issues

### Issue: "FUNCTION_INVOCATION_FAILED"

**Cause:** Unhandled exception or missing dependency

**Fix:**
1. Check Function Logs in Vercel dashboard
2. Look for import errors or missing packages
3. Verify all dependencies in `api/requirements.txt`
4. Check that global middleware is installed

### Issue: "Module not found"

**Cause:** Import path incorrect or missing `__init__.py`

**Fix:**
1. Verify `apps/api/common/__init__.py` exists
2. Check imports use relative paths: `from .common.schemas import ...`
3. Ensure `api/main.py` imports correctly: `from apps.api.api_main import app`

### Issue: "Payload too large"

**Cause:** Request body > 4.5MB

**Fix:**
1. Client-side: Use `image-compress.js` to compress before upload
2. Server-side: Validate payload size and return 413 with helpful message
3. Already implemented in `photo_extract_openai_b64.py`

### Issue: Timeout (524 error)

**Cause:** Function exceeds 60s limit

**Fix:**
1. Check timeout budgets:
   - OCR: 25s per image, 45s total
   - Analyze: 30s
   - Predict: 50s
2. Use `timeout_utils.py` for proper timeout handling
3. Return 504 with helpful message instead of crashing

### Issue: Memory exceeded

**Cause:** Image processing uses too much RAM

**Fix:**
1. Increase memory in `vercel.json` (already set to 1536MB)
2. Client-side: Compress images before upload
3. Server-side: Downscale images in `photo_extract_openai_b64.py`

## Rollback Plan

If deployment fails:

1. **Quick rollback:**
   ```bash
   vercel rollback
   ```

2. **Or revert commits:**
   ```bash
   git revert HEAD
   git push origin feat/ocr-form-canonical
   ```

3. **Check previous working deployment:**
   - Vercel dashboard → Deployments
   - Find last successful deployment
   - Click "Promote to Production"

## Monitoring

### Vercel Dashboard

Monitor:
- Build success rate
- Function execution time
- Error rate
- Invocation count

### Request IDs

When users report errors:
1. Ask for Request ID (shown in error toast or debug UI)
2. Search Vercel Function Logs for that Request ID
3. Full stack trace will be logged with `[requestId]` prefix

### Example log search:
```
[abc123def456] OCR request: race.png
[abc123def456] Processing image 1/3
[abc123def456] OCR complete: 5 horses, 4521ms
```

## Success Criteria

✅ All API responses are JSON (never HTML)
✅ Every response includes `requestId`
✅ Error messages are actionable
✅ Client never crashes on non-JSON responses
✅ Debug UI works on production
✅ No FUNCTION_INVOCATION_FAILED errors
✅ Response times < 60s
✅ Memory usage < 1536MB

## Support

If issues persist after following this checklist:

1. Check Vercel Function Logs
2. Use debug UI to get Request ID
3. Copy full error from "Copy for Support" button
4. Include in support request:
   - Request ID
   - Timestamp
   - Endpoint called
   - Error message
   - Browser console screenshot

