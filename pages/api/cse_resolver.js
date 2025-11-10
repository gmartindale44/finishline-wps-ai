import crypto from "node:crypto";

const CSE_URL = "https://www.googleapis.com/customsearch/v1";
const TTL_SECONDS = 60 * 60 * 24;

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(
  /^"+|"+$/g,
  ""
);
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").replace(
  /^"+|"+$/g,
  ""
);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || "";

function hashQuery(q) {
  return crypto.createHash("sha256").update(q).digest("hex").slice(0, 32);
}

async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/GET/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  try {
    const data = await res.json();
    const raw = data?.result;
    if (!raw || raw === "null") return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function redisSet(key, value, ttl) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const pipeline = [
    ["SET", key, JSON.stringify(value)],
    ["EXPIRE", key, String(ttl)],
  ];
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pipeline),
  });
  return res.ok;
}

export default async function handler(req, res) {
  try {
    const q = (req.query.q || "").toString().trim();
    if (!q) {
      return res
        .status(400)
        .json({ error: "Missing query ?q=<search terms>" });
    }

    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
      return res.status(500).json({
        error: "CSE not configured (missing GOOGLE_API_KEY or GOOGLE_CSE_ID)",
      });
    }

    const cacheKey = `cse:${hashQuery(q)}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, cache: "HIT" });
    }

    const url = `${CSE_URL}?key=${encodeURIComponent(
      GOOGLE_API_KEY
    )}&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&q=${encodeURIComponent(q)}`;
    const resp = await fetch(url, { cache: "no-store" });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Google CSE error ${resp.status}: ${text.slice(0, 512)}`);
    }

    const data = await resp.json();
    const results = Array.isArray(data.items)
      ? data.items.map((item) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          source: item.displayLink,
        }))
      : [];

    const payload = {
      query: q,
      count: results.length,
      results,
      ts: new Date().toISOString(),
      cache: "MISS",
    };

    try {
      await redisSet(cacheKey, payload, TTL_SECONDS);
    } catch (err) {
      console.warn("[/api/cse_resolver] cache write failed", err);
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("[/api/cse_resolver]", err);
    return res.status(500).json({
      error: "Failed to resolve query",
      details: err?.message || String(err),
    });
  }
}

