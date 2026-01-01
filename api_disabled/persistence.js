export const config = { runtime: 'nodejs' };

async function parseJSON(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (req.body && typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      // ignore and fall through to stream parsing
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function coercePrimitive(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => coercePrimitive(entry))
      .filter((entry) => entry != null);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      const coerced = coercePrimitive(val);
      if (coerced != null) {
        out[key] = coerced;
      }
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

export default async function handler(req, res) {
  const enabled =
    String(process.env.FINISHLINE_PERSISTENCE_ENABLED || '').toLowerCase() ===
    'true';
  const url = process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';

  if (!enabled || !url || !token) {
    return res
      .status(200)
      .json({ ok: true, persisted: false, reason: 'disabled' });
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res
      .status(405)
      .json({ ok: false, error: 'method_not_allowed' });
  }

  let payload = await parseJSON(req);
  if (!payload || typeof payload !== 'object') {
    payload = {};
  }

  const ts = Date.now();
  const day = new Date(ts).toISOString().slice(0, 10);
  const key = `fl:predictions:${day}`;

  const normalized = {
    ts,
    track: coercePrimitive(payload.track),
    race: coercePrimitive(payload.race),
    surface: coercePrimitive(payload.surface),
    distance: coercePrimitive(
      payload.distance ?? payload.distance_input ?? payload.distancePretty
    ),
    confidence: coercePrimitive(payload.confidence),
    top3_mass: coercePrimitive(payload.top3_mass),
    picks: coercePrimitive(payload.picks),
    strategy: coercePrimitive(payload.strategy),
    meta: coercePrimitive(payload.meta),
  };

  const json = JSON.stringify(normalized);

  try {
    const lpushEndpoint = `${url}/LPUSH/${encodeURIComponent(key)}`;
    const response = await fetch(lpushEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([json]),
    });

    if (!response.ok) {
      const reason = await response.text().catch(() => 'unknown');
      return res.status(200).json({
        ok: false,
        persisted: false,
        key,
        reason,
      });
    }

    return res
      .status(200)
      .json({ ok: true, persisted: true, key });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      persisted: false,
      key,
      reason: error?.message || 'fetch_failed',
    });
  }
}

