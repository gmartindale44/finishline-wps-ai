// pages/api/paygate/status.js
// Debug endpoint to check server-side PayGate status
// Safe for Preview testing

import { isServerEnforcementEnabled, readAccessCookie } from '../../../lib/paygate-server.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const serverEnforce = isServerEnforcementEnabled();
    const cookieData = readAccessCookie(req);
    
    const now = Date.now();
    
    return res.status(200).json({
      ok: true,
      server_enforce: serverEnforce,
      cookie_present: cookieData !== null,
      cookie_valid: cookieData !== null && (cookieData.expiry > now),
      plan: cookieData?.plan || null,
      expiry: cookieData?.expiry || null,
      issued_at: cookieData?.issued_at || null,
      token_version: cookieData?.token_version || null,
      current_server_time: now,
      expires_in_seconds: cookieData ? Math.max(0, Math.floor((cookieData.expiry - now) / 1000)) : null
    });
  } catch (err) {
    console.error('[paygate/status] Error:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error'
    });
  }
}

