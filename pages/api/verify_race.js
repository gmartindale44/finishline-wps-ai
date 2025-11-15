import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';
import { fetchAndParseResults } from '../../lib/results';

const GOOGLE_KEY = (process.env.GOOGLE_API_KEY || '').replace(/^"+|"+$/g, '');
const GOOGLE_CX  = (process.env.GOOGLE_CSE_ID  || '').replace(/^"+|"+$/g, '');

const TTL_SECONDS = 60 * 60 * 24; // 24h
const isVercel = !!process.env.VERCEL;
const RECON_LIST = 'reconciliations:v1';
const RECON_DAY_PREFIX = 'reconciliations:v1:';

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error('[verify_race] Failed to init Redis client', error);
      redisClient = null;
    }
  }
  return redisClient;
}

const slug = (s = '') =>
  s.toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

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
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || process.env.NEXT_BASE_PATH || '').replace(/\/+$/, '');
  const pathPrefix = basePath ? (basePath.startsWith('/') ? basePath : `/${basePath}`) : '';
  const url   = `${proto}://${host}${pathPrefix}/api/cse_resolver?q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `CSE bridge ${r.status}`);
  const arr = Array.isArray(j.results) ? j.results : [];
  return arr.map(i => ({ title: i.title, link: i.link, snippet: i.snippet }));
}

const preferHosts = [
  'horseracingnation.com',
  'entries.horseracingnation.com',
  'equibase.com',
];

function pickBest(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const scored = items.map((item) => {
    try {
      const url = new URL(item.link || '');
      const host = url.hostname || '';
      const idx = preferHosts.findIndex((h) => host.includes(h));
      return { item, score: idx === -1 ? 10 : idx };
    } catch {
      return { item, score: 10 };
    }
  }).sort((a, b) => a.score - b.score);
  return scored.length ? scored[0].item : null;
}

async function runSearch(req, query) {
  return (GOOGLE_KEY && GOOGLE_CX)
    ? await cseDirect(query)
    : await cseViaBridge(req, query);
}

export default async function handler(req, res) {
  // Extract safe values early for error responses
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

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
      date: inputDate,
      raceNo, race_no,
      distance = '',
      surface  = '',
      strategy = '',
      ai_picks = '',
      predicted = {},
    } = body || {};

    const raceNumber = raceNo ?? race_no;
    safeDate = (inputDate && String(inputDate).trim()) || new Date().toISOString().slice(0, 10);
    safeTrack = track || null;
    safeRaceNo = raceNumber ?? null;

    // Log request
    console.info('[verify_race] request', { track: safeTrack, date: safeDate, raceNo: safeRaceNo });

    if (!track) {
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        error: 'Missing required field: track',
        details: 'Track is required to verify a race',
        step: 'verify_race_validation',
      });
    }

    const date = safeDate;

    const dWords = date.replace(/-/g, ' ');
    const racePart = raceNumber ? ` Race ${raceNumber}` : '';
    const baseQuery = `${track}${racePart} ${date} results Win Place Show order`;
    const altQuery  = `${track}${racePart} ${dWords} result chart official`;
    const siteBias  = '(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)';

    const queries = [
      `${baseQuery} ${siteBias}`.trim(),
      `${altQuery} ${siteBias}`.trim(),
      baseQuery,
      altQuery,
    ];

    let results = [];
    let queryUsed = queries[0];
    let lastError = null;
    let searchStep = 'verify_race_search';

    try {
      for (const q of queries) {
        try {
          const items = await runSearch(req, q);
          queryUsed = q;
          results = items;
          if (items.length) break;
        } catch (error) {
          lastError = error;
          console.error('[verify_race] Search query failed', { query: q, error: error?.message || String(error) });
        }
      }

      if (!results.length && lastError) {
        throw lastError;
      }
    } catch (error) {
      console.error('[verify_race] Search failed', { error: error?.message || String(error), stack: error?.stack });
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        error: 'Search failed',
        details: lastError?.message || error?.message || 'Unable to fetch race results from search providers',
        step: searchStep,
        query: queryUsed || queries[0] || null,
      });
    }

    const topPreferred = pickBest(results);
    const top = topPreferred || results[0] || null;

    let outcome = { win: '', place: '', show: '' };
    if (top?.link) {
      try {
        outcome = await fetchAndParseResults(top.link);
      } catch (error) {
        console.error('[verify_race] Parse results failed', { url: top.link, error: error?.message || String(error) });
        // Continue with empty outcome - not a fatal error
      }
    }
    const normalizeName = (value = '') => value.toLowerCase().replace(/\s+/g, ' ').trim();
    const predictedSafe = {
      win: (predicted && predicted.win) ? String(predicted.win) : '',
      place: (predicted && predicted.place) ? String(predicted.place) : '',
      show: (predicted && predicted.show) ? String(predicted.show) : '',
    };
    const hits = {
      winHit: predictedSafe.win && outcome.win && normalizeName(predictedSafe.win) === normalizeName(outcome.win),
      placeHit: predictedSafe.place && outcome.place && normalizeName(predictedSafe.place) === normalizeName(outcome.place),
      showHit: predictedSafe.show && outcome.show && normalizeName(predictedSafe.show) === normalizeName(outcome.show),
      top3Hit: [predictedSafe.win, predictedSafe.place, predictedSafe.show]
        .filter(Boolean)
        .map(normalizeName)
        .some((name) => [outcome.win, outcome.place, outcome.show].map(normalizeName).includes(name)),
    };

    const summary = (() => {
      const lines = [];
      lines.push(`Query: ${queryUsed || baseQuery}`);
      if (top) {
        if (top.title) lines.push(`Top Result: ${top.title}`);
        if (top.link) lines.push(`Link: ${top.link}`);
      } else {
        lines.push('No top result returned.');
      }
      const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(Boolean);
      if (outcomeParts.length) lines.push(`Outcome: ${outcomeParts.join(' / ')}`);
      const hitList = [
        hits.winHit ? 'Win' : null,
        hits.placeHit ? 'Place' : null,
        hits.showHit ? 'Show' : null,
      ].filter(Boolean);
      if (hitList.length) lines.push(`Hits: ${hitList.join(', ')}`);
      return lines.filter(Boolean).join('\n');
    })();
    const summarySafe =
      summary ||
      (top?.title
        ? `Top Result: ${top.title}${top.link ? `\n${top.link}` : ''}`
        : 'No summary returned.');

    const tsIso  = new Date().toISOString();
    const redis = getRedis();

    // Redis event log (namespaced) – best-effort
    if (redis) {
      const raceLabel = raceNumber ? `R${raceNumber}` : 'R?';
      const ns = `fl:cse:reconcile:${slug(track)}:${date}:${raceLabel}`;
      const eventKey = `${ns}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
      try {
        await redis.set(eventKey, JSON.stringify({
          ts: tsIso,
          track,
          date,
          raceNo: raceNumber ?? null,
          distance,
          surface,
          strategy,
          ai_picks,
          query: queryUsed,
          count: results.length,
          results: results.slice(0, 10),
          predicted: predictedSafe,
          outcome,
          hits,
          summary: summarySafe,
        }));
        await redis.expire(eventKey, TTL_SECONDS);
        await redis.lpush(`${ns}:log`, eventKey);
        await redis.ltrim(`${ns}:log`, 0, 99);
        await redis.expire(`${ns}:log`, TTL_SECONDS);
      } catch (error) {
        console.error('[verify_race] Redis event log failed', error);
      }
    }

    if (redis) {
      try {
        const row = {
          ts: Date.now(),
          date,
          track,
          raceNo: raceNumber ?? null,
          query: queryUsed || null,
          top: top ? { title: top.title, link: top.link } : null,
          outcome,
          predicted: predictedSafe,
          hits,
          summary: summarySafe,
        };
        await redis.rpush(RECON_LIST, JSON.stringify(row));
        const dayKey = `${RECON_DAY_PREFIX}${date}`;
        await redis.rpush(dayKey, JSON.stringify(row));
        await redis.expire(dayKey, 60 * 60 * 24 * 90);
        await redis.hincrby('cal:v1', 'total', 1);
        if (hits.winHit) await redis.hincrby('cal:v1', 'correctWin', 1);
        if (hits.placeHit) await redis.hincrby('cal:v1', 'correctPlace', 1);
        if (hits.showHit) await redis.hincrby('cal:v1', 'correctShow', 1);
        if (hits.top3Hit) await redis.hincrby('cal:v1', 'top3Hit', 1);
      } catch (error) {
        console.error('Redis logging failed', error);
      }
    }

    if (!isVercel) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const csvPath = path.resolve(process.cwd(), 'data/reconciliations_v1.csv');
        const header = 'ts,date,track,raceNo,query,topTitle,topUrl,winHit,placeHit,showHit,top3Hit\n';
        const exists = fs.existsSync(csvPath);
        const line = [
          Date.now(),
          date,
          JSON.stringify(track),
          raceNumber ?? '',
          JSON.stringify(queryUsed || ''),
          JSON.stringify(top?.title || ''),
          JSON.stringify(top?.link || ''),
          hits.winHit ? 1 : 0,
          hits.placeHit ? 1 : 0,
          hits.showHit ? 1 : 0,
          hits.top3Hit ? 1 : 0,
        ].join(',') + '\n';
        if (!exists) fs.writeFileSync(csvPath, header);
        fs.appendFileSync(csvPath, line);
      } catch (error) {
        console.warn('Local CSV append failed (dev only):', error?.message || error);
      }
    }

    return res.status(200).json({
      date,
      track,
      raceNo: raceNumber ?? null,
      query: queryUsed,
      count: results.length,
      top,
      results: results.slice(0, 5),
      outcome,
      predicted: predictedSafe,
      hits,
      summary: summarySafe,
    });
  } catch (err) {
    // Log the full error for debugging
    console.error('[verify_race] error', {
      error: err?.message || String(err),
      stack: err?.stack,
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
    });

    // Always return 200 with structured error response
    return res.status(200).json({
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      error: 'verify_race failed',
      details: err?.message || String(err) || 'Unknown error occurred',
      step: 'verify_race',
    });
  }
}
