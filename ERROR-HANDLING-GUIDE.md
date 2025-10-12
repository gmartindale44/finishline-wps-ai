# Error Handling & Recovery Guide

**Repo**: `gmartindale44/finishline-wps-ai`  
**Branch**: `feat/ocr-form-canonical`  
**Status**: ✅ Fully hardened API with structured error responses

---

## 🎯 **Objective**

Eliminate opaque "FUNCTION_INVOCATION_FAILED" errors and provide clear, actionable feedback for all failure scenarios.

---

## 🛡️ **What Was Implemented**

### **1. Global Error Middleware (`apps/api/api_main.py`)**

Every request now gets:
- **Unique Request ID** (`req_id`) for log correlation
- **Structured error responses** with:
  - `ok: false`
  - `error`: Human-readable message
  - `code`: Machine-readable error code
  - `reqId`: For Vercel log lookup
  - `elapsed_ms`: Request duration
  - `hint` / `how_to_fix`: Actionable guidance

```python
@app.middleware("http")
async def error_wrapper_middleware(request: Request, call_next):
    req_id = str(uuid.uuid4())
    request.state.req_id = req_id
    t0 = time.perf_counter()
    
    try:
        response = await call_next(request)
        return response
    except ApiError as e:
        # Structured errors
        return json_error(e.status, e.message, e.code, req_id=req_id, ...)
    except Exception as e:
        # Catch-all for unexpected errors
        return json_error(500, "Internal server error", "internal", req_id=req_id, ...)
```

---

### **2. Error Utilities (`apps/api/error_utils.py`)**

New helper module with:

```python
class ApiError(Exception):
    """Structured API error with status, message, code, and extra data."""

def json_error(status, message, code, req_id, elapsed_ms, **extra) -> JSONResponse:
    """Return structured JSON error response."""

def require_env(name: str) -> str:
    """Require environment variable (raises ApiError if missing)."""

def validate_base64_size(base64_data: str, max_mb: float = 6.0):
    """Validate payload size (raises ApiError if too large)."""

def validate_request_method(method: str, allowed: list):
    """Validate HTTP method (raises ApiError if not allowed)."""
```

---

### **3. Enhanced Endpoint Error Handling**

#### **`/api/finishline/photo_extract_openai_b64`**

**Before**:
```python
except Exception as e:
    return JSONResponse({"error": str(e)}, status_code=500)
```

**After**:
```python
req_id = getattr(request.state, "req_id", str(uuid.uuid4()))
t0 = time.perf_counter()

# Validate size
validate_base64_size(data_b64, max_mb=6.0)

# Require OpenAI key
openai_key = os.getenv("FINISHLINE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
if not openai_key:
    raise ApiError(
        500,
        "OpenAI API key not configured. Set FINISHLINE_OPENAI_API_KEY.",
        "env_missing"
    )

# Log all operations
log.info(f"[{req_id}] OCR request: {filename}, {len(image_bytes)} bytes")

# Structured success response
return JSONResponse({
    "ok": True,
    "horses": horses,
    "reqId": req_id,
    "elapsed_ms": elapsed_ms
})
```

#### **`/api/finishline/research_predict`**

**Enhanced with**:
- Request ID logging
- Input validation (empty horse list)
- Provider-specific validation (Tavily key for websearch)
- Timeout handling with 504 status
- Structured error responses with hints

```python
log.info(f"[{req_id}] research_predict: {len(horses_input)} horses, phase={phase}")

if not horses_input:
    raise ApiError(
        400,
        "No horses provided. Add horses to the form first.",
        "no_horses",
        {"hint": "Click 'Extract from Photos' or manually enter horse data"}
    )

if selected_provider == "websearch" and not tavily_key:
    raise ApiError(
        400,
        "Websearch provider requires FINISHLINE_TAVILY_API_KEY",
        "env_missing",
        {"how_to_fix": "Set FINISHLINE_TAVILY_API_KEY in Vercel env or use provider=stub"}
    )
```

