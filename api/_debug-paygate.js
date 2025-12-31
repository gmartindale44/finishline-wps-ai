// Full handler implementation in root /api to ensure Vercel routing works correctly
// Debug endpoint to verify paygate token configuration

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set content type and cache control
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // Get token from environment variable (same source as pages/api version)
    const token = process.env.FAMILY_UNLOCK_TOKEN || null;
    let tokenVersion = null;
    if (token) {
      tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
    }
    
    // Get configurable family unlock duration (default 365 days, same as pages/api version)
    const familyUnlockDays = parseInt(process.env.FAMILY_UNLOCK_DAYS || '365', 10);
    
    res.status(200).json({
      ok: true,
      route: 'ROOT_API__DEBUG_PAYGATE_v1',
      apiRouteWorking: true,
      hasToken: token !== null,
      hasVersion: tokenVersion !== null,
      tokenVersionLength: tokenVersion ? tokenVersion.length : 0,
      familyUnlockDays
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      route: 'ROOT_API__DEBUG_PAYGATE_v1',
      hasToken: false,
      hasVersion: false,
      error: err.message,
      apiRouteWorking: false
    });
  }
}
