import { ok, fail, preflight } from './_respond.js';
import { finalizeWPS } from './_openai.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  try {
    if (preflight(req, res)) return;

    if (req.method !== 'POST') {
      return fail(res, 405, 'Method not allowed');
    }

    let body = req.body;
    if (!body || typeof body !== 'object') {
      try {
        const text = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', (chunk) => (data += chunk));
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });
        body = text ? JSON.parse(text) : {};
      } catch {
        return fail(res, 400, 'Invalid JSON body');
      }
    }

    const { scores, meta } = body || {};
    const result = await finalizeWPS({ scores, meta });
    return ok(res, result);
  } catch (err) {
    console.error('[API ERROR predict]', err);
    const status = err?.status || err?.statusCode || 500;
    return fail(res, status, err?.message || 'Predict failed', { detail: err?.detail });
  }
}
