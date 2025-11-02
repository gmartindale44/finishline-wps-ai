// api/ocr_health.js

export const config = { runtime: 'nodejs' };

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  console.log('[OCR Health] Request:', req.method, req.url);

  return res.status(200).json({ ok: true, endpoint: 'ocr_health', timestamp: Date.now() });
}