---

### **4. Client-Side Error Handling (`apps/web/app.js`)**

#### **Size Validation Before Upload**

```javascript
// Client-side size check
const estimatedMB = file.size / (1024 * 1024);
if (estimatedMB > 6) {
  alert(`That file is ${estimatedMB.toFixed(2)}MB. Please upload ≤ 6MB.`);
  return;
}

// Double-check base64 size
const base64MB = (dataURL.length * 3 / 4) / (1024 * 1024);
if (base64MB > 6) {
  alert(`Encoded image is ${base64MB.toFixed(2)}MB. Max 6MB.`);
  return;
}
```

#### **Structured Error Display**

```javascript
// Handle structured errors
if (!resp.ok || data?.ok === false) {
  const errMsg = data?.error || `Server error (${resp.status})`;
  const reqId = data?.reqId ? `\n\nReference: ${data.reqId}` : "";
  const hint = data?.hint || data?.how_to_fix || "";
  const hintMsg = hint ? `\n\nHow to fix: ${hint}` : "";
  
  console.error("❌ OCR failed:", data);
  alert(`OCR extraction failed:\n${errMsg}${hintMsg}${reqId}`);
  return;
}
```

#### **Always Reset Button State**

```javascript
} catch (e) {
  console.error("❌ Extract failed:", e);
  alert(`Extraction failed: ${e?.message || e}\n\nPlease try again.`);
} finally {
  if (btn) {
    btn.disabled = false;
    btn.textContent = originalLabel;
    btn.__extracting = false;
  }
}
```

---

### **5. Vercel Configuration (`vercel.json`)**

Increased memory and confirmed maxDuration:

```json
{
  "functions": {
    "api/**/*.py": { 
      "maxDuration": 60,
      "memory": 1536
    }
  }
}
```

---

## 📊 **Error Code Reference**

| Code | Status | Description | User Action |
|------|--------|-------------|-------------|
| `bad_request` | 400 | Missing or invalid input | Check form data |
| `no_horses` | 400 | Empty horse list | Extract from photos or add manually |
| `env_missing` | 400/500 | Missing API key | Contact admin to set env vars |
| `payload_too_large` | 413 | File > 6MB | Use smaller image |
| `method_not_allowed` | 405 | Wrong HTTP method | Use POST |
| `ocr_invalid` | 502 | Bad OCR response | Retry with different image |
| `timeout` | 504 | Operation timed out | Retry with smaller data or stub provider |
| `research_failed` | 500 | Research error | Check Tavily/OpenAI quotas |
| `internal` | 500 | Unexpected error | Contact support with `reqId` |

---

## 🧪 **Testing Scenarios**

### **1. Large File Upload**

**Test**: Upload 10MB image  
**Expected**:
```
Client alert: "That file is 10.24MB. Please upload an image ≤ 6MB."
```

**Server fallback** (if client check bypassed):
```json
{
  "ok": false,
  "error": "File too large (10.24MB). Maximum allowed is 6MB.",
  "code": "payload_too_large",
  "size_mb": 10.24,
  "limit_mb": 6.0,
  "reqId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "elapsed_ms": 45
}
```

---

### **2. Missing OpenAI API Key**

**Test**: Remove `FINISHLINE_OPENAI_API_KEY` from Vercel env  
**Expected**:
```json
{
  "ok": false,
  "error": "OpenAI API key not configured. Please set FINISHLINE_OPENAI_API_KEY or OPENAI_API_KEY.",
  "code": "env_missing",
  "reqId": "a1b2c3d4...",
  "elapsed_ms": 12
}
```

