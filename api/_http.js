export const config = { runtime: 'nodejs18.x' };

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

export function ok(res, data) {
  try {
    res.status(200).end(JSON.stringify({ ok: true, ...data }));
  } catch (e) {
    res.status(200).end('{"ok":true}');
  }
}

export function fail(res, status = 500, message = 'Server error', details = {}) {
  const body = { ok: false, message, ...details };
  // Always return valid JSON, even if message has quotes/newlines.
  res.status(status).end(JSON.stringify(body));
}

export function badRequest(res, message = 'Bad request', details = {}) {
  return fail(res, 400, message, details);
}

