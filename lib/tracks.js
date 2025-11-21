import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tracksJsonPath = join(__dirname, '../data/tracks.json');
const tracksData = JSON.parse(readFileSync(tracksJsonPath, 'utf-8'));

const CLEAN_TRACKS = Array.isArray(tracksData)
  ? Array.from(
      new Set(
        tracksData
          .map((entry) => {
            if (typeof entry === 'string') return entry.trim();
            if (entry && typeof entry === 'object' && 'name' in entry) {
              return String(entry.name).trim();
            }
            return '';
          })
          .filter(Boolean)
      )
    )
  : [];

export const FALLBACK_TRACKS = CLEAN_TRACKS;

const TRACK_KEY_MAIN = 'finishline:tracks';
const TRACK_KEY_FALLBACK = 'finishline:tracks:v1';

export const normalize = (s) =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export async function fetchTracksFromRedis() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/^"+|"+$/g, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').replace(
    /^"+|"+$/g,
    ''
  );

  if (!url || !token) return [];

  const readKey = async (key) => {
    try {
      const response = await fetch(`${url}/GET/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const payload = await response.json();
      if (Array.isArray(payload.result)) {
        return payload.result
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean);
      }
      if (typeof payload.result === 'string') {
        const parsed = JSON.parse(payload.result);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean);
        }
      }
    } catch {
      return [];
    }
    return [];
  };

  const primary = await readKey(TRACK_KEY_MAIN);
  if (primary.length) return Array.from(new Set(primary));

  const legacy = await readKey(TRACK_KEY_FALLBACK);
  if (legacy.length) return Array.from(new Set(legacy));

  return [];
}

export function filterTracks(query, tracks, limit = 20) {
  const deduped = Array.from(
    new Set(
      tracks
        .map((name) => (name || '').toString().trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const needle = normalize(query);
  if (!needle) {
    return deduped.slice(0, limit);
  }

  const scored = deduped
    .map((raw) => {
      const n = normalize(raw);
      const idx = n.indexOf(needle);
      return { raw, idx, len: raw.length };
    })
    .filter((item) => item.idx > -1)
    .sort((a, b) => {
      if (a.idx !== b.idx) return a.idx - b.idx;
      if (a.len !== b.len) return a.len - b.len;
      return a.raw.localeCompare(b.raw);
    });

  return scored.slice(0, limit).map((item) => item.raw);
}

