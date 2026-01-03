// pages/api/paygate/issue-cookie.js
// Endpoint to issue server-side access cookie after unlock
// Called by frontend after successful unlock (family token or Stripe success)

import { issueAccessCookie } from '../../../lib/paygate-server.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { plan, durationMs, tokenVersion } = body;
    
    // Validate required fields
    if (!plan || !durationMs) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields: plan, durationMs' 
      });
    }
    
    // Validate plan
    const validPlans = ['day', 'core', 'family'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ 
        ok: false, 
        error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` 
      });
    }
    
    // Validate duration (max 1 year)
    const maxDuration = 365 * 24 * 60 * 60 * 1000;
    const duration = Math.min(Math.max(Number(durationMs), 0), maxDuration);
    
    // Issue cookie
    const payload = issueAccessCookie(res, {
      plan,
      durationMs: duration,
      tokenVersion: tokenVersion || null
    });
    
    return res.status(200).json({
      ok: true,
      plan: payload.plan,
      expiry: payload.expiry,
      issued_at: payload.issued_at
    });
  } catch (err) {
    console.error('[paygate/issue-cookie] Error:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error'
    });
  }
}

