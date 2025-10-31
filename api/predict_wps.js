import { config as runtimeCfg, setCors, ok, fail, badRequest } from './_http.js';
import { scoreHorses } from './_openai.js';

export const config = runtimeCfg;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') return badRequest(res, 'Method not allowed');

    const body = await readJson(req, res);
    if (!body) return;

    const { horses, meta } = body;

    if (!Array.isArray(horses) || horses.length === 0) {
      return badRequest(res, 'No horses provided');
    }

    // For now reuse scoreHorses; later we can add a heavier model here.
    const prediction = await scoreHorses({ horses, meta: meta || {} });

    return ok(res, { prediction });

  } catch (err) {
    console.error('[predict] ERROR', err);
    return fail(res, 500, 'Predict failed');
  }
}

async function readJson(req, res) {
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString('utf8') || '{}';
    return JSON.parse(raw);
  } catch (e) {
    fail(res, 400, 'Invalid JSON body');
    return null;
  }
}
