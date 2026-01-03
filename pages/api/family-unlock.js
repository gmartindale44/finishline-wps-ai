// pages/api/family-unlock.js
// Server-side token validation endpoint for family unlock
// Uses timing-safe comparison to prevent timing attacks

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // Always set JSON content type first (never return HTML)
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Parse request body (Next.js doesn't auto-parse JSON)
    let body = {};
    if (req.body) {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
    const { token } = body;
    
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ ok: false, error: 'Token required' });
    }

    const expectedToken = process.env.FAMILY_UNLOCK_TOKEN || null;
    
    if (!expectedToken) {
      return res.status(200).json({ ok: false, error: 'Family unlock not configured' });
    }

    // Timing-safe comparison to prevent timing attacks
    const providedHash = crypto.createHash('sha256').update(token).digest('hex');
    const expectedHash = crypto.createHash('sha256').update(expectedToken).digest('hex');
    
    // Use timingSafeEqual to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedHash),
      Buffer.from(expectedHash)
    );

    if (!isValid) {
      return res.status(200).json({ ok: false, error: 'Invalid token' });
    }

    // Compute token version (first 12 chars of SHA-256 hash)
    const tokenVersion = crypto.createHash('sha256').update(expectedToken).digest('hex').slice(0, 12);

    // Issue server-side access cookie (if server enforcement is enabled)
    try {
      const { issueAccessCookie } = await import('../../lib/paygate-server.js');
      const familyUnlockDays = parseInt(
        process.env.FAMILY_UNLOCK_DAYS || 
        process.env.FAMILY_PASS_DAYS || 
        '365', 
        10
      );
      const durationMs = familyUnlockDays * 24 * 60 * 60 * 1000;
      
      issueAccessCookie(res, {
        plan: 'family',
        durationMs,
        tokenVersion
      });
    } catch (cookieErr) {
      // Non-fatal: log but don't fail the unlock
      console.warn('[family-unlock] Failed to issue cookie (non-fatal):', cookieErr?.message);
    }

    return res.status(200).json({
      ok: true,
      tokenVersion
    });
  } catch (err) {
    // Always return JSON, even on errors
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error'
    });
  }
}

