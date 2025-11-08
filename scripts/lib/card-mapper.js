import fs from 'fs';
import path from 'path';
import { normalizeSurface } from '../../lib/data-normalize.js';

const CARD_DIR_GLOBS = [
  ['data', 'race_cards'],
  ['data', 'cards'],
  ['.tmp', 'cards'],
  ['public', 'cards'],
];

const MANUAL_MAPPING_FILE = path.join('data', 'manual-card-mapping.json');

let cacheBuilt = false;
const cardIndex = new Map();
let manualMapping = null;

function canonicalize(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeDistance(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '';
  return raw.replace(/\s+/g, '').toLowerCase();
}

function buildKey({ track, raceNo, surface, distance }) {
  return [
    canonicalize(track),
    String(raceNo || '').trim().toLowerCase(),
    canonicalize(surface),
    normalizeDistance(distance),
  ].join('|');
}

function safeReadJSON(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function visitFilesRecursively(dirPath, visitor) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      visitFilesRecursively(full, visitor);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      visitor(full);
    }
  }
}

function ingestManualMapping() {
  if (!fs.existsSync(MANUAL_MAPPING_FILE)) return;
  const data = safeReadJSON(MANUAL_MAPPING_FILE);
  if (!data || typeof data !== 'object') return;
  manualMapping = data;
}

function addCardEntriesFromArray(records, sourceInfo = {}) {
  if (!Array.isArray(records)) return;
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const track = record.track || record.Track || record.venue || '';
    const raceNo = record.race || record.raceNo || record.number || record.race_number || record.race_id;
    const surface = record.surface || record.track_condition || '';
    const distance = record.distance || record.dist || record.distance_text || '';
    const entries = record.entries || record.horses || record.runners || record.starters;
    if (!track || raceNo == null || !Array.isArray(entries)) continue;
    const normalizedSurface = normalizeSurface(surface);
    const key = buildKey({ track, raceNo, surface: normalizedSurface, distance });
    const mapped = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const name = entry.name || entry.horse || entry.horse_name || entry.runner;
      const post = entry.post || entry.program || entry.number || entry.post_position || entry.postPosition;
      if (!name || post == null) continue;
      mapped.push({ name: String(name), post: String(post).trim() });
    }
    if (mapped.length) {
      if (!cardIndex.has(key)) {
        cardIndex.set(key, []);
      }
      cardIndex.get(key).push({
        entries: mapped,
        meta: { track, raceNo, surface: normalizedSurface, distance, ...sourceInfo },
      });
    }
  }
}

function ingestCardFile(filePath) {
  const payload = safeReadJSON(filePath);
  if (!payload) return;
  if (Array.isArray(payload)) {
    addCardEntriesFromArray(payload, { source: filePath });
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.cards)) {
      addCardEntriesFromArray(payload.cards, { source: filePath });
    } else if (Array.isArray(payload.races)) {
      addCardEntriesFromArray(payload.races, { source: filePath });
    } else if (Array.isArray(payload.data)) {
      addCardEntriesFromArray(payload.data, { source: filePath });
    } else if (payload.track && payload.race && Array.isArray(payload.entries)) {
      addCardEntriesFromArray([payload], { source: filePath });
    }
  }
}

function ensureCache() {
  if (cacheBuilt) return;
  cacheBuilt = true;
  ingestManualMapping();

  const baseDir = process.cwd();
  for (const parts of CARD_DIR_GLOBS) {
    const resolved = path.join(baseDir, ...parts);
    visitFilesRecursively(resolved, ingestCardFile);
  }

  // Integrate manual mapping into cache if present
  if (manualMapping && typeof manualMapping === 'object') {
    for (const [key, entries] of Object.entries(manualMapping)) {
      if (!Array.isArray(entries)) continue;
      const formatted = entries
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const name = entry.name || entry.horse || entry.label;
          const post = entry.post || entry.number || entry.program;
          if (!name || post == null) return null;
          return { name: String(name), post: String(post).trim() };
        })
        .filter(Boolean);
      if (formatted.length === 0) continue;
      if (!cardIndex.has(key)) {
        cardIndex.set(key, []);
      }
      cardIndex.get(key).push({
        entries: formatted,
        meta: { source: MANUAL_MAPPING_FILE },
      });
    }
  }
}

export function mapNamesToPosts({ track, raceNo, surface, distance, picks }) {
  ensureCache();
  const normalizedSurface = normalizeSurface(surface);
  const key = buildKey({ track, raceNo, surface: normalizedSurface, distance });
  const cards = cardIndex.get(key) || [];

  if (cards.length === 0) {
    console.warn(
      `[card-mapper] No card data found for ${track} R${raceNo} (${normalizedSurface} ${distance}). Preserving original AI_Picks names.`
    );
    return null;
  }

  const normalizedNames = new Map();
  for (const card of cards) {
    for (const entry of card.entries) {
      normalizedNames.set(canonicalize(entry.name), entry.post);
    }
  }

  const posts = [];
  const missing = [];
  const names = Array.isArray(picks) ? picks : [];
  names.forEach((name) => {
    const canonical = canonicalize(name);
    if (canonical && normalizedNames.has(canonical)) {
      posts.push(normalizedNames.get(canonical));
    } else if (canonical && manualMapping && manualMapping[key]) {
      const manualEntry = manualMapping[key].find(
        (entry) => canonicalize(entry.name || entry.horse || '') === canonical
      );
      if (manualEntry && manualEntry.post != null) {
        posts.push(String(manualEntry.post));
      } else {
        missing.push(name);
      }
    } else {
      missing.push(name);
    }
  });

  if (missing.length) {
    console.warn(
      `[card-mapper] Missing post positions for ${track} R${raceNo}: ${missing.join(', ')}. Preserving original AI_Picks names.`
    );
    return null;
  }

  return posts;
}


