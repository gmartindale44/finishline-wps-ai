# FinishLine WPS AI - Debug & OCR Tests

## PowerShell Quick Tests

### Health + Debug Info
```powershell
# Health check
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/health"

# Debug info (shows OCR status, provider, etc.)
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/debug_info"
```

### OCR by URL (No File Upload)
```powershell
# Extract horses from a direct image URL
curl.exe -sS -X POST "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/photo_extract_openai_url" `
  -H "content-type: application/json" `
  -d "{\"url\":\"https://raw.githubusercontent.com/public-sample-assets/horse-racing/main/drf-table-sample.png\"}"
```

### OCR by Base64 (Browser Upload Path)
```powershell
# This is what the browser uses internally
curl.exe -sS -X POST "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/photo_extract_openai_b64" `
  -H "content-type: application/json" `
  -d "{\"filename\":\"test.png\",\"mime\":\"image/png\",\"data_b64\":\"iVBORw0...base64...\"}"
```

### Echo Stub (Test UI Population)
```powershell
# Quick test to verify UI population works
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/echo_stub"
```

## Acceptance Checklist

### ✅ Load Demo DRF
- [ ] Click "Load Demo DRF" button
- [ ] Verify 6 rows fill instantly (Cosmic Connection, Dancing On Air, Double Up Larry, Gruit, Mr. Impatient, Shannonia)
- [ ] Click "Analyze Photos with AI"
- [ ] Verify predictions ONLY reference these 6 horses (no off-list names)

### ✅ Extract by URL
- [ ] Paste a direct PNG/JPG URL into the debug input
- [ ] Click "Extract (URL)"
- [ ] Console shows `📥 Raw OCR response: {...}`
- [ ] If horses[] present, all rows fill automatically
- [ ] If horses[] empty, alert shows exact server JSON

### ✅ Extract from Photos (B64)
- [ ] Upload a DRF table screenshot
- [ ] Click "Extract from Photos" or auto-extracts
- [ ] Console shows `📥 Raw OCR response: {...}`
- [ ] If horses[] empty, shows exact payload for prompt iteration

### ✅ Server Validation
- [ ] No SSO/HTML responses (only JSON)
- [ ] CORS headers present
- [ ] All endpoints return 200 with proper JSON
- [ ] Timeout budget = 30s (no 504s)

## Expected Console Output

### Successful OCR
```
📤 Uploading for OCR (b64): race-table.png image/png
📥 Raw OCR response: {"horses":[{"name":"Cosmic Connection","odds":"6/1",...},...]}
✅ Parsed 8 horses
[FinishLine] populateFormFromParsed: 8 horses
[FinishLine] populateFormFromParsed: wrote 8 rows
```

### Failed OCR (Empty)
```
📥 Raw OCR response: {"horses":[]}
⚠️ No horses parsed from OCR
Alert: "No horses parsed.\nServer response:\n{...full JSON...}"
```

### Demo Load
```
🧪 Loading demo DRF list [6 horses]
[FinishLine] populateFormFromParsed: 6 horses
[FinishLine] populateFormFromParsed: wrote 6 rows
```

## Browser Dev Tools Steps

1. **Open DevTools** (F12)
2. **Go to Console tab**
3. **Test each flow** and verify emojis show up (📤📥✅❌⚠️🧪🌐)
4. **Copy raw JSON** if OCR fails
5. **Paste here** for prompt tuning

## Environment Variables (Vercel)

Required for OCR:
```
FINISHLINE_OPENAI_API_KEY=sk-...
FINISHLINE_OCR_ENABLED=true
FINISHLINE_OPENAI_MODEL=gpt-4o-mini
```

Optional for research:
```
FINISHLINE_DATA_PROVIDER=websearch
FINISHLINE_TAVILY_API_KEY=tvly-...
```

