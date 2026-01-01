import {
  FALLBACK_TRACKS,
  fetchTracksFromRedis,
  filterTracks,
} from '../lib/tracks.js';

export const config = { runtime: 'nodejs' };

const CACHE_TTL = 5 * 60 * 1000;

let cache = null;

async function getTracks() {
  const now = Date.now();
  if (cache && cache.expires > now) {
    return cache;
  }

  let source = 'redis';
  let tracks = await fetchTracksFromRedis();
  if (tracks.length < 5) {
    tracks = [...FALLBACK_TRACKS];
    source = 'fallback';
  }

  cache = {
    source,
    tracks,
    expires: now + CACHE_TTL,
  };

  return cache;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ source: 'fallback', tracks: [] });
  }

  const { source, tracks } = await getTracks();
  const q = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q || '';
  const filtered = filterTracks(q || '', tracks);

  console.info('[tracks] source:', source, 'count:', tracks.length);

  return res.status(200).json({
    source,
    tracks: filtered,
  });
}

