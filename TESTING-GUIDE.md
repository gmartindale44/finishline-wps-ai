# FinishLine WPS AI - Complete Testing Guide

## 🎯 What Was Deployed (Commit ae7f0be)

### Robust OCR → Form Population System
- ✅ Dynamic "Add Horse" button detection (works with multiple IDs/classes)
- ✅ Heuristic horse row detection (DIV-based or TR-based tables)
- ✅ Automatic row creation using real UI button
- ✅ Field mapping with fallbacks (name, odds, trainer, jockey, bankroll, kelly)
- ✅ Odds normalization (3-1 → 3/1, 5 to 2 → 5/2, etc.)
- ✅ Stringified JSON handling (server can return string or array)
- ✅ Raw payload alert for debugging
- ✅ Timing logs for performance analysis
- ✅ 25s hard timeout with guaranteed button reset

---

## 📋 Step-by-Step Testing Instructions

### **Step 1: Hard Refresh the App**
```
URL: https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app

Windows: Ctrl + Shift + R
Mac: Cmd + Shift + R
```
**Why:** Clears cached JavaScript and loads the latest version.

---

### **Step 2: Open Browser DevTools**
- Press **F12** (or Right-click → Inspect)
- Go to **Console** tab
- You should see: `[FinishLine] FinishLine AI initialized`

---

### **Step 3: Sanity Check - Echo Stub Test**

**In the Console, paste this command:**
```javascript
fetch('/api/finishline/echo_stub')
  .then(r => r.json())
  .then(d => {
    console.log('Echo stub returned:', d);
    populateFormFromParsed(d.horses);
  });
```

**Expected Result:**
```console
Echo stub returned: {horses: Array(3)}
📝 Wrote 3 rows to the form.
```

**What You Should See:**
- Form auto-fills with 3 horses:
  - Alpha (3/1)
  - Bravo (9/2)
  - Charlie (8/1)

**✅ If this works, the population path is confirmed working.**

---

### **Step 4: Extract from Photos Test**

1. **Click "Choose Photos / PDF"** (or similar button)
2. **Select your DRF-style race table screenshot**
3. **Click "Extract from Photos"**

**Expected Flow:**
```
Button changes to: "Extracting…" (disabled)
   ↓
Console shows timing logs:
   read_file: Xms
   fetch_ocr: Xms
   read_body: Xms
   ↓
Alert appears: "Server responded"
   RAW: {"horses":[...]}
   ↓
Click OK
   ↓
Console shows: "📝 Wrote N rows to the form."
   ↓
Form fills with ALL horses
   ↓
Button resets: "Extract from Photos" (enabled)
```

**Expected Console Output:**
```console
📤 OCR upload (b64): race-table.png image/png
read_file: 245.3ms
fetch_ocr: 8234.5ms
read_body: 12.1ms
📥 Raw OCR response: {"horses":[...]}
✅ Parsed 8 horses
📝 Wrote 8 rows to the form.
extract_total: 8491.9ms
```

---

## 🔍 **What to Look For**

### ✅ **Success Indicators**
- [ ] Button shows "Extracting…" while processing
- [ ] Alert shows RAW JSON with `"horses":[...]`
- [ ] Console shows `📝 Wrote N rows to the form.`
- [ ] Form fills with ALL horses (name, odds, trainer, jockey)
- [ ] Button resets within 25 seconds
- [ ] No JavaScript errors in console

### ❌ **Failure Indicators**
- [ ] Button gets stuck on "Extracting…" (should reset within 25s)
- [ ] Alert shows `"horses":[]` (no horses detected by OCR)
- [ ] Console shows "Add Horse button not found"
- [ ] Form doesn't fill even though `horses` array exists
- [ ] JavaScript errors in console

---

## 🐛 **Debugging Steps**

### **If No Horses Detected (Empty Array)**
```json
{"horses":[], "error": "..."}
```

**Action:** Copy the RAW JSON from the alert and paste it here.

**Why:** The OCR prompt may need tuning for your specific DRF layout.

---

### **If Horses Detected But Form Doesn't Fill**

**In Console, run these diagnostic commands:**

```javascript
// 1. Check if Add Horse button is found
findAddHorseButton()
// Expected: <button> element

// 2. Check current horse rows
getHorseRows()
// Expected: NodeList of row elements

// 3. Check first row's fields
const rows = getHorseRows();
pickRowFields(rows[0])
// Expected: {name: <input>, odds: <input>, ...}

// 4. Manually test population with stub data
fetch('/api/finishline/echo_stub')
  .then(r => r.json())
  .then(d => populateFormFromParsed(d.horses));
```

