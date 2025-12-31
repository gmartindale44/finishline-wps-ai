// pages/api/_debug-paygate.js
// Debug endpoint to verify paygate token configuration
// NOTE: This is the pages/api version (Next.js API route)

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Identity logging
  console.log("[DEBUG PAYGATE] handler= PAGES_API url=", req.url, "method=", req.method);
  
  // Set content type
  res.setHeader('Content-Type', 'application/json');
  // Identity header
  res.setHeader('X-Handler-Identity', 'DEBUG_PAYGATE_OK');

  try {
    const token = process.env.FAMILY_UNLOCK_TOKEN || null;
    let tokenVersion = null;
    if (token) {
      tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
    }
    
    const familyUnlockDays = parseInt(process.env.FAMILY_UNLOCK_DAYS || '365', 10);
    
    res.status(200).json({
      ok: true,
      apiRouteWorking: true,
      hasToken: token !== null,
      hasVersion: tokenVersion !== null,
      tokenVersionLength: tokenVersion ? tokenVersion.length : 0,
      familyUnlockDays
    });
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      ok: false,
      hasToken: false,
      hasVersion: false,
      error: err.message,
      apiRouteWorking: false
    });
  }
}
