let _redisClient = null;
let _redisPromise = null;

export async function getRedis() {
  if (_redisClient) return _redisClient;
  if (_redisPromise) return _redisPromise;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  
  _redisPromise = (async () => {
    try {
      const { Redis } = await import('@upstash/redis');
      _redisClient = new Redis({ url, token });
      return _redisClient;
    } catch (e) {
      _redisPromise = null;
      return null;
    }
  })();
  
  return _redisPromise;
}

export async function redisPushSafe(key, value) {
  const r = await getRedis();
  if (!r) return false;
  try {
    await r.rpush(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function dayKey(prefix, d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${prefix}:${yyyy}-${mm}-${dd}`;
}

