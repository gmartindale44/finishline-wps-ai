import OpenAI from "openai";
import { setCors, ok, fail, badRequest } from './_http.js';

export const config = { runtime: 'nodejs' };

const OPENAI_KEY = process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const OCR_MODEL = process.env.FINISHLINE_OPENAI_MODEL || process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini';

const SYSTEM = `You extract horse race tables into strict JSON only.

Return: { "horses": [ { "name": "...", "ml_odds": "5/2", "jockey": "...", "trainer": "..." }, ... ] }.

Rules:
- Always output a valid JSON object with a "horses" array.
- ml_odds may be fractional or a number; return as string.
- Trim whitespace; omit nulls/unknowns rather than inventing values.`;

function repairJson(text='') {
  // Try to pull the largest JSON object from messy text
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = text.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return badRequest(res, 'Method not allowed');

  if (!OPENAI_KEY) {
    return fail(res, 500, 'OpenAI API key not configured');
  }

  try {
    const body = await readJson(req, res);
    if (!body) return; // readJson already responded

    const { files = [], image_b64, meta = {} } = body;
    
    // Support both {files: [{b64, ...}]} and {image_b64} formats
    let filesToProcess = [];
    if (Array.isArray(files) && files.length > 0) {
      filesToProcess = files;
    } else if (image_b64) {
      filesToProcess = [{ b64: image_b64, type: 'image/jpeg' }];
    } else {
      return badRequest(res, 'No files or image_b64 provided');
    }

    const client = new OpenAI({ apiKey: OPENAI_KEY });

    // Build user prompt
    const user = `Extract a horse table from the attached images/PDF.
Fields per row: name, ml_odds, jockey, trainer. Output only JSON as specified. Meta: ${JSON.stringify(meta)}`;

    // Create content array for images (OpenAI Vision API format)
    const content = [{ type: 'text', text: user }];
    
    for (const f of filesToProcess) {
      if (!f?.b64) continue;
      const mime = (f.type && typeof f.type === 'string') ? f.type : 'image/jpeg';
      const imageUrl = `data:${mime};base64,${f.b64}`;
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    }

    let parsed = null;
    let lastText = '';

    // Try up to 2 times with JSON-only format
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const resp = await client.chat.completions.create({
          model: OCR_MODEL,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content }
          ],
          response_format: { type: 'json_object' },
          temperature: 0
        });

        lastText = (resp?.choices?.[0]?.message?.content || '').trim();
        
        try {
          parsed = JSON.parse(lastText);
        } catch {
          parsed = repairJson(lastText);
        }
      } catch (err) {
        console.error(`[OCR] Attempt ${attempt + 1} failed:`, err?.message || err);
        if (attempt === 1) throw err;
      }
    }

    if (!parsed || !Array.isArray(parsed.horses)) {
      // Return empty set, never HTML/text
      return ok(res, { horses: [] });
    }

    // Normalize
    const horses = parsed.horses.map((h) => {
      const name = String(h?.name || '').trim();
      const ml = h?.ml_odds != null ? String(h.ml_odds).trim() : undefined;
      const jockey = h?.jockey ? String(h.jockey).trim() : undefined;
      const trainer = h?.trainer ? String(h.trainer).trim() : undefined;
      return { name, ml_odds: ml, jockey, trainer };
    }).filter(h => h.name);

    return ok(res, { horses });

  } catch (err) {
    console.error('[OCR ERROR]', err);
    const status = err?.status || err?.statusCode || 500;
    return fail(res, status, err?.message || 'OCR failed');
  }
}