**Client alert**:
```
OCR extraction failed:
OpenAI API key not configured. Please set FINISHLINE_OPENAI_API_KEY or OPENAI_API_KEY.

Reference: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### **3. OCR Timeout**

**Test**: Upload very large/complex image  
**Expected**:
```json
{
  "ok": false,
  "error": "OCR processing timed out after 25s. Please try a smaller image or retry.",
  "code": "timeout",
  "reqId": "a1b2c3d4...",
  "elapsed_ms": 25034
}
```

---

### **4. Websearch Provider Missing Tavily Key**

**Test**: Set `provider=websearch` without `FINISHLINE_TAVILY_API_KEY`  
**Expected**:
```json
{
  "ok": false,
  "error": "Websearch provider requires FINISHLINE_TAVILY_API_KEY",
  "code": "env_missing",
  "provider": "websearch",
  "has_tavily_key": false,
  "how_to_fix": "Set FINISHLINE_TAVILY_API_KEY in Vercel environment variables or switch to provider=stub",
  "reqId": "a1b2c3d4...",
  "elapsed_ms": 8
}
```

---

### **5. Research Timeout**

**Test**: Analyze 12 horses with slow network  
**Expected**:
```json
{
  "ok": false,
  "error": "Research timed out. Try reducing the number of horses or use a faster provider.",
  "code": "timeout",
  "provider": "websearch",
  "timeout_ms": 55000,
  "elapsed_ms": 55123,
  "hint": "Click 'Predict W/P/S' again to retry with stub provider",
  "reqId": "a1b2c3d4..."
}
```

**Client behavior**:
- Resets "Analyzing…" button
- Shows alert with hint to retry
- User can click again to retry with stub

---

### **6. Empty Horse List**

**Test**: Click "Analyze" without extracting horses  
**Expected**:
```json
{
  "ok": false,
  "error": "No horses provided. Please add horses to the form first.",
  "code": "no_horses",
  "hint": "Click 'Extract from Photos' or manually enter horse data",
  "reqId": "a1b2c3d4...",
  "elapsed_ms": 3
}
```

---

## 🔍 **Vercel Log Correlation**

Every error includes a `reqId` that appears in:
1. **Client alert**: `Reference: a1b2c3d4-...`
2. **Browser console**: `[a1b2c3d4-...] OCR request: ...`
3. **Vercel logs**: Search for `a1b2c3d4` to find full trace

**Example Vercel log**:
```
[a1b2c3d4-e5f6-7890-abcd-ef1234567890] OCR request: race.png, 1234567 bytes
[a1b2c3d4-e5f6-7890-abcd-ef1234567890] OCR timeout after 25s
```

---

## ✅ **Benefits**

| Before | After |
|--------|-------|
| `FUNCTION_INVOCATION_FAILED` | `OCR timeout after 25s. Try smaller image.` |
| Generic 500 error | `Missing OPENAI_API_KEY. Set in Vercel env.` |
| Button stuck "Analyzing…" | Button auto-resets; user can retry |
| No way to debug production | Request ID for Vercel log lookup |
| Silent failures | Every error logged with context |
| No size limits | 6MB enforced client + server |

---

## 🚀 **Deployment Checklist**

- [x] Global error middleware active
- [x] All endpoints wrapped with try/catch
- [x] Request IDs in all responses and logs
- [x] Size validation (6MB) on client and server
- [x] Environment variable validation
- [x] Timeout handling with 504 status
- [x] Client alerts show `reqId` for support
- [x] Buttons always reset on error
- [x] Vercel function memory increased to 1536MB
- [x] `maxDuration` set to 60s

---

## 📝 **Next Steps for Testing**

1. **Upload oversized image** → Expect friendly size error
2. **Remove OPENAI_API_KEY** → Expect env_missing error with fix instructions
3. **Trigger timeout** → Expect 504 with retry hint
4. **Click buttons rapidly** → In-flight guards prevent duplicates
5. **Check Vercel logs** → Search for `reqId` from alert
6. **Verify button reset** → All error paths clear "Analyzing…" state

---

**No more opaque errors!** Every failure now provides clear, actionable feedback. 🎯✅

