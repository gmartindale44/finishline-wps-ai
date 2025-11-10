import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const GOOGLE_KEY = (process.env.GOOGLE_API_KEY || '').replace(/^"+|"+$/g, '');
const GOOGLE_CX  = (process.env.GOOGLE_CSE_ID  || '').replace(/^"+|"+$/g, '');

const UPSTASH_URL   = (process.env.UPSTASH_REDIS_REST_URL   || '').replace(/^"+|"+$/g, '');
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').replace(/^"+|"+$/g, '');

const TTL_SECONDS = 60 * 60 * 24; // 24h
const CSV_FILE = path.join(process.cwd(), 'data', 'reconciliations_v1.csv');

const slug = (s = '') =>
  s.toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

async function ensureCsvHeader() {
  try { await fs.access(CSV_FILE); }
  catch {
    const header = [
      'timestamp','track','date','race_no',
      'distance','surface','strategy','ai_picks',
      'query','result_count','top_title','top_link','top_snippet'
    ].join(',') + '\n';
    await fs.mkdir(path.dirname(CSV_FILE), { recursive: true });
    await fs.writeFile(CSV_FILE, header, 'utf8');
  }
}

async function appendCsvRow(obj) {
  await ensureCsvHeader();
  const esc = (v='') => `"${String(v).replace(/"/g,'""')}"`;
  const row = [
    obj.ts,
    esc(obj.track),
    obj.date,
    obj.raceNo,
    esc(obj.distance || ''),
    esc(obj.surface || ''),
    esc(obj.strategy || ''),
    esc(obj.ai_picks || ''),
    esc(obj.query),
    obj.count ?? 0,
    esc(obj.top?.title || ''),
    esc(obj.top?.link  || ''),
    esc(obj.top?.snippet || ''),
  ].join(',') + '\n';
  await fs.appendFile(CSV_FILE, row, 'utf8');
}

async function redisPipeline(cmds) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmds),
  });
  return res.ok;
}

async function cseDirect(query) {
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', GOOGLE_KEY);
  u.searchParams.set('cx', GOOGLE_CX);
  u.searchParams.set('q', query);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`Google CSE ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const items = Array.isArray(j.items) ? j.items : [];
  return items.map(i => ({ title: i.title, link: i.link, snippet: i.snippet }));
}

async function cseViaBridge(req, query) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers.host;
  const url   = `${proto}://${host}/api/cse_resolver?q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `CSE bridge ${r.status}`);
  const arr = Array.isArray(j.results) ? j.results : [];
  return arr.map(i => ({ title: i.title, link: i.link, snippet: i.snippet }));
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Be tolerant of either req.body object or JSON string
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body && typeof req.json === 'function') { try { body = await req.json(); } catch { body = {}; } }

    const {
      track,
      date,                       // YYYY-MM-DD
      raceNo, race_no,            // either is fine
      distance = '',
      surface  = '',
      strategy = '',
      ai_picks = '',
    } = body || {};

    const raceNumber = raceNo ?? race_no;
    if (!track || !date || !raceNumber) {
      return res.status(400).json({ error: 'Missing required fields: track, date, raceNo' });
    }

    // Query builder
    const qParts = [
      track,
      `Race ${raceNumber}`,
      date,
      distance && `${distance}`,
      surface && `${surface}`,
      'results Win Place Show order'
    ].filter(Boolean);
    const query = qParts.join(' ').trim();

    // Prefer direct Google if keys are present; otherwise hit the internal bridge
    const results = (GOOGLE_KEY && GOOGLE_CX)
      ? await cseDirect(query)
      : await cseViaBridge(req, query);

    const top = results[0] || null;
    const ts  = new Date().toISOString();

    // Redis event log (namespaced) – best-effort
    const ns = `fl:cse:reconcile:${slug(track)}:${date}:R${raceNumber}`;
    const eventKey = `${ns}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
    await redisPipeline([
      ['SET',    eventKey, JSON.stringify({
        ts, track, date, raceNo: raceNumber, distance, surface, strategy, ai_picks, query,
        count: results.length, results: results.slice(0,10),
      })],
      ['EXPIRE', eventKey, String(TTL_SECONDS)],
      ['LPUSH',  `${ns}:log`, eventKey],
      ['LTRIM',  `${ns}:log`, '0', '99'],
      ['EXPIRE', `${ns}:log`, String(TTL_SECONDS)],
    ]);

    // CSV audit – tolerant
    await appendCsvRow({
      ts, track, date, raceNo: raceNumber,
      distance, surface, strategy, ai_picks,
      query, count: results.length, top,
    });

    return res.status(200).json({
      ok: true,
      saved: { ns, eventKey },
      query,
      count: results.length,
      top,
      results: results.slice(0, 5),
    });
  } catch (err) {
    return res.status(500).json({ error: 'verify_race failed', details: err?.message || String(err) });
  }
}
