// api/photo_extract_openai_b64.js
// --------------------------------------------------
export const config = { runtime: 'nodejs18.x' };

import { openaiJSON, normalizeHorsesFromText } from './_openai.js';

function badRequest(res, msg) {
  return res.status(400).json({ ok: false, error: msg });
}

// NOTE: FINISHLINE_OCR_ENABLED is optional; we'll still parse if present.
// Expect: { images: [ "data:image/png;base64,..." ] }
export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { images } = req.body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return badRequest(res, 'No images provided.');
    }

    // Validate base64 shape early to avoid OpenAI 400
    const first = String(images[0] || '');
    if (!/^data:(image|application\/pdf)/i.test(first)) {
      return badRequest(res, 'Expected base64 data URL(s) for images or PDF.');
    }

    // Build a single multimodal prompt oriented to grids/lists
    const content = [
      { type: 'text',
        text:
`You are an expert OCR+parser. Read the attached image(s) of a racetrack program or results sheet.

Extract rows as text lines in this strict order per line:

Horse Name | ML Odds | Jockey | Trainer

- If a column is missing, leave it blank.

- Do not include race date/track/surface in the rows.

- Only return lines for horses (ignore headings).`
      },
      ...images.map(u => ({ type: 'image_url', image_url: { url: typeof u === 'string' ? u : u.url || u } })),
    ];

    // Use Chat Completions API (json output) – compatible with gpt-4o/gpt-4o-mini family
    const data = await openaiJSON({
      url: 'https://api.openai.com/v1/chat/completions',
      body: {
        model: process.env.FINISHLINE_OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You extract racing entries as text. Return only the lines, one per horse.' },
          { role: 'user', content }
        ],
        temperature: 0.2,
      }
    });

    // The Chat Completions API returns choices[0].message.content
    let text = '';
    if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
      text = String(data.choices[0].message.content || '');
    } else if (typeof data.output_text === 'string') {
      text = data.output_text;
    } else if (Array.isArray(data.output) && data.output[0]?.content?.[0]?.text) {
      text = String(data.output[0].content[0].text || '');
    }

    if (!text || text.trim().length < 2) {
      throw new Error('OCR produced empty output');
    }

    const lines = text
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    const horses = normalizeHorsesFromText(lines);

    if (!horses.length) {
      return badRequest(res, 'OCR parsed no horse rows. Try a clearer screenshot/crop.');
    }

    return res.status(200).json({ ok: true, horses, raw: { linesCount: lines.length } });

  } catch (err) {
    // Surface the *real* reason so we can fix it fast
    console.error('[OCR ERROR]', err);
    const msg = String(err?.message || err || 'OCR failed');
    return res.status(500).json({ ok: false, error: `OCR failed: ${msg}` });
  }
}
