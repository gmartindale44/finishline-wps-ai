import { ok, fail, preflight } from './_respond.js';
import { scoreHorses } from './_openai.js';

export const config = { runtime: 'nodejs' }; // Valid values: 'edge' | 'experimental-edge' | 'nodejs'

export default async function handler(req, res) {
  try {
    if (preflight(req, res)) return;

    if (req.method !== 'POST') {
      return fail(res, 405, 'Method not allowed');
    }

    // Body safety: accept either JSON or form-data parsers that already ran
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

    const { horses, meta } = body || {};
    const analysis = await scoreHorses({ horses, meta });

    return ok(res, analysis);
  } catch (err) {
    console.error('[API ERROR analyze]', err);
    const status = err?.status || err?.statusCode || 500;
    return fail(res, status, err?.message || 'Analyze failed', { detail: err?.detail });
  }
}
