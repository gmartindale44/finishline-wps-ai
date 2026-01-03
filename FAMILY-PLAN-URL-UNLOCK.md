# Family Plan URL Unlock Implementation

## Summary
Added support for `plan=family` to the existing URL unlock system without breaking current paid flows or adding new environment variables.

---

## Code Diff

### File: `public/js/paygate-helper.js`

**Location:** Lines 235-264 (in `checkUrlParams()` function)

**Changes:**
```diff
-      // Handle Stripe return
+      // Handle Stripe return and URL unlock params
       if (!unlocked && (success === '1' || paid === '1')) {
         let duration;
         let planName = null;
         if (plan === 'day') {
           duration = 24 * 60 * 60 * 1000; // 24 hours
           planName = 'day';
+        } else if (plan === 'family') {
+          duration = 180 * 24 * 60 * 60 * 1000; // 180 days
+          planName = 'family';
         } else {
           duration = 30 * 24 * 60 * 60 * 1000; // 30 days (default to Core)
           planName = 'core';
         }
         
-        // Paid unlocks don't require token version (not affected by token rotation)
+        // Paid unlocks (day/core) don't require token version (not affected by token rotation)
+        // Family plan requires token validation (handled separately via ?family=1&token=...)
+        // But if plan=family is used here, we still unlock (for URL-based family unlock)
         if (unlock(duration, planName, null)) {
           unlocked = true;
+          if (typeof console !== 'undefined' && console.log) {
+            const expiry = Date.now() + duration;
+            console.log('[PayGate] Unlocked via URL params:', {
+              plan: planName,
+              durationDays: Math.round(duration / (24 * 60 * 60 * 1000)),
+              expiry: new Date(expiry).toISOString(),
+              expiryTimestamp: expiry
+            });
+          }
         }
```

---

## Implementation Details

### Duration Mapping
- **day**: 24 hours (24 * 60 * 60 * 1000 ms)
- **core**: 30 days (30 * 24 * 60 * 60 * 1000 ms) - existing default
- **family**: 180 days (180 * 24 * 60 * 60 * 1000 ms) - **NEW**

### localStorage Structure
The `unlock()` function already stores:
```javascript
{
  expiry: Date.now() + durationMs,
  unlockedAt: Date.now(),
  durationMs: durationMs,
  plan: plan || null,  // 'day', 'core', or 'family'
  tokenVersion: tokenVersion || null
}
```

### Gating Logic
- `isUnlocked()` already checks `data.plan` and validates expiry
- `results-panel.js` already gates premium sections based on `isUnlocked()`
- Premium sections shown when `isUnlocked() === true`
- Fail-closed: errors default to locked state

---

## Test Checklist

### Prerequisites
- Open browser in **Incognito/Private mode**
- Open DevTools Console (F12)
- Clear localStorage before each test: `localStorage.clear()`

---

### Test 1: Day Plan (24 hours)
**URL:** `https://<PREVIEW-URL>/?paid=1&plan=day`

**Expected Results:**
- [ ] URL params are cleaned (no `?paid=1&plan=day` in address bar)
- [ ] Console shows: `[PayGate] Unlocked via URL params: { plan: 'day', durationDays: 1, expiry: '...', expiryTimestamp: ... }`
- [ ] Premium sections are VISIBLE (confidence %, strategy, exotics)
- [ ] localStorage `fl:paygate:access` contains:
  ```json
  {
    "plan": "day",
    "expiry": <timestamp ~24h from now>,
    "durationMs": 86400000
  }
  ```
- [ ] Console shows: `[PayGate] isUnlocked: true (valid access)`

---

### Test 2: Core Plan (30 days)
**URL:** `https://<PREVIEW-URL>/?paid=1&plan=core`

**Expected Results:**
- [ ] URL params are cleaned
- [ ] Console shows: `[PayGate] Unlocked via URL params: { plan: 'core', durationDays: 30, ... }`
- [ ] Premium sections are VISIBLE
- [ ] localStorage contains `plan: "core"` and `expiry` ~30 days from now
- [ ] Console shows: `[PayGate] isUnlocked: true (valid access)`

---

### Test 3: Family Plan (180 days) - NEW
**URL:** `https://<PREVIEW-URL>/?paid=1&plan=family`

**Expected Results:**
- [ ] URL params are cleaned
- [ ] Console shows: `[PayGate] Unlocked via URL params: { plan: 'family', durationDays: 180, ... }`
- [ ] Premium sections are VISIBLE
- [ ] localStorage contains `plan: "family"` and `expiry` ~180 days from now
- [ ] Console shows: `[PayGate] isUnlocked: true (valid access)`
- [ ] Note: Family plan via URL does NOT require token validation (unlike `?family=1&token=...`)

---

### Test 4: Default (no plan param)
**URL:** `https://<PREVIEW-URL>/?paid=1`

**Expected Results:**
- [ ] URL params are cleaned
- [ ] Console shows: `[PayGate] Unlocked via URL params: { plan: 'core', durationDays: 30, ... }`
- [ ] Premium sections are VISIBLE
- [ ] localStorage contains `plan: "core"` (default behavior preserved)

---

### Test 5: Fail-Closed Behavior
**URL:** `https://<PREVIEW-URL>/` (no unlock params)

**Expected Results:**
- [ ] Premium sections are HIDDEN
- [ ] Paygate UI is visible
- [ ] Console shows: `[PayGate] isUnlocked: false (no stored access)`
- [ ] localStorage does NOT contain `fl:paygate:access`

---

### Test 6: Expiry Validation
1. Unlock with day plan: `?paid=1&plan=day`
2. Manually set expiry in past:
   ```javascript
   const data = JSON.parse(localStorage.getItem('fl:paygate:access'));
   data.expiry = Date.now() - 1000;
   localStorage.setItem('fl:paygate:access', JSON.stringify(data));
   ```
3. Refresh page

**Expected Results:**
- [ ] Premium sections are HIDDEN (expired)
- [ ] Console shows: `[PayGate] isUnlocked: false (expired)`
- [ ] localStorage is cleared

---

## Verification Commands

### Check localStorage
```javascript
// In DevTools Console
JSON.parse(localStorage.getItem('fl:paygate:access'))
```

### Check expiry date
```javascript
// In DevTools Console
const data = JSON.parse(localStorage.getItem('fl:paygate:access'));
console.log('Expires:', new Date(data.expiry).toLocaleString());
console.log('Days remaining:', Math.round((data.expiry - Date.now()) / (24 * 60 * 60 * 1000)));
```

### Clear and retest
```javascript
// In DevTools Console
localStorage.clear();
location.reload();
```

---

## Notes

1. **No new env vars**: Uses existing `FAMILY_UNLOCK_TOKEN` only (not used for URL-based unlock)
2. **No breaking changes**: Existing `?paid=1&plan=day` and `?paid=1&plan=core` flows unchanged
3. **Fail-closed**: All errors default to locked state
4. **URL cleaning**: Params are removed after unlock (clean URLs)
5. **Console logs**: Added minimal logging to confirm plan and expiry

---

## Files Modified

- `public/js/paygate-helper.js` - Added `plan=family` support with 180-day duration

## Files NOT Modified (Already Support Plan)

- `public/js/paygate-helper.js` - `unlock()` function already stores `plan`
- `public/js/paygate-helper.js` - `isUnlocked()` already checks `plan` and expiry
- `public/js/results-panel.js` - Already gates premium sections based on `isUnlocked()`

---

**Status:** ✅ Ready for testing

