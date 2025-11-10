import { promises as fs } from 'node:fs';
import path from 'node:path';

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/^"+|"+$/g, '');
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').replace(/^"+|"+$/g, '');
const GOOGLE_KEY = (process.env.GOOGLE_API_KEY || '').replace(/^"+|"+$/g, '');
const GOOGLE_CX  = (process.env.GOOGLE_CSE_ID  || '').replace(/^"+|"+$/g, '');

const CACHE_TTL_S = 60 * 60 * 24; // 24h
const CSV_FILE = path.join(process.cwd(), 'data', 'reconciliations_v1.csv');

async function upstash(command, ...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const url = `${UPSTASH_URL}/${command}/${args.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
  if (!res.ok) throw new Error(`Upstash ${command} failed: ${res.status}`);
  return res.json();
}

async function cacheGet(key) {
  try {
    const r = await upstash('GET', key);
    return r?.result ? JSON.parse(r.result) : null;
  } catch { return null; }
}
async function cacheSet(key, value, ttl = CACHE_TTL_S) {
  try { await upstash('SET', key, JSON.stringify(value)); await upstash('EXPIRE', key, ttl); } catch {}
}

async function cse(query) {
  if (!GOOGLE_KEY || !GOOGLE_CX) throw new Error('Missing GOOGLE_API_KEY or GOOGLE_CSE_ID');
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', GOOGLE_KEY);
  u.searchParams.set('cx', GOOGLE_CX);
  u.searchParams.set('q', query);
  const r = await fetch(u.toString());
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google CSE ${r.status}: ${text}`);
  }
  return r.json();
}

async function appendCSV(row) {
  const header = 'timestamp,track,date,raceNo,query,hit_title,hit_link,hit_snippet\n';
  try {
    await fs.access(CSV_FILE).catch(async () => fs.mkdir(path.dirname(CSV_FILE), { recursive: true }).then(() => fs.writeFile(CSV_FILE, header)));
    await fs.appendFile(CSV_FILE, row, 'utf8');
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const { track, date, raceNo } = req.body || {};
    if (!track || !date || !raceNo) throw new Error('track, date, raceNo are required');

    const query = `${track} race ${raceNo} results ${date}`;
    const cacheKey = `fl:cse:reconcile:${track}:${date}:${raceNo}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return res.status(200).json({ cached: true, ...cached });

    const json = await cse(query);
    const top = json?.items?.[0] || null;
    const payload = {
      track, date, raceNo, query,
      topHit: top ? { title: top.title, link: top.link, snippet: top.snippet } : null,
      items: (json?.items || []).slice(0, 5).map(i => ({ title: i.title, link: i.link, snippet: i.snippet }))
    };

    await cacheSet(cacheKey, payload, CACHE_TTL_S);

    const row = [
      new Date().toISOString(),
      `"${(track||'').replace(/"/g,'""')}"`,
      date,
      raceNo,
      `"${query.replace(/"/g,'""')}"`,
      `"${(top?.title||'').replace(/"/g,'""')}"`,
      `"${(top?.link||'').replace(/"/g,'""')}"`,
      `"${(top?.snippet||'').replace(/"/g,'""')}"`
    ].join(',') + '\n';
    await appendCSV(row);

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

