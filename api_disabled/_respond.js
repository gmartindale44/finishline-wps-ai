export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function preflight(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.status(200).end();
    return true;
  }
  return false;
}

export function safeJson(res, status, obj) {
  setCors(res);
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  // Use end(JSON.stringify(...)) so Vercel never falls back to an HTML error page.
  res.end(JSON.stringify(obj));
}

export function ok(res, data) {
  return safeJson(res, 200, { ok: true, ...data });
}

export function fail(res, status = 500, error = 'Unknown error', extra = {}) {
  return safeJson(res, status, { ok: false, error: String(error), ...extra });
}

