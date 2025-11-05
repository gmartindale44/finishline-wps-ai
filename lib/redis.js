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

// REST-based Redis helpers (for cron and simpler operations)
export function getRedisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

export async function redisGet(key) {
  const { url, token } = getRedisEnv();
  if (!url || !token) return null;
  const r = await fetch(`${url}/GET/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  return (await r.json())?.result ?? null;
}

export async function redisSet(key, value) {
  const { url, token } = getRedisEnv();
  if (!url || !token) return false;
  const r = await fetch(`${url}/SET/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return r.ok;
}

export async function redisHSet(key, obj) {
  const { url, token } = getRedisEnv();
  if (!url || !token) return false;
  const parts = Object.entries(obj).flatMap(([k,v]) => [k, typeof v==='string'?v:JSON.stringify(v)]);
  const path = `${url}/HSET/${encodeURIComponent(key)}/${parts.map(encodeURIComponent).join('/')}`;
  const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` }});
  return r.ok;
}

export async function redisHGetAll(key) {
  const { url, token } = getRedisEnv();
  if (!url || !token) return {};
  const r = await fetch(`${url}/HGETALL/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return {};
  const data = (await r.json())?.result ?? [];
  const out = {};
  for (let i=0; i<data.length; i+=2) out[data[i]] = data[i+1];
  return out;
}

export async function redisKeys(pattern) {
  const { url, token } = getRedisEnv();
  if (!url || !token) return [];
  const r = await fetch(`${url}/KEYS/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return [];
  return (await r.json())?.result ?? [];
}

