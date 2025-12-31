// pages/api/paygate-token.js
// Returns a JavaScript file that sets the family unlock token from env var
// This works for static HTML files that can't use Next.js _document.js

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('X-Handler-Identity', 'PAYGATE_TOKEN_OK');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set headers with aggressive cache-busting
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Handler-Identity', 'PAYGATE_TOKEN_OK');

  // Get token from environment variable (check multiple possible names for backward compatibility)
  const token = process.env.FAMILY_UNLOCK_TOKEN || process.env.FAMILY_PASS_TOKEN || null;
  
  // Get configurable family unlock duration (check multiple possible names)
  const familyUnlockDays = parseInt(
    process.env.FAMILY_UNLOCK_DAYS || 
    process.env.FAMILY_PASS_DAYS || 
    '365', 
    10
  );

  // Compute token version (first 12 chars of SHA-256 hash, safe to expose)
  let tokenVersion = null;
  if (token) {
    tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  }

  // Return JavaScript that sets window variables (DO NOT expose raw token)
  // Only expose tokenVersion (safe hash) and familyUnlockDays
  const js = `// PAYGATE_TOKEN_HANDLER_OK
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = ${JSON.stringify(tokenVersion || '')};
window.__FL_FAMILY_UNLOCK_DAYS__ = ${familyUnlockDays};
console.log('[PayGate] Token script loaded:', { hasTokenVersion: ${tokenVersion !== null}, familyUnlockDays: ${familyUnlockDays} });`;

  res.status(200).send(js);
}
