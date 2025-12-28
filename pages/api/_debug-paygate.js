// pages/api/_debug-paygate.js
// Debug endpoint to verify paygate token configuration

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  try {
    const token = process.env.FAMILY_UNLOCK_TOKEN || null;
    let tokenVersion = null;
    if (token) {
      tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
    }
    
    const familyUnlockDays = parseInt(process.env.FAMILY_UNLOCK_DAYS || '365', 10);
    
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      hasToken: token !== null,
      hasVersion: tokenVersion !== null,
      tokenVersionLength: tokenVersion ? tokenVersion.length : 0,
      familyUnlockDays,
      apiRouteWorking: true
    });
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      hasToken: false,
      hasVersion: false,
      error: err.message,
      apiRouteWorking: false
    });
  }
}

