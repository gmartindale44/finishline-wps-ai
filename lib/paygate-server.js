// lib/paygate-server.js
// Server-side PayGate utilities for cookie issuance and validation
// Used by middleware and unlock endpoints

import crypto from 'node:crypto';

const COOKIE_NAME = 'fl_paygate_token';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year max (for family plan)

/**
 * Get server-side enforcement flag
 * @returns {boolean} true if enforcement is enabled, false for monitor mode
 */
export function isServerEnforcementEnabled() {
  const enforce = process.env.PAYGATE_SERVER_ENFORCE || '0';
  return enforce === '1' || enforce === 'true';
}

/**
 * Get HMAC secret for signing tokens
 * Falls back to FAMILY_UNLOCK_TOKEN if PAYGATE_COOKIE_SECRET not set
 */
function getCookieSecret() {
  return process.env.PAYGATE_COOKIE_SECRET || 
         process.env.FAMILY_UNLOCK_TOKEN || 
         'default-secret-change-in-production';
}

/**
 * Sign a token payload
 * @param {object} payload - { plan, expiry, issued_at, token_version }
 * @returns {string} Signed token (base64 encoded)
 */
export function signToken(payload) {
  const secret = getCookieSecret();
  const payloadStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadStr);
  const signature = hmac.digest('hex');
  // Format: base64(payload) + '.' + signature
  const encoded = Buffer.from(payloadStr).toString('base64url');
  return `${encoded}.${signature}`;
}

/**
 * Verify and parse a signed token
 * @param {string} token - Signed token string
 * @returns {object|null} Parsed payload or null if invalid
 */
export function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    
    const [encoded, signature] = parts;
    const payloadStr = Buffer.from(encoded, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadStr);
    
    // Verify signature
    const secret = getCookieSecret();
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadStr);
    const expectedSig = hmac.digest('hex');
    
    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    )) {
      return null; // Invalid signature
    }
    
    // Check expiry
    if (payload.expiry && payload.expiry < Date.now()) {
      return null; // Expired
    }
    
    return payload;
  } catch (err) {
    return null; // Invalid token format
  }
}

/**
 * Issue a server-side access cookie
 * @param {object} res - Next.js response object
 * @param {object} options - { plan, durationMs, tokenVersion }
 */
export function issueAccessCookie(res, options) {
  const { plan, durationMs, tokenVersion } = options;
  
  const now = Date.now();
  const expiry = now + durationMs;
  
  const payload = {
    plan: plan || 'core',
    expiry,
    issued_at: now,
    token_version: tokenVersion || null
  };
  
  const token = signToken(payload);
  
  // Set httpOnly, Secure cookie (Secure only in production)
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${Math.floor(durationMs / 1000)}`,
    'Path=/',
    'SameSite=Lax',
    'HttpOnly'
  ];
  
  if (isProduction) {
    cookieOptions.push('Secure');
  }
  
  res.setHeader('Set-Cookie', cookieOptions.join('; '));
  
  return payload;
}

/**
 * Read and validate access cookie from request
 * @param {object} req - Next.js request object
 * @returns {object|null} Parsed payload or null if invalid/missing
 */
export function readAccessCookie(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(`(^|; )${COOKIE_NAME}=([^;]+)`));
  
  if (!match) return null;
  
  const token = match[2];
  return verifyToken(token);
}

/**
 * Clear access cookie
 * @param {object} res - Next.js response object
 */
export function clearAccessCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

/**
 * Check if a route is a premium API endpoint
 * @param {string} pathname - Request pathname
 * @returns {boolean}
 */
export function isPremiumApiRoute(pathname) {
  const premiumRoutes = [
    '/api/predict_wps',
    '/api/photo_extract_openai_b64',
    '/api/verify_race',
    '/api/green_zone',
    '/api/calibration_status',
    '/api/greenzone_today',
    '/api/verify_backfill',
    '/api/calibration/summary'
  ];
  
  return premiumRoutes.some(route => pathname.startsWith(route));
}

/**
 * Check PayGate access for API route handler
 * Call this at the start of premium API route handlers
 * @param {object} req - Next.js request object
 * @returns {object} { allowed: boolean, cookieData: object|null, reason: string }
 */
export function checkPayGateAccess(req) {
  const serverEnforce = isServerEnforcementEnabled();
  const cookieData = readAccessCookie(req);
  const now = Date.now();
  
  // Monitor mode: log but allow
  if (!serverEnforce) {
    const hasValidCookie = cookieData !== null && cookieData.expiry > now;
    console.log(`[PayGate] MONITOR MODE: ${req.url} - cookie_valid: ${hasValidCookie}, plan: ${cookieData?.plan || 'none'}`);
    return {
      allowed: true,
      cookieData,
      reason: 'monitor_mode'
    };
  }
  
  // Enforcement mode: require valid cookie
  if (!cookieData) {
    console.warn(`[PayGate] BLOCKED: ${req.url} - missing cookie`);
    return {
      allowed: false,
      cookieData: null,
      reason: 'missing_cookie'
    };
  }
  
  if (cookieData.expiry <= now) {
    console.warn(`[PayGate] BLOCKED: ${req.url} - expired cookie`);
    return {
      allowed: false,
      cookieData,
      reason: 'expired_cookie'
    };
  }
  
  // Valid cookie present
  console.log(`[PayGate] ALLOWED: ${req.url} - plan: ${cookieData.plan}, expires: ${new Date(cookieData.expiry).toISOString()}`);
  return {
    allowed: true,
    cookieData,
    reason: 'valid_cookie'
  };
}

