// api/debug-paygate.js
// Vercel serverless function handler for /api/debug-paygate
// This is the canonical handler (Vercel prioritizes root /api over pages/api)

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
  res.setHeader('X-Handler-Identity', 'DEBUG_PAYGATE_OK');

  try {
    // Get token/version from environment variable (check multiple possible names for backward compatibility)
    // Priority: Pre-computed version env vars > raw token env vars > client-side fallback
    const tokenVersionEnv = process.env.FL_FAMILY_UNLOCK_TOKEN_VERSION || 
                            process.env.FAMILY_UNLOCK_TOKEN_VERSION;
    const rawToken = process.env.FAMILY_UNLOCK_TOKEN || 
                     process.env.FAMILY_PASS_TOKEN;
    const token = tokenVersionEnv || rawToken || 
                  (typeof process.env.NEXT_PUBLIC_FL_FAMILY_UNLOCK_TOKEN_VERSION !== 'undefined' 
                    ? process.env.NEXT_PUBLIC_FL_FAMILY_UNLOCK_TOKEN_VERSION 
                    : null);
    
    let tokenVersion = null;
    if (tokenVersionEnv) {
      // Use pre-computed version directly (already a hash)
      tokenVersion = tokenVersionEnv.slice(0, 12);
    } else if (token) {
      // Hash the raw token to get version
      tokenVersion = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
    }
    
    // Get configurable family unlock duration (check multiple possible names)
    const familyUnlockDays = parseInt(
      process.env.FL_FAMILY_UNLOCK_DAYS ||
      process.env.FAMILY_UNLOCK_DAYS || 
      process.env.FAMILY_PASS_DAYS || 
      '365', 
      10
    );
    
    res.status(200).json({
      ok: true,
      apiRouteWorking: true,
      hasVersion: tokenVersion !== null,
      tokenVersionLength: tokenVersion ? tokenVersion.length : 0,
      familyUnlockDays
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      apiRouteWorking: false,
      error: err.message
    });
  }
}
