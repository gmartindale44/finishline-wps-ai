// pages/api/paygate-token.js
// Returns a JavaScript file that sets the family unlock token from env var
// This works for static HTML files that can't use Next.js _document.js

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Set content type to JavaScript
  res.setHeader('Content-Type', 'application/javascript');
  
  // Get token from environment variable
  const token = process.env.FAMILY_UNLOCK_TOKEN || null;
  
  // Get configurable family unlock duration (default 365 days)
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
  
  // Cache for 5 minutes (token changes require redeploy anyway)
  res.setHeader('Cache-Control', 'public, max-age=300');
  
  res.status(200).send(js);
}

