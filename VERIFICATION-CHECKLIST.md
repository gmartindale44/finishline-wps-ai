# PayGate Routing Fix - Verification Checklist

## Quick Vercel UI Checklist

### 1. Functions List
- [ ] Go to Vercel Dashboard → Project → Functions
- [ ] Confirm `/api/paygate-token` appears in the list
- [ ] Confirm `/api/debug-paygate` appears in the list
- [ ] Both show `Runtime: Node.js`

### 2. Test Endpoints

**Test 1: `/api/paygate-token`**
```bash
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"
```

**Check:**
- [ ] Status: `200 OK`
- [ ] Header: `X-Handler-Identity: PAYGATE_TOKEN_OK`
- [ ] Header: `Content-Type: application/javascript; charset=utf-8`
- [ ] Header: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- [ ] Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- [ ] Body contains: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`
- [ ] Does NOT contain: JSON, `verify_race_stub`, `METHOD_NOT_ALLOWED`

**Test 2: `/api/debug-paygate`**
```bash
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

**Check:**
- [ ] Status: `200 OK`
- [ ] Header: `X-Handler-Identity: DEBUG_PAYGATE_OK`
- [ ] Header: `Content-Type: application/json; charset=utf-8`
- [ ] Header: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
- [ ] JSON contains: `"ok": true`
- [ ] JSON contains: `"apiRouteWorking": true`
- [ ] JSON contains: `"hasVersion": boolean`
- [ ] JSON contains: `"tokenVersionLength": number`
- [ ] Does NOT contain: `"step": "verify_race_stub"`
- [ ] Does NOT contain: `"handlerFile": "pages/api/verify_race.js"`

### 3. Function Logs

- [ ] Go to Vercel Dashboard → Project → Functions → View Logs
- [ ] Make requests to `/api/paygate-token` and `/api/debug-paygate`
- [ ] Should see: Function invocations for these endpoints
- [ ] Should NOT see: Logs showing `verify_race` handler being called for paygate endpoints

### 4. Verify Other Endpoints

```bash
# verify_race should still work (POST only)
curl -i -X POST "https://<PREVIEW-URL>/api/verify_race" \
  -H "Content-Type: application/json" \
  -d '{"track":"Test Track"}'
```

- [ ] Returns verify result (not verify_race_stub) for POST requests
- [ ] GET still returns verify_race_stub (expected behavior)

## Expected curl Outputs

### Test 1: `/api/paygate-token`
```
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
X-Handler-Identity: PAYGATE_TOKEN_OK

// PAYGATE_TOKEN_HANDLER_OK
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = "...";
window.__FL_FAMILY_UNLOCK_DAYS__ = 365;
console.log('[PayGate] Token script loaded:', { hasTokenVersion: true, familyUnlockDays: 365 });
```

### Test 2: `/api/debug-paygate`
```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
Pragma: no-cache
Expires: 0
X-Handler-Identity: DEBUG_PAYGATE_OK

{
  "ok": true,
  "apiRouteWorking": true,
  "hasVersion": true,
  "tokenVersionLength": 12,
  "familyUnlockDays": 365
}
```

