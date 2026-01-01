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
  res.setHeader('Surrogate-Control', 'no-store');
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

  // Check for test mode (OFF by default, only enabled via env var)
  // Accept: "true", "1", "yes", "on" (case-insensitive)
  const testModeEnvRaw = process.env.NEXT_PUBLIC_PAYGATE_TEST_MODE || process.env.PAYGATE_TEST_MODE || '';
  const testModeEnv = testModeEnvRaw.toLowerCase().trim();
  const testModeEnabled = ['true', '1', 'yes', 'on'].includes(testModeEnv);

  // Check for enforcement mode (OFF by default, only enabled via env var)
  // Accept: "true", "1", "yes", "on" (case-insensitive)
  const enforceEnvRaw = process.env.NEXT_PUBLIC_PAYGATE_ENFORCE || process.env.PAYGATE_ENFORCE || '';
  const enforceEnv = enforceEnvRaw.toLowerCase().trim();
  const enforceEnabled = ['true', '1', 'yes', 'on'].includes(enforceEnv);

  // Server-side debug logging
  console.log('[PayGate Token Handler] Config check:', {
    testModeEnvRaw: testModeEnvRaw,
    testModeEnvParsed: testModeEnv,
    testModeEnabled: testModeEnabled,
    enforceEnvRaw: enforceEnvRaw,
    enforceEnvParsed: enforceEnv,
    enforceEnabled: enforceEnabled,
    envVarPresent: {
      testMode: !!(process.env.NEXT_PUBLIC_PAYGATE_TEST_MODE || process.env.PAYGATE_TEST_MODE),
      enforce: !!(process.env.NEXT_PUBLIC_PAYGATE_ENFORCE || process.env.PAYGATE_ENFORCE)
    }
  });

  // Return JavaScript that sets window variables (DO NOT expose raw token)
  // Only expose tokenVersion (safe hash), familyUnlockDays, test mode, and enforce flag
  const js = `// PAYGATE_TOKEN_HANDLER_OK
window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = ${JSON.stringify(tokenVersion || '')};
window.__FL_FAMILY_UNLOCK_DAYS__ = ${familyUnlockDays};
window.__PAYGATE_TEST_MODE__ = ${testModeEnabled ? 'true' : 'false'};
window.__PAYGATE_TEST_MODE_ENV__ = ${JSON.stringify(testModeEnvRaw)};
window.__PAYGATE_ENFORCE__ = ${enforceEnabled ? 'true' : 'false'};
window.__PAYGATE_ENFORCE_ENV__ = ${JSON.stringify(enforceEnvRaw)};
console.log('[PayGate] Token script loaded:', { hasTokenVersion: ${tokenVersion !== null}, familyUnlockDays: ${familyUnlockDays}, testMode: ${testModeEnabled}, testModeEnvValue: ${JSON.stringify(testModeEnv)}, testModeEnvRaw: ${JSON.stringify(testModeEnvRaw)}, enforce: ${enforceEnabled}, enforceEnvValue: ${JSON.stringify(enforceEnv)}, enforceEnvRaw: ${JSON.stringify(enforceEnvRaw)} });`;


  res.status(200).send(js);
}
