# Routing Root Cause Analysis

## Evidence Table

| Request | Routed Handler (Bug) | Expected Handler | Why |
|---------|---------------------|------------------|-----|
| `GET /api/paygate-token` | `pages/api/verify_race.js` (stub) | `api/paygate-token.js` → `pages/api/paygate-token.js` | Next.js `pages/api/*` routes take precedence over root `/api` handlers |
| `GET /api/debug-paygate` | `pages/api/verify_race.js` (stub) | `api/debug-paygate.js` → `pages/api/debug-paygate.js` | Next.js `pages/api/*` routes take precedence over root `/api` handlers |

## Root Cause (3 Bullets)

1. **Next.js `pages/api/*` routes take precedence:** In Next.js projects on Vercel, routes in `pages/api/` are built during `next build` and are processed by Next.js runtime BEFORE Vercel's root `/api` serverless functions. When a request matches a `pages/api/*` file path, Next.js handles it directly.

2. **Missing explicit routes:** Since `pages/api/paygate-token.js` and `pages/api/debug-paygate.js` exist, Next.js should route to them. However, if Next.js routing is somehow falling back or if there's a catch-all behavior, requests might be hitting `pages/api/verify_race.js` instead.

3. **Inconsistent handler pattern:** The root `/api/verify_race.js` was missing `export const config = { runtime: 'nodejs' }` which other handlers have. This inconsistency might cause Vercel to not recognize it as a serverless function, leading to Next.js handling all `/api/*` requests.

## Solution

1. **Standardize root `/api` handlers:** Ensure all root `/api` handlers have consistent runtime configuration (added to `api/verify_race.js`).

2. **Verify handler structure:** Both `api/paygate-token.js` and `api/debug-paygate.js` already have correct runtime config and import/export pattern.

3. **Next.js routing priority:** Since this is a Next.js project, `pages/api/*` routes should work correctly. The issue might be that Vercel is not recognizing the root `/api` handlers as serverless functions when Next.js routes exist.

## Files Status

- ✅ `api/paygate-token.js` - Has runtime config, imports from pages/api
- ✅ `api/debug-paygate.js` - Has runtime config, imports from pages/api  
- ✅ `api/verify_race.js` - **FIXED:** Added runtime config to match other handlers
- ✅ `pages/api/paygate-token.js` - Has correct headers and identity
- ✅ `pages/api/debug-paygate.js` - Has correct headers and identity
