export const config = { runtime: 'nodejs' };

import {
  getMeasurements,
  getTracks,
  upsertMeasurements,
  upsertTrack,
} from '../lib/persistence-store.js';

export default async function handler(req, res) {
  const method = req.method || 'GET';

  try {
    if (method === 'GET') {
      const [tracks, measurements] = await Promise.all([
        safeCall(() => getTracks(), []),
        safeCall(() => getMeasurements(), {}),
      ]);
      return res.status(200).json({ ok: true, tracks, measurements });
    }

    if (method === 'POST') {
      const body = req.body || {};
      const kind = body.kind;

      if (kind === 'track') {
        await upsertTrack(body.track || '');
        return res.status(200).json({ ok: true });
      }

      if (kind === 'measurements') {
        await upsertMeasurements(body.measurements || {});
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: 'invalid_kind' });
    }

    res.setHeader('Allow', 'GET,POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    const detail = err?.message || String(err);
    const status = detail.includes('redis_unreachable') ? 200 : 500;
    return res.status(status).json({ ok: false, error: 'persistence_error', detail });
  }
}

async function safeCall(fn, fallback) {
  try {
    const value = await fn();
    return value == null ? fallback : value;
  } catch (err) {
    if (err?.message?.includes('redis_unreachable')) {
      return fallback;
    }
    throw err;
  }
}

