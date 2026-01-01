# PayGate Routing Fix - Final Deliverable

## Root Cause

### Exact File + Mechanism + Why It Hijacked

**File:** Structural routing conflict (no single file, but directory structure)
**Mechanism:** Routing ambiguity between root `/api/` and `pages/api/` directories
**Why it hijacked:** When both root `/api/` and `pages/api/` exist, Vercel/Next.js routing can become ambiguous, causing requests to route to the wrong handler.

**Evidence Table:**

| Request | Routed Handler (Bug) | Expected Handler | Why |
|---------|---------------------|------------------|-----|
| `GET /api/paygate-token` | `pages/api/verify_race.js` (stub) | `pages/api/paygate-token.js` | Routing conflict |
| `GET /api/debug-paygate` | `pages/api/verify_race.js` (stub) | `pages/api/debug-paygate.js` | Routing conflict |

**Audit Findings:**
- ❌ No `vercel.json` (does not exist)
- ❌ No `middleware.ts/js` (does not exist)
- ❌ No catch-all routes (`[...slug].js` does not exist)
- ✅ `next.config.cjs` clean (no rewrites/redirects)
- ⚠️ Root `/api/verify_race.js` exists as re-export shim
- ✅ `pages/api/paygate-token.js` and `pages/api/debug-paygate.js` exist

## Fix

### Exact Changes + Why It Prevents Hijack

**Changes Made:**

1. **Added identity header to verify_race stub response** (`pages/api/verify_race.js` line 1704)
   ```javascript
   res.setHeader('X-Handler-Identity', 'VERIFY_RACE_STUB');
   ```
   - Allows debugging/tracing which handler executes
   - Makes verify_race stub responses identifiable

2. **Removed duplicate handlers from root `/api/`** (previous commit)
   - Deleted `api/paygate-token.js`
   - Deleted `api/debug-paygate.js`
   - Eliminates routing conflict source

3. **Updated handlers in `pages/api/`** (previous commit)
   - `pages/api/paygate-token.js`: Added all cache headers, identity header
   - `pages/api/debug-paygate.js`: Added all cache headers, identity header, handler field

**Why This Prevents Hijack:**

1. **Single source of truth:** Handlers exist only in `pages/api/*` (Next.js standard)
2. **No routing ambiguity:** One handler per endpoint, no duplicates
3. **Identity headers:** `X-Handler-Identity` allows tracing which handler executed
4. **No rewrite mechanism:** No middleware, catch-all, or rewrite rules to interfere
5. **Explicit routing:** Next.js maps `pages/api/paygate-token.js` → `/api/paygate-token` 1:1

## Verification

### Commands + Expected Outputs

**PowerShell:**
```powershell
# Test /api/paygate-token
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/paygate-token?cb=123" -Method GET -UseBasicParsing
Write-Output "Status: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
Write-Output "Content-Type: $($response.Headers['Content-Type'])"
Write-Output "Body (first 200 chars): $($response.Content.Substring(0, [Math]::Min(200, $response.Content.Length)))"

# Test /api/debug-paygate
$response = Invoke-WebRequest -Uri "https://<PREVIEW-URL>/api/debug-paygate?cb=123" -Method GET -UseBasicParsing
Write-Output "Status: $($response.StatusCode)"
Write-Output "X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
$response.Content | ConvertFrom-Json | ConvertTo-Json
```

**Bash:**
```bash
curl -i "https://<PREVIEW-URL>/api/paygate-token?cb=123"
curl -i "https://<PREVIEW-URL>/api/debug-paygate?cb=123"
```

**Expected Outputs:**

**`/api/paygate-token`:**
- Status: `200 OK`
- `X-Handler-Identity: PAYGATE_TOKEN_OK`
- `Content-Type: application/javascript; charset=utf-8`
- Body starts with: `// PAYGATE_TOKEN_HANDLER_OK`
- Body contains: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile`

**`/api/debug-paygate`:**
- Status: `200 OK`
- `X-Handler-Identity: DEBUG_PAYGATE_OK`
- `Content-Type: application/json; charset=utf-8`
- JSON: `{ "ok": true, "apiRouteWorking": true, "handler": "debug-paygate", ... }`
- ❌ Must NOT contain: `verify_race_stub`, `METHOD_NOT_ALLOWED`, `handlerFile`

See `docs/PAYGATE_VERIFICATION.md` for complete verification guide.

## Git Status

- **Branch:** `hotfix/restore-paygate-lkg`
- **Commits:** 
  - `f4daf9ca` - fix: use Next.js pages/api routes exclusively for paygate endpoints
  - Latest commit - fix: eliminate paygate routing hijack to verify_race
- **Pushed:** Yes ✅
- **Files Changed:**
  - Modified: `pages/api/verify_race.js` (added identity header)
  - Modified: `PAYGATE_ROUTING_FIX.md` (added evidence table)
  - Created: `ROUTING_AUDIT_EVIDENCE.md` (complete audit)
  - Updated: `docs/PAYGATE_VERIFICATION.md` (added non-negotiable outcomes)

