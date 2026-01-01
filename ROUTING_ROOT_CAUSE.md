# Routing Root Cause Analysis

## Evidence Table

| Request | Routed Handler (Bug) | Expected Handler | Why |
|---------|---------------------|------------------|-----|
| `GET /api/paygate-token` | `pages/api/verify_race.js` (stub) | `api/paygate-token.js` → `pages/api/paygate-token.js` | Re-export shim may not be recognized by Vercel |
| `GET /api/debug-paygate` | `pages/api/verify_race.js` (stub) | `api/debug-paygate.js` → `pages/api/debug-paygate.js` | Re-export shim may not be recognized by Vercel |

## Root Cause

### Finding: Re-export Shims May Not Be Working

**Current State:**
- ✅ `api/paygate-token.js` exists (re-export shim: `export { default } from "../pages/api/paygate-token.js"`)
- ✅ `api/debug-paygate.js` exists (re-export shim: `export { default } from "../pages/api/debug-paygate.js"`)
- ✅ `api/verify_race.js` exists (re-export shim: `export { default } from "../pages/api/verify_race.js"`)

**Problem:**
Vercel may not be recognizing the re-export shims properly, or Next.js routing is intercepting `/api/*` requests before they reach the root `/api` handlers.

### Possible Causes

1. **Next.js Routing Priority:** Next.js `pages/api/` routes may be intercepting requests before Vercel's root `/api` handlers
2. **Re-export Shim Issue:** The ES module re-export syntax may not be properly recognized by Vercel's serverless function system
3. **Missing Runtime Config:** The re-export shims don't have `export const config = { runtime: 'nodejs' }` which other handlers have

### Solution

Convert re-export shims to full handlers that import and call the `pages/api` handlers, ensuring they have proper runtime configuration.

