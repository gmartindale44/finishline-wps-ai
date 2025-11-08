import fs from 'fs';
import path from 'path';
import { normalizeSurface, normalizeTrack } from '../lib/data-normalize.js';
import { upsertMeasurements, upsertTrack } from '../lib/persistence-store.js';

const DATA_FILE = path.join('data', 'finishline_tests_v1.csv');

if (!fs.existsSync(DATA_FILE)) {
  console.error(`[backfill-persistence] Missing dataset at ${DATA_FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(DATA_FILE, 'utf8');
const rows = parseCSV(raw);
if (rows.length <= 1) {
  console.log('[backfill-persistence] Dataset empty, nothing to backfill.');
  process.exit(0);
}

const header = rows[0];
const index = new Map(header.map((name, idx) => [name, idx]));

const trackIdx = index.get('Track');
const surfaceIdx = index.get('Surface');
const distanceIdx = index.get('Distance');

const tracks = new Set();
let lastTrack = '';
let lastSurface = '';
let lastDistance = '';

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !row.length) continue;
  const track = trackIdx != null ? normalizeTrack(row[trackIdx]) : '';
  const surface = surfaceIdx != null ? normalizeSurface(row[surfaceIdx]) : '';
  const distance = distanceIdx != null ? (row[distanceIdx] || '').trim() : '';

  if (track) {
    tracks.add(track);
    lastTrack = track;
  }
  if (surface) lastSurface = surface;
  if (distance) lastDistance = distance;
}

async function run() {
  console.log(`[backfill-persistence] Upserting ${tracks.size} tracks...`);
  for (const track of tracks) {
    await upsertTrack(track);
  }

  const measurements = {};
  if (lastTrack) measurements.track = lastTrack;
  if (lastSurface) measurements.surface = lastSurface;
  if (lastDistance) measurements.distance = lastDistance;

  if (Object.keys(measurements).length) {
    await upsertMeasurements(measurements);
    console.log('[backfill-persistence] Seeded measurements snapshot:', measurements);
  } else {
    console.log('[backfill-persistence] No measurement values to seed.');
  }

  console.log('[backfill-persistence] Complete.');
}

run().catch((err) => {
  console.error('[backfill-persistence] Failed:', err?.message || err);
  process.exit(1);
});

function parseCSV(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' || ch === '\r') {
      if (!inQuotes) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        if (ch === '\r' && content[i + 1] === '\n') i++;
      } else {
        field += ch;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

