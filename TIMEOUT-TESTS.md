# FinishLine WPS AI - Timeout & Hang Prevention Tests

## PowerShell Quick Tests

### Debug Info
```powershell
# Shows OCR status, provider, timeouts
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/debug_info"
```

### URL OCR (bypasses upload, easier to test)
```powershell
# Extract horses from a direct image URL
curl.exe -sS -X POST "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/photo_extract_openai_url" `
  -H "content-type: application/json" `
  -d "{\"url\":\"https://raw.githubusercontent.com/public-sample-assets/horse-racing/main/drf-table-sample.png\"}"
```

### Health Check
```powershell
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/health"
```

## Timeout Configuration

### Client-Side (Browser)
- **Timeout:** 25 seconds
- **Mechanism:** AbortController in `fetchWithTimeout()`
- **Behavior:** Aborts fetch and shows alert "Extraction timed out or was blocked"
- **Button State:** Always resets in `finally` block (no hangs)

### Server-Side (API)
- **Timeout:** 25 seconds (configurable via `FINISHLINE_PROVIDER_TIMEOUT_MS`)
- **Mechanism:** `asyncio.wait_for()` wrapper around OCR call
- **Behavior:** Returns `{"error": "OCR timed out", "horses": []}` with status 504
- **Logging:** `[photo_extract_openai_b64] timeout after 25000ms`

### OpenAI Client
- **Timeout:** 25 seconds
- **Mechanism:** `OpenAI(timeout=25.0)`
- **Behavior:** Raises exception if API call exceeds limit

### Vercel Function
- **Timeout:** 30 seconds (configured in `vercel.json`)
- **Mechanism:** Vercel platform limit
- **Buffer:** 5s buffer above OCR timeout to allow clean error responses

## Acceptance Criteria

### ✅ No Hangs
- [ ] Click "Extract from Photos" → button shows "Extracting…"
- [ ] Wait up to 25 seconds
- [ ] Button ALWAYS resets to "Extract from Photos" (enabled)
- [ ] User sees either success toast or error alert

### ✅ Timeout Behavior
- [ ] If OCR times out (>25s), alert shows: "Extraction timed out or was blocked"
- [ ] Console shows: `❌ Extract failed (timeout or network)`
- [ ] Server logs: `[photo_extract_openai_b64] timeout after 25000ms`
- [ ] Response: `{"error": "OCR timed out", "horses": []}` (status 504)

### ✅ Success Path
- [ ] OCR completes in <25s
- [ ] Console shows: `✅ Parsed N horses`
- [ ] Toast shows: "Filled N horses" (green)
- [ ] Form populates with all horses

### ✅ Error Path
- [ ] OCR fails (no API key, bad image, etc.)
- [ ] Console shows: `⚠️ OCR error: [message]`
- [ ] Toast shows: "OCR error: [message]" (red)
- [ ] Alert shows full error details
- [ ] Button resets immediately

## Browser DevTools Testing

### Network Tab
1. Open DevTools → Network
2. Click "Extract from Photos"
3. Watch for `photo_extract_openai_b64` request
4. Request should complete OR abort within 25s
5. No hung requests (should show "canceled" or complete)

### Console Tab
**Success:**
```
📤 OCR upload (b64): race-table.png image/png
📥 Raw OCR response: {"horses":[...]}
✅ Parsed 8 horses
```

**Timeout:**
```
📤 OCR upload (b64): race-table.png image/png
❌ Extract failed (timeout or network): AbortError: The operation was aborted
Alert: "Extraction timed out or was blocked. See console for details."
```

**Server Error:**
```
📥 Raw OCR response: {"error":"OCR timed out","horses":[]}
⚠️ OCR error: OCR timed out
Alert: "OCR error: OCR timed out"
```

## Server Logs (Vercel)

### Normal Operation
```
[photo_extract_openai_b64] file=race.png mime=image/png size=245.3KB
[photo_extract_openai_b64] timeout=25000ms
[openai_ocr] JSON schema extracted 8 horses
[photo_extract_openai_b64] success: 8 horses
```

### Timeout
```
[photo_extract_openai_b64] file=race.png mime=image/png size=245.3KB
[photo_extract_openai_b64] timeout=25000ms
[photo_extract_openai_b64] timeout after 25000ms
```

### Other Error
```
[photo_extract_openai_b64] file=race.png mime=image/png size=245.3KB
[photo_extract_openai_b64] exception
Traceback (most recent call last):
  ...
```

## Edge Cases to Test

### 1. Rapid Clicks During Timeout
- Click "Extract from Photos"
- Immediately click again (spam click)
- **Expected:** Second click ignored (in-flight guard)
- **Console:** `⏳ Extract already in flight — ignored duplicate request`

### 2. Very Large Image
- Upload a 5MB+ DRF screenshot
- **Expected:** Either completes or times out at 25s
- **Button:** Always resets

### 3. Network Disconnect
- Start extraction
- Disable network mid-request
- **Expected:** Fetch aborts, button resets, alert shows

### 4. API Key Missing
- Remove `FINISHLINE_OPENAI_API_KEY` from Vercel env
- Try extraction
- **Expected:** Immediate error: "Missing OpenAI API key env"
- **Status:** 500
- **Button:** Resets immediately (no 25s wait)

## Timeline Diagram

```
User clicks "Extract from Photos"
    ↓
Button: "Extracting…" (disabled)
    ↓
Client starts 25s timer
    ↓
Server wraps OCR in 25s asyncio.wait_for()
    ↓
OpenAI client configured with 25s timeout
    ↓
═══════════════════════════════════════
Path A: Success (<25s)
    ↓
OpenAI returns JSON → Server parses → Returns {"horses":[...]}
    ↓
Client parses → populateFormFromParsed() → Toast: "Filled N horses"
    ↓
Button: "Extract from Photos" (enabled)
═══════════════════════════════════════
Path B: Timeout (≥25s)
    ↓
Client AbortController aborts fetch
    ↓
Console: "❌ Extract failed (timeout or network)"
    ↓
Alert: "Extraction timed out or was blocked"
    ↓
Button: "Extract from Photos" (enabled)
═══════════════════════════════════════
Path C: Server Timeout (≥25s, before client)
    ↓
asyncio.wait_for() raises TimeoutError
    ↓
Server returns {"error":"OCR timed out","horses":[]} (504)
    ↓
Client receives response → Alert: "OCR error: OCR timed out"
    ↓
Button: "Extract from Photos" (enabled)
═══════════════════════════════════════
```

## Verification Steps

1. **Test successful extraction:**
   - Upload small DRF screenshot
   - Should complete in <10s
   - Form fills, toast appears

2. **Test slow extraction:**
   - Upload large/complex image
   - If >25s, timeout triggers
   - Button resets, alert shows

3. **Test spam clicking:**
   - Click "Extract" rapidly
   - Only one request goes out
   - Console shows "⏳ Extract already in flight"

4. **Test network failure:**
   - Start extraction, disconnect WiFi
   - Client timeout aborts
   - Button resets within 25s

## Success Metrics

✅ **No Infinite Hangs:** Button ALWAYS resets within 25s  
✅ **Clear Feedback:** User always sees success or error message  
✅ **Single Request:** Spam clicking prevented by in-flight guard  
✅ **Graceful Degradation:** Timeouts return JSON errors, not HTML  
✅ **Observable Behavior:** Console logs show exact failure point  

