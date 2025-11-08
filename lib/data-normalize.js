// lib/data-normalize.js
// Shared helpers for normalizing dataset values (surfaces, tracks, distances)

const SURFACE_ALIASES = new Map([
  ['dirt', 'Dirt'],
  ['turf', 'Turf'],
  ['dirt/turf', 'Dirt/Turf'],
  ['dirtturf', 'Dirt/Turf'],
  ['harness', 'Harness'],
  ['synthetic', 'Synthetic'],
  ['allweather', 'All Weather'],
  ['all-weather', 'All Weather'],
  ['all weather', 'All Weather'],
  ['aw', 'All Weather'],
  ['tapeta', 'All Weather'],
  ['polytrack', 'All Weather'],
  ['poly track', 'All Weather'],
  ['poly-track', 'All Weather'],
  ['synthetic dirt', 'All Weather'],
  ['synthetic turf', 'All Weather'],
  ['woodbine tapeta', 'All Weather'],
]);

export const SURFACES = [
  'Dirt',
  'Turf',
  'Dirt/Turf',
  'Synthetic',
  'Harness',
  'All Weather',
];

export function normalizeSurface(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const trimmed = raw.replace(/[?]+$/g, '').replace(/\s+/g, ' ').trim();
  const key = trimmed.toLowerCase();
  const aliasKey = key.replace(/\s+/g, ' ');
  const direct = SURFACE_ALIASES.get(aliasKey);
  if (direct) return direct;
  const collapsed = key.replace(/[^a-z]/g, '');
  const collapsedMatch = SURFACE_ALIASES.get(collapsed);
  if (collapsedMatch) return collapsedMatch;
  const capitalized = trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ');
  return capitalized;
}

export function normalizeTrack(value) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

export function normalizeDistanceKey(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw === '?') return '?';

  const yardsMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:y|yd|yards?)/i);
  if (yardsMatch) {
    const yards = Math.round(Number(yardsMatch[1]));
    if (Number.isFinite(yards) && yards > 0) {
      return `${yards}y`;
    }
  }

  const furlongMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:f|furlongs?)/i);
  if (furlongMatch) {
    const furlongs = Number(furlongMatch[1]);
    if (Number.isFinite(furlongs) && furlongs > 0) {
      return `${parseFloat(furlongs.toFixed(2))}f`;
    }
  }

  const mileMatch = raw.match(/(\d+(?:\s+\d+\/\d+)?)\s*(?:m|mile|miles)/i);
  if (mileMatch) {
    const [whole, fraction] = mileMatch[1].split(/\s+/);
    const wholeMiles = Number(whole);
    let totalMiles = Number.isFinite(wholeMiles) ? wholeMiles : 0;
    if (fraction) {
      const [num, den] = fraction.split('/').map(Number);
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
        totalMiles += num / den;
      }
    }
    if (totalMiles > 0) {
      const furlongs = totalMiles * 8;
      return `${parseFloat(furlongs.toFixed(2))}f`;
    }
  }

  const halfMatch = raw.match(/^(\d+)\s*(?:and\s+)?(?:a\s+)?half\s*(?:f|furlongs?)/i);
  if (halfMatch) {
    const base = Number(halfMatch[1]);
    if (Number.isFinite(base)) {
      return `${parseFloat((base + 0.5).toFixed(2))}f`;
    }
  }

  return raw.replace(/\s+/g, ' ');
}

export function buildDedupeKey(parts) {
  return parts
    .map((part) =>
      typeof part === 'string'
        ? part.trim().toLowerCase()
        : part == null
        ? ''
        : String(part).trim().toLowerCase()
    )
    .join('|');
}


