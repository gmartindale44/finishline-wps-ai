// pages/api/debug-paygate.js
// Debug endpoint to verify paygate token configuration

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('X-Handler-Identity', 'DEBUG_PAYGATE_OK');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set headers with aggressive cache-busting
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('X-Handler-Identity', 'DEBUG_PAYGATE_OK');

  try {
    // Get token from environment variable (check multiple possible names for backward compatibility)
    const token = process.env.FAMILY_UNLOCK_TOKEN || process.env.FAMILY_PASS_TOKEN || null;
    let tokenVersion = null;
    if (token) {
      tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
    }
    
    // Get configurable family unlock duration (check multiple possible names)
    const familyUnlockDays = parseInt(
      process.env.FAMILY_UNLOCK_DAYS || 
      process.env.FAMILY_PASS_DAYS || 
      '365', 
      10
    );
    
    // Check for test mode (for Preview debugging only)
    const testModeEnvRaw = process.env.NEXT_PUBLIC_PAYGATE_TEST_MODE || process.env.PAYGATE_TEST_MODE || '';
    const testModeEnv = testModeEnvRaw.toLowerCase().trim();
    const testModeParsed = ['true', '1', 'yes', 'on'].includes(testModeEnv);
    
    res.status(200).json({
      ok: true,
      apiRouteWorking: true,
      handler: 'debug-paygate',
      hasToken: token !== null,
      tokenVersionLength: tokenVersion ? tokenVersion.length : 0,
      familyUnlockDays,
      testModeEnvRaw: testModeEnvRaw,
      testModeParsed: testModeParsed
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      apiRouteWorking: false,
      error: err.message
    });
  }
}
