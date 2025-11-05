export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return res.status(200).json({ ok:false, redis:"disabled", ts: Date.now() });
    
    // minimal ping via REST
    const r = await fetch(`${url}/GET/ping`, { headers: { Authorization: `Bearer ${token}` } });
    const ok = r.ok;
    return res.status(200).json({ ok, redis: ok ? "connected" : "unreachable", ts: Date.now() });
  } catch (e) {
    return res.status(200).json({ ok:false, redis:"error", error: String(e?.message || e), ts: Date.now() });
  }
}

