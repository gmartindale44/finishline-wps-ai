export default async function handler(req, res) {
  const host = req.headers.host;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol =
    (forwardedProto && forwardedProto.split(',')[0]) ||
    (host && host.includes('localhost') ? 'http' : 'https');
  const baseUrl = `${protocol}://${host}`;

  const targets = ['/public/data/calibration_v1.json', '/data/calibration_v1.json'];
  const served = [];
  const missing = [];

  for (const path of targets) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
      if (response.ok) {
        served.push(path);
      } else {
        missing.push(path);
      }
    } catch (err) {
      missing.push(path);
    }
  }

  const ok = served.length > 0;
  res.status(ok ? 200 : 503).json({
    ok,
    served,
    missing,
  });
}


