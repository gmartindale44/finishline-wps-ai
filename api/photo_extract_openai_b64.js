// api/photo_extract_openai_b64.js

export const config = { runtime: 'nodejs' };

import { resolveOpenAIKey } from './_openai.js';

export function resolveOpenAIModel(def = 'gpt-4o-mini') {
  return process.env.FINISHLINE_OPENAI_MODEL || def;
}

function bad(res, code, msg, detail) {
  return res.status(code).json({ error: msg, detail });
}

function ok(res, data) {
  return res.status(200).json(data);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');

    const { b64, mime } = req.body || {};

    if (!b64 || !mime) return bad(res, 400, 'Missing b64 or mime');

    if (!/^image\/(png|jpe?g|webp)$/.test(mime)) {
      return bad(res, 415, 'Unsupported mime', { mime });
    }

    const estBytes = Math.ceil((b64.length * 3) / 4);
    if (estBytes > 2.5 * 1024 * 1024) {
      return bad(res, 413, 'Image too large after client compress (max ~2.5MB)', { estBytes });
    }

    const apiKey = resolveOpenAIKey();
    const model = resolveOpenAIModel('gpt-4o-mini');

    if (!apiKey) return bad(res, 500, 'OpenAI key missing');

    const body = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an OCR engine. Extract all readable text exactly as seen. Do not summarize.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all text.' },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${b64}` },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 2048,
    };

    async function call() {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`OpenAI ${r.status}: ${t || r.statusText}`);
      }

      const j = await r.json();
      const txt = (j.choices?.[0]?.message?.content || '').trim();
      return txt;
    }

    let text = '';
    try {
      text = await call();
    } catch (e) {
      // simple 1 retry on 429/5xx
      if (/\b(429|5\d\d)\b/.test(String(e))) {
        await new Promise(r => setTimeout(r, 600));
        text = await call();
      } else {
        throw e;
      }
    }

    if (!text) return bad(res, 502, 'Empty OCR result');

    return ok(res, { text });
  } catch (err) {
    return bad(res, 500, 'OCR pipeline error', String(err?.stack || err));
  }
}
