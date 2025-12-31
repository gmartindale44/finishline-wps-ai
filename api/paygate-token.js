// PAYGATE_TOKEN_HANDLER_ROOT_API_v1
// Full handler implementation in root /api to ensure Vercel routing works correctly
// Returns JavaScript that sets family unlock token version from env var

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set content type to JavaScript with charset
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // Use no-store to avoid caching issues
  res.setHeader('Cache-Control', 'no-store');
  
  // Get token from environment variable (same source as pages/api version)
  const token = process.env.FAMILY_UNLOCK_TOKEN || null;
  
  // Get configurable family unlock duration (default 365 days, same as pages/api version)
  const familyUnlockDays = parseInt(process.env.FAMILY_UNLOCK_DAYS || '365', 10);
  
  // Compute token version (first 12 chars of SHA-256 hash, safe to expose)
  let tokenVersion = null;
  if (token) {
    tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  }
  
  // Return JavaScript that sets window variables (DO NOT expose raw token)
  // Only expose tokenVersion (safe hash) and familyUnlockDays
  const js = `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = ${JSON.stringify(tokenVersion)};
window.__FL_FAMILY_UNLOCK_DAYS__ = ${familyUnlockDays};
console.log('[PayGate] Token script loaded:', { hasTokenVersion: ${tokenVersion !== null}, familyUnlockDays: ${familyUnlockDays} });`;
  
  res.status(200).send(js);
}
