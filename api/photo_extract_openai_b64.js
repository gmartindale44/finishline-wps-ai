import { setCors, ok, fail, badRequest } from './_http.js';
import { extractEntriesFromImages } from './_openai.js';

export const config = { runtime: 'nodejs' };

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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return badRequest(res, 'Method not allowed');

  try {
    const body = await readJson(req, res);
    if (!body) return; // readJson already responded

    const { files = [], meta = {} } = body;
    
    if (!Array.isArray(files) || files.length === 0) {
      return badRequest(res, 'No files provided');
    }

    // Normalize file format: accept both {data, mime} and {b64, type}
    const normalizedFiles = files.map(f => ({
      data: f.data || f.b64 || '',
      mime: f.mime || f.type || 'image/png'
    })).filter(f => f.data);

    if (normalizedFiles.length === 0) {
      return badRequest(res, 'No valid file data provided');
    }

    const out = await extractEntriesFromImages({ files: normalizedFiles, meta });
    return ok(res, out); // { horses, meta, notes }

  } catch (err) {
    console.error('[photo_extract_openai_b64] error', err);
    const msg = typeof err?.message === "string" ? err.message : String(err);
    const status = err?.status || err?.statusCode || 500;
    return fail(res, status, `OCR failed — ${msg}`, {
      error: `OCR failed — ${msg}`,
      detail: {
        hint: "Ensure FINISHLINE_OPENAI_API_KEY is set and the model supports image input.",
        envKeys: Object.keys(process.env).filter(k => k.includes("OPENAI")),
        model: process.env.FINISHLINE_OPENAI_MODEL
      }
    });
  }
}
