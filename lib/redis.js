// lib/redis.js - REST-based Redis client (diagnosable + safe)

/**
 * Get Redis environment variables
 * @returns {{url: string|null, token: string|null}}
 */
function getRedisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url: url || null, token: token || null };
}

/**
 * Ping Redis
 * @returns {Promise<boolean>}
 * @throws {Error} If Redis is unreachable
 */
export async function ping() {
  const { url, token } = getRedisEnv();
  if (!url || !token) {
    throw new Error('redis_unreachable: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  
  try {
    const r = await fetch(`${url}/GET/ping`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(`redis_unreachable: ${detail}`);
    }
    
    return true;
  } catch (e) {
    if (e.message && e.message.includes('redis_unreachable')) throw e;
    throw new Error(`redis_unreachable: ${String(e?.message || e)}`);
  }
}

/**
 * HSET - Set hash fields
 * @param {string} key - Redis key
 * @param {Object} map - Hash fields
 * @returns {Promise<boolean>}
 * @throws {Error} If Redis operation fails
 */
export async function hset(key, map) {
  const { url, token } = getRedisEnv();
  if (!url || !token) {
    throw new Error('redis_unreachable: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  
  const parts = Object.entries(map).flatMap(([k, v]) => [
    k,
    typeof v === 'string' ? v : JSON.stringify(v)
  ]);
  
  const path = `${url}/HSET/${encodeURIComponent(key)}/${parts.map(encodeURIComponent).join('/')}`;
  
  try {
    const r = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(`redis_unreachable: ${detail}`);
    }
    
    return true;
  } catch (e) {
    if (e.message && e.message.includes('redis_unreachable')) throw e;
    throw new Error(`redis_unreachable: ${String(e?.message || e)}`);
  }
}

/**
 * HGETALL - Get all hash fields
 * @param {string} key - Redis key
 * @returns {Promise<Object>}
 * @throws {Error} If Redis operation fails
 */
export async function hgetall(key) {
  const { url, token } = getRedisEnv();
  if (!url || !token) {
    throw new Error('redis_unreachable: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  
  try {
    const r = await fetch(`${url}/HGETALL/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(`redis_unreachable: ${detail}`);
    }
    
    const data = (await r.json())?.result ?? [];
    const out = {};
    for (let i = 0; i < data.length; i += 2) {
      out[data[i]] = data[i + 1];
    }
    return out;
  } catch (e) {
    if (e.message && e.message.includes('redis_unreachable')) throw e;
    throw new Error(`redis_unreachable: ${String(e?.message || e)}`);
  }
}

/**
 * KEYS - Get keys matching pattern
 * @param {string} pattern - Key pattern (e.g., "fl:pred:*")
 * @returns {Promise<string[]>}
 * @throws {Error} If Redis operation fails
 */
export async function keys(pattern) {
  const { url, token } = getRedisEnv();
  if (!url || !token) {
    throw new Error('redis_unreachable: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  
  try {
    const r = await fetch(`${url}/KEYS/${encodeURIComponent(pattern)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(`redis_unreachable: ${detail}`);
    }
    
    return (await r.json())?.result ?? [];
  } catch (e) {
    if (e.message && e.message.includes('redis_unreachable')) throw e;
    throw new Error(`redis_unreachable: ${String(e?.message || e)}`);
  }
}

/**
 * SET - Set string value
 * @param {string} key - Redis key
 * @param {string} value - Value
 * @returns {Promise<boolean>}
 * @throws {Error} If Redis operation fails
 */
export async function set(key, value) {
  const { url, token } = getRedisEnv();
  if (!url || !token) {
    throw new Error('redis_unreachable: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  
  try {
    const r = await fetch(`${url}/SET/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(`redis_unreachable: ${detail}`);
    }
    
    return true;
  } catch (e) {
    if (e.message && e.message.includes('redis_unreachable')) throw e;
    throw new Error(`redis_unreachable: ${String(e?.message || e)}`);
  }
}

/**
 * GET - Get string value
 * @param {string} key - Redis key
 * @returns {Promise<string|null>}
 * @throws {Error} If Redis operation fails
 */
export async function get(key) {
  const { url, token } = getRedisEnv();
  if (!url || !token) {
    throw new Error('redis_unreachable: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  
  try {
    const r = await fetch(`${url}/GET/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(`redis_unreachable: ${detail}`);
    }
    
    return (await r.json())?.result ?? null;
  } catch (e) {
    if (e.message && e.message.includes('redis_unreachable')) throw e;
    throw new Error(`redis_unreachable: ${String(e?.message || e)}`);
  }
}

/**
 * SETEX - Set string value with expiration (TTL in seconds)
 * @param {string} key - Redis key
 * @param {number} seconds - TTL in seconds
 * @param {string} value - Value
 * @returns {Promise<boolean>}
 * @throws {Error} If Redis operation fails
 */
export async function setex(key, seconds, value) {
  const { url, token } = getRedisEnv();
  if (!url || !token) {
    throw new Error('redis_unreachable: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }
  
  try {
    const r = await fetch(`${url}/SETEX/${encodeURIComponent(key)}/${seconds}/${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(`redis_unreachable: ${detail}`);
    }
    
    return true;
  } catch (e) {
    if (e.message && e.message.includes('redis_unreachable')) throw e;
    throw new Error(`redis_unreachable: ${String(e?.message || e)}`);
  }
}

// Legacy exports for backward compatibility
export async function redisHSet(key, obj) {
  return hset(key, obj);
}

export async function redisHGetAll(key) {
  return hgetall(key);
}

export async function redisKeys(pattern) {
  return keys(pattern);
}

export async function redisSet(key, value) {
  return set(key, value);
}

export async function redisGet(key) {
  return get(key);
}

// Day key helper (for predictions logging)
export function dayKey(prefix, d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${prefix}:${yyyy}-${mm}-${dd}`;
}

// Fire-and-forget push (for backward compatibility)
export async function redisPushSafe(key, value) {
  try {
    const { url, token } = getRedisEnv();
    if (!url || !token) return false;
    
    // Use RPUSH if available, otherwise fall back to SET
    const r = await fetch(`${url}/RPUSH/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return r.ok;
  } catch {
    return false;
  }
}