**Then report back:**
1. Which command failed?
2. What error message appeared?
3. Screenshot of the HTML structure (Right-click → Inspect on a horse input field)

---

### **If Button Gets Stuck**

**This should be impossible now, but if it happens:**

1. **Check Console for errors**
2. **Manually reset button:**
   ```javascript
   const btn = document.getElementById("btnExtract") || document.getElementById("btn-extract");
   btn.disabled = false;
   btn.textContent = "Extract from Photos";
   ```
3. **Report:** Screenshot of console + timing logs

---

## 📊 **Performance Benchmarks**

### **Normal Operation**
```
read_file:    100-500ms   (depends on image size)
fetch_ocr:    5,000-15,000ms (depends on image complexity)
read_body:    10-100ms    (usually <50ms)
extract_total: 5,000-16,000ms (total time)
```

### **Timeout Scenario**
```
read_file:    Xms
fetch_ocr:    25,000ms (aborted)
❌ Extract failed (timeout/network): AbortError
```

---

## 🎯 **Expected Behaviors**

### **Scenario 1: Successful OCR**
```
✅ Alert shows: {"horses":[8 horses with name/odds/trainer/jockey]}
✅ Console: "📝 Wrote 8 rows to the form."
✅ Form: All 8 rows filled with data
✅ Button: Resets immediately
```

### **Scenario 2: OCR Timeout**
```
⏱️ Button shows "Extracting…" for 25 seconds
❌ Alert: "Extraction failed: AbortError"
❌ Console: "❌ Extract failed (timeout/network)"
✅ Button: Resets at 25s mark
```

### **Scenario 3: Server Error**
```
⚠️ Alert: {"error":"Missing OpenAI API key env","horses":[]}
⚠️ Second alert: "OCR error: Missing OpenAI API key env"
✅ Button: Resets immediately (fast fail)
```

### **Scenario 4: No Horses Detected**
```
⚠️ Alert: {"horses":[]}
⚠️ Second alert: "No horses parsed.\n\n{...}"
✅ Button: Resets immediately
➡️ Action: Copy RAW JSON and share for OCR prompt tuning
```

---

## 🧪 **Additional Tests**

### **Test: Load Demo DRF**
1. Expand "OCR Debug" section
2. Click "Load Demo DRF"

**Expected:**
```console
🧪 Loading demo DRF list [6 horses]
📝 Wrote 6 rows to the form.
```

**Form fills with:**
- Cosmic Connection (6/1)
- Dancing On Air (10/1)
- Double Up Larry (5/2)
- Gruit (20/1)
- Mr. Impatient (7/2)
- Shannonia (6/5)

---

### **Test: Extract by URL**
1. Expand "OCR Debug" section
2. Paste a direct image URL (PNG/JPG of DRF table)
3. Click "Extract (URL)"

**Expected:** Same flow as file upload.

---

### **Test: Analyze Photos with AI**
1. After successful Extract (form has horses)
2. Fill in race context (track, date, etc.)
3. Click "Analyze Photos with AI"

**Expected:**
- Predictions ONLY from horses in the form
- No off-list suggestions

---

## 📝 **What to Report Back**

### **If Everything Works:**
```
✅ Echo stub test: PASS
✅ Extract from photos: PASS
✅ Form populated with N horses
✅ All fields filled (name, odds, trainer, jockey)
✅ Button resets properly
```

### **If Issues Occur:**
```
❌ Step that failed: [describe]
❌ Console errors: [paste]
❌ RAW JSON from alert: [paste]
❌ Screenshot of: [attach]
```

---

## 🚀 **Quick Health Checks**

### **PowerShell Commands**
```powershell
# Health check
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/health"

# Debug info
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/debug_info"

# Echo stub
curl.exe -sS "https://finishline-wps-ai-git-feat-ocr-form-canonical-hired-hive.vercel.app/api/finishline/echo_stub"
```

---

## 🎯 **SUCCESS CRITERIA**

Your app is working correctly when:

1. ✅ Echo stub fills 3 rows instantly
2. ✅ Extract shows RAW JSON alert
3. ✅ Console shows `📝 Wrote N rows to the form.`
4. ✅ Form fills with ALL horses from JSON
5. ✅ Button always resets (within 25s max)
6. ✅ No JavaScript errors in console
7. ✅ Analyze uses ONLY visible horses

**Ready to test! Open the app and follow the steps above.** 🎯

