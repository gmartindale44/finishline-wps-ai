// lib/calibration-summary.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hasRedisEnv = () =>
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisFetchKeys(prefix = 'fl:pred:') {
  // REST scan: we stored keys URL-encoded; list via KEYS-like endpoint
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis not configured');
  
  const keysUrl = `${url}/KEYS/${encodeURIComponent(prefix)}*`;
  const r = await fetch(keysUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  
  if (!r.ok) throw new Error(`KV list failed: ${r.status}`);
  const json = await r.json();
  // Upstash returns { result: ["key1","key2",...] } for keys endpoint
  return json.result || [];
}

async function redisHGetAll(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis not configured');
  
  const hgetallUrl = `${url}/HGETALL/${encodeURIComponent(key)}`;
  const r = await fetch(hgetallUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  
  if (!r.ok) throw new Error(`HGETALL failed: ${r.status}`);
  const { result } = await r.json();
  
  // Upstash HGETALL returns flat array [field, value, field, value...]
  const obj = {};
  for (let i = 0; i < (result?.length || 0); i += 2) {
    obj[result[i]] = result[i + 1];
  }
  return obj;
}

export async function getCalibrationSummary(limit = 50) {
  if (!hasRedisEnv()) {
    return {
      ok: true,
      kv: { enabled: false, totalKeys: 0, lastWriteTs: null },
      stats: {
        count: 0,
        resolved: 0,
        hits: 0,
        partials: 0,
        misses: 0,
        avgConf: null,
        avgTop3: null
      },
      model: getModelInfo(),
    };
  }

  const keys = await redisFetchKeys('fl:pred:');

  // newest last (Upstash doesn't guarantee order) — sort by created_ts if present
  const items = [];
  for (const k of keys) {
    try {
      const h = await redisHGetAll(k);
      if (Object.keys(h).length === 0) continue;
      items.push({ key: k, ...h });
    } catch {
      // ignore single key errors
    }
  }

  // sort by created_ts if present
  items.sort((a, b) => (Number(b.created_ts || 0) - Number(a.created_ts || 0)));

  const slice = items.slice(0, limit);

  const toNum = v => (v == null ? null : Number(v));

  const confs = slice.map(x => toNum(x.confidence)).filter(n => Number.isFinite(n));
  const top3 = slice.map(x => toNum(x.top3_mass)).filter(n => Number.isFinite(n));
  const resolved = slice.filter(x => (x.status || '').toLowerCase() === 'resolved');

  const norm = s => (s || '').toLowerCase();
  const hits = resolved.filter(x => ['hit', 'win'].includes(norm(x.result))).length;
  const partials = resolved.filter(x => norm(x.result) === 'partial').length;
  const misses = resolved.filter(x => ['miss', 'loss'].includes(norm(x.result))).length;

  const lastWriteTs = Number(items[0]?.created_ts || 0) || null;

  return {
    ok: true,
    kv: { enabled: true, totalKeys: keys.length, lastWriteTs },
    stats: {
      count: slice.length,
      resolved: resolved.length,
      hits,
      partials,
      misses,
      avgConf: confs.length ? (confs.reduce((a, b) => a + b, 0) / confs.length) : null,
      avgTop3: top3.length ? (top3.reduce((a, b) => a + b, 0) / top3.length) : null,
    },
    model: getModelInfo(),
  };
}

function getModelInfo() {
  try {
    const paramsPath = path.join(process.cwd(), 'data', 'model_params.json');
    const s = fs.statSync(paramsPath);
    return { calibrated: true, mtime: s.mtimeMs };
  } catch {
    return { calibrated: false, mtime: null };
  }
}

