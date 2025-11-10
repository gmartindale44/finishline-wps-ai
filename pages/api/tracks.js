import { Redis } from '@upstash/redis';

const TRACK_KEY = 'finishline:tracks:v1';
const TRACK_CACHE_TTL = 5 * 60 * 1000;
const QUERY_CACHE_TTL = 30 * 1000;

const norm = (s) =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();

let tracksCache = { data: null, expires: 0 };
let queryCache = new Map();
let redisClient = null;

function getRedis() {
  if (!redisClient) {
    redisClient = Redis.fromEnv();
  }
  return redisClient;
}

async function loadTracks() {
  const now = Date.now();
  if (tracksCache.data && tracksCache.expires > now) {
    return tracksCache.data;
  }

  try {
    const redis = getRedis();
    const raw = await redis.get(TRACK_KEY);
    let list = [];
    if (Array.isArray(raw)) {
      list = raw;
    } else if (typeof raw === 'string') {
      list = JSON.parse(raw);
    } else if (raw && typeof raw === 'object' && raw.data) {
      list = raw.data;
    }

    const prepared = Array.isArray(list)
      ? [...new Set(list.map((item) => (item || '').toString().trim()))]
          .filter(Boolean)
          .map((rawName) => ({ raw: rawName, n: norm(rawName) }))
      : [];

    tracksCache = {
      data: prepared,
      expires: now + TRACK_CACHE_TTL,
    };
    queryCache = new Map();
  } catch (error) {
    console.error('[tracks-api] Failed to load tracks from Redis:', error);
    tracksCache = { data: [], expires: now + TRACK_CACHE_TTL };
    queryCache = new Map();
  }

  return tracksCache.data;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const q = req.query.q ?? '';
  const normalizedQuery = norm(q);

  if (!normalizedQuery || normalizedQuery.length < 1) {
    return res.status(200).json([]);
  }

  const now = Date.now();
  const cached = queryCache.get(normalizedQuery);
  if (cached && cached.expires > now) {
    return res.status(200).json(cached.data);
  }

  const tracks = await loadTracks();
  if (!tracks.length) {
    queryCache.set(normalizedQuery, { data: [], expires: now + QUERY_CACHE_TTL });
    return res.status(200).json([]);
  }

  const results = tracks
    .map((item) => {
      const idx = item.n.indexOf(normalizedQuery);
      return {
        raw: item.raw,
        idx,
        len: item.raw.length,
      };
    })
    .filter((entry) => entry.idx > -1)
    .sort((a, b) => {
      if (a.idx !== b.idx) return a.idx - b.idx;
      if (a.len !== b.len) return a.len - b.len;
      return a.raw.localeCompare(b.raw);
    })
    .slice(0, 15)
    .map((entry) => entry.raw);

  queryCache.set(normalizedQuery, { data: results, expires: now + QUERY_CACHE_TTL });

  return res.status(200).json(results);
}

