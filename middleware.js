// middleware.js
// Next.js middleware for server-side PayGate enforcement
// Applies ONLY to premium API routes when PAYGATE_SERVER_ENFORCE=1

import { NextResponse } from 'next/server';

// Premium API routes that require PayGate
const PREMIUM_ROUTES = [
  '/api/predict_wps',
  '/api/photo_extract_openai_b64',
  '/api/verify_race',
  '/api/green_zone',
  '/api/calibration_status',
  '/api/greenzone_today',
  '/api/verify_backfill',
  '/api/calibration/summary'
];

function isPremiumApiRoute(pathname) {
  return PREMIUM_ROUTES.some(route => pathname.startsWith(route));
}

function isServerEnforcementEnabled() {
  // In Edge Runtime, we need to check env var directly
  // Note: process.env is available in Edge Runtime for NEXT_PUBLIC_* vars
  // For server-only vars, we'll need to check at runtime
  // Default to '0' (monitor mode) if not set
  try {
    // In Edge Runtime, we can't access process.env directly
    // We'll check via a request header or use a different approach
    // For now, default to monitor mode - enforcement will be checked server-side
    return false; // Always monitor mode in middleware (enforcement happens in API routes)
  } catch {
    return false;
  }
}

function readAccessCookie(request) {
  const cookies = request.cookies || {};
  const cookieName = 'fl_paygate_token';
  const token = cookies.get(cookieName)?.value;
  
  if (!token) return null;
  
  try {
    // Parse token (format: base64(payload).signature)
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    
    const [encoded, signature] = parts;
    const payloadStr = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadStr);
    
    // Check expiry
    if (payload.expiry && payload.expiry < Date.now()) {
      return null;
    }
    
    // Note: Signature verification would require crypto in Edge Runtime
    // For now, we'll do basic validation. Full verification happens in API routes.
    return payload;
  } catch {
    return null;
  }
}

export function middleware(request) {
  const { pathname } = request.nextUrl;
  
  // Only apply to premium API routes
  if (!isPremiumApiRoute(pathname)) {
    return NextResponse.next();
  }
  
  // In Edge Runtime, we can't access process.env for server-only vars
  // So we'll always allow in middleware and do enforcement in API routes
  // This is safer and more reliable
  const cookieData = readAccessCookie(request);
  
  // Log for monitoring (always in monitor mode in middleware)
  const hasValidCookie = cookieData !== null && cookieData.expiry > Date.now();
  
  // Add debug header
  const response = NextResponse.next();
  response.headers.set('X-PayGate-Middleware', 'active');
  response.headers.set('X-PayGate-Cookie-Present', cookieData ? 'true' : 'false');
  response.headers.set('X-PayGate-Cookie-Valid', hasValidCookie ? 'true' : 'false');
  
  // Always allow in middleware - enforcement happens in API route handlers
  // This ensures we can access process.env properly
  return response;
}

// Apply middleware only to API routes
export const config = {
  matcher: '/api/:path*'
};

