import fs from 'node:fs';

const HEADER = [
  'Test_ID',
  'Track',
  'Race_No',
  'Surface',
  'Distance',
  'Confidence',
  'Top_3_Mass',
  'AI_Picks',
  'Strategy',
  'Result',
  'ROI_Percent',
  'WinRate',
  'Notes',
];

const CSV_PATH = 'data/finishline_tests_v1.csv';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  console.log('[append-from-redis] Missing Upstash env vars; skipping append.');
  process.exit(0);
}

const baseUrl = redisUrl.replace(/\/$/, '');

async function rkeys(pattern) {
  const res = await fetch(`${baseUrl}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
  });
  if (!res.ok) throw new Error(`rkeys HTTP ${res.status}`);
  const data = await res.json();
  return data?.result || [];
}

async function rhgetall(key) {
  const res = await fetch(`${baseUrl}/hgetall/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
  });
  if (!res.ok) throw new Error(`rhgetall HTTP ${res.status}`);
  const data = await res.json();
  const arr = data?.result ?? [];
  const obj = {};
  for (let i = 0; i < arr.length; i += 2) {
    obj[arr[i]] = arr[i + 1];
  }
  return obj;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  while (result.length < HEADER.length) result.push('');
  return result;
}

function formatCsvValue(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || /\s/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function loadCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at ${CSV_PATH}`);
  }
  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.trim().split('\n');
  const headerLine = lines.shift();
  const header = headerLine ? headerLine.split(',').map(h => h.trim()) : [];
  if (header.join(',') !== HEADER.join(',')) {
    throw new Error('[append-from-redis] CSV header mismatch; aborting.');
  }
  const rows = lines.filter(Boolean).map(line => parseCsvLine(line));
  const objects = rows.map(cols => Object.fromEntries(HEADER.map((h, idx) => [h, cols[idx] ?? ''])));
  return { header, objects };
}

function keyForRow(row) {
  return [
    row.Track,
    row.Race_No,
    row.Distance,
    row.AI_Picks,
    row.Strategy,
    row.Result,
    row.ROI_Percent,
  ].map(x => (x ?? '').toString().trim().toLowerCase()).join('|');
}

function toFloatOrEmpty(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num;
}

function normalizeStrategy(strategy) {
  const s = (strategy || '').toString().trim();
  if (!s) return 'ATB';
  if (/^across\s+the\s+board$/i.test(s)) return 'ATB';
  return s;
}

function normalizeResult(result, roiValue) {
  const r = (result || '').toString().trim().toLowerCase();
  if (r === 'hit' || r === 'win') return 'Hit';
  if (r === 'partial' || r === 'place') return 'Partial';
  if (r === 'miss' || r === 'loss') return 'Miss';
  const roi = Number(roiValue);
  if (Number.isFinite(roi)) {
    if (roi >= 0) return 'Hit';
    if (roi > -100) return 'Partial';
    return 'Miss';
  }
  return 'Miss';
}

function normalizePicks(raw) {
  if (!raw) return '';
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (_) {
      value = raw;
    }
  }
  if (Array.isArray(value)) {
    return value.map(v => (v ?? '').toString().trim()).filter(Boolean).join('-');
  }
  if (value && typeof value === 'object') {
    const win = value.win ?? value.WIN ?? '';
    const place = value.place ?? value.PLACE ?? '';
    const show = value.show ?? value.SHOW ?? '';
    const parts = [win, place, show].map(v => (v ?? '').toString().trim()).filter(Boolean);
    if (parts.length) return parts.join('-');
  }
  if (typeof value === 'string') {
    return value.split(/[|,\-]/).map(v => v.trim()).filter(Boolean).join('-');
  }
  return '';
}

function formatConfidence(num) {
  if (num === '') return '';
  if (!Number.isFinite(num)) return '';
  return (Math.round(num * 100) / 100).toString();
}

function formatRoi(roi) {
  if (!Number.isFinite(roi)) return '';
  const rounded = Math.round(roi * 100) / 100;
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

async function main() {
  const { objects } = loadCsv();
  const existingMap = new Map();
  let maxId = 0;
  for (const row of objects) {
    existingMap.set(keyForRow(row), true);
    const id = Number(row.Test_ID);
    if (Number.isFinite(id) && id > maxId) maxId = id;
  }

  const keys = await rkeys('fl:pred:*');
  if (!keys.length) {
    console.log('[append-from-redis] No redis keys found; nothing to append.');
    process.exit(0);
  }

  const additions = [];

  // NOTE: This script reads structured outcome fields from Redis (win/place/show),
  // NOT the summary text. The summary field in verify_race responses is cosmetic UI text.
  for (const key of keys) {
    try {
      const obj = await rhgetall(key);
      if (!obj || (obj.status || '').toLowerCase() !== 'resolved') continue;

      const track = obj.track || '';
      const raceNo = obj.raceNo || obj.race_no || '';
      const surface = obj.surface || '';
      const distance = obj.distance || '';
      const confidence = toFloatOrEmpty(obj.confidence);
      const top3 = toFloatOrEmpty(obj.top3_mass);
      const picks = normalizePicks(obj.picks);
      const strategy = normalizeStrategy(obj.strategy);
      const roiRaw = Number(obj.roi ?? obj.roi_percent);
      const result = normalizeResult(obj.result, roiRaw);
      const roi = Number.isFinite(roiRaw) ? roiRaw : '';
      const notes = obj.live === 'true' || obj.live === true ? 'live' : (obj.notes || '');

      const mapped = {
        Track: track,
        Race_No: raceNo,
        Surface: surface,
        Distance: distance,
        Confidence: confidence === '' ? '' : (confidence <= 1 ? (Math.round(confidence * 100) / 100).toString() : (Math.round(confidence) / 100).toString()),
        Top_3_Mass: top3 === '' ? '' : (top3 <= 1 ? (Math.round(top3 * 100) / 100).toString() : (Math.round(top3) / 100).toString()),
        AI_Picks: picks,
        Strategy: strategy,
        Result: result,
        ROI_Percent: roi === '' ? '' : formatRoi(roi),
        WinRate: '',
        Notes: notes,
      };

      const uniqueKey = keyForRow(mapped);
      if (existingMap.has(uniqueKey)) continue;

      existingMap.set(uniqueKey, true);
      additions.push(mapped);
    } catch (err) {
      console.warn(`[append-from-redis] Failed to process ${key}:`, err?.message || err);
    }
  }

  if (!additions.length) {
    console.log('[append-from-redis] No new rows to append.');
    process.exit(0);
  }

  let nextId = maxId + 1;
  const newLines = additions.map(row => {
    const output = { ...row, Test_ID: String(nextId++) };
    return HEADER.map(h => formatCsvValue(output[h] ?? '')).join(',');
  });

  const csvContent = fs.readFileSync(CSV_PATH, 'utf8').replace(/\s*$/, '');
  const finalContent = csvContent + '\n' + newLines.join('\n') + '\n';
  fs.writeFileSync(CSV_PATH, finalContent, 'utf8');

  console.log(`[append-from-redis] Appended ${additions.length} rows. Total rows now ${objects.length + additions.length}.`);
}

main().catch(err => {
  console.error('[append-from-redis] Fatal:', err?.message || err);
  process.exit(1);
});
