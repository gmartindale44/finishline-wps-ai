#!/usr/bin/env node

/**
 * scripts/test-tracks.js
 * Simple CLI helper to exercise the deployed /api/tracks endpoint.
 *
 * Usage:
 *   SITE_URL="https://finishline-wps-ai.vercel.app" node scripts/test-tracks.js "ev"
 */

const [, , rawQuery] = process.argv;

if (!rawQuery) {
  console.error('Usage: node scripts/test-tracks.js "<query>"');
  process.exit(1);
}

const site =
  process.env.SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
  'http://localhost:3000';

const url = new URL('/api/tracks', site);
url.searchParams.set('q', rawQuery);

(async () => {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    const data = Array.isArray(json) ? json.slice(0, 15) : [];

    console.log(`Tracks for "${rawQuery}" (${data.length} shown):`);
    data.forEach((name, idx) => {
      console.log(`${idx + 1}. ${name}`);
    });
  } catch (err) {
    console.error('[test-tracks] Failed to fetch tracks:', err.message || err);
    process.exit(1);
  }
})();


