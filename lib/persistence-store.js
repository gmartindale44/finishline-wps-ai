import { hgetall, hset, sadd, smembers } from './redis.js';
import { normalizeTrack } from './data-normalize.js';

const TRACKS_KEY = 'finishline:v1:tracks';
const MEASUREMENTS_KEY = 'finishline:v1:measurements';

const RETRY_DELAY_MS = 150;
const RETRY_ATTEMPTS = 2;

async function withRetry(fn) {
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function upsertTrack(track) {
  const name = normalizeTrack(track);
  if (!name) return false;
  await withRetry(() => sadd(TRACKS_KEY, [name]));
  return true;
}

export async function getTracks() {
  const members = await withRetry(() => smembers(TRACKS_KEY));
  const unique = Array.from(new Set(members.map((m) => normalizeTrack(m)).filter(Boolean)));
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

export async function upsertMeasurements(obj = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    payload[key] = typeof value === 'string' ? value : String(value);
  }
  if (!Object.keys(payload).length) return false;
  await withRetry(() => hset(MEASUREMENTS_KEY, payload));
  return true;
}

export async function getMeasurements() {
  const data = await withRetry(() => hgetall(MEASUREMENTS_KEY));
  return data || {};
}

