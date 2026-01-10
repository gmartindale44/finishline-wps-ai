/**
 * Safe Redis fingerprint helper (NO secrets exposed)
 * Generates safe fingerprints for debugging Redis instance/namespace mismatches
 */

import crypto from 'crypto';

/**
 * Get safe Redis URL fingerprint (hostname only, no secrets)
 * @returns {string|null} - Last 6 chars of hostname or "missing"
 */
export function getRedisUrlFingerprint() {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    if (!url) return null;
    
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    // Use last 6 chars as fingerprint (safe, no secrets)
    return host.length > 6 ? host.slice(-6) : host;
  } catch {
    return null;
  }
}

/**
 * Get safe token fingerprint (hash of token, first 8 chars, NO full token)
 * @returns {string|null} - First 8 chars of SHA256 hash or "missing"
 */
export function getRedisTokenFingerprint() {
  try {
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!token) return null;
    
    // Hash the token (one-way, safe)
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    // Return first 8 chars of hash (safe, cannot reverse to token)
    return hash.slice(0, 8);
  } catch {
    return null;
  }
}

/**
 * Get environment fingerprint
 * @returns {string} - Combined env info
 */
export function getEnvFingerprint() {
  const vercelEnv = process.env.VERCEL_ENV || 'unknown';
  const nodeEnv = process.env.NODE_ENV || 'unknown';
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : 'local';
  return `${vercelEnv}-${nodeEnv}-${commitSha}`;
}

/**
 * Get complete Redis fingerprint object (safe, no secrets)
 * @returns {object} - Fingerprint object
 */
export function getRedisFingerprint() {
  return {
    urlFingerprint: getRedisUrlFingerprint(),
    tokenFingerprint: getRedisTokenFingerprint(),
    env: getEnvFingerprint(),
    configured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    urlHost: (() => {
      try {
        const url = process.env.UPSTASH_REDIS_REST_URL;
        if (!url) return null;
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })(),
    // Add deployment identifiers for debugging
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}
