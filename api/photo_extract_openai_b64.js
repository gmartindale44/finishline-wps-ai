// /api/photo_extract_openai_b64.js (Node runtime)
import OpenAI from "openai";

const OPENAI_KEY   = process.env.FINISHLINE_OPENAI_API_KEY;
const PRIMARY_MODEL = process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o-mini";
const FALLBACK_MODEL = "gpt-4o";

export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  if (!OPENAI_KEY) return res.status(500).json({ ok:false, error:'Missing FINISHLINE_OPENAI_API_KEY' });

  try {
    const { filename, mime, data } = req.body || {};
    if (!filename || !mime || !data) return res.status(400).json({ ok:false, error:'Bad body: need filename, mime, data' });

    const imageUrl = `data:${mime};base64,${data}`;

    const client = new OpenAI({ apiKey: OPENAI_KEY });

    async function run(model) {
      // Vision prompt tuned for our structure
      const prompt = `
Extract horses from the race sheet. Return ONLY JSON with:
{
  "horses": [
    {"name": string, "odds": string, "jockey": string, "trainer": string}
  ]
}
If something is missing, use empty string. No commentary.`;
      const r = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You are a careful OCR-to-JSON extractor." },
          {
            role: "user",
            content: [
              { type: "text", text: prompt.trim() },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        temperature: 0
      });
      const content = r.choices?.[0]?.message?.content || "";
      let parsed;
      try { parsed = JSON.parse(content); }
      catch {
        // Try to extract JSON substring if model adds text
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : null;
      }
      return parsed;
    }

    console.log('[OCR] model=', PRIMARY_MODEL, 'file=', filename, 'mime=', mime, 'size=', data.length);

    let parsed = null;
    try { parsed = await run(PRIMARY_MODEL); }
    catch (e) {
      console.error('[OCR] primary failed:', e?.message || e);
    }

    if (!parsed || !Array.isArray(parsed.horses)) {
      console.warn('[OCR] fallback model=', FALLBACK_MODEL);
      try { parsed = await run(FALLBACK_MODEL); } catch(e){ console.error('[OCR] fallback failed:', e?.message || e); }
    }

    if (!parsed || !Array.isArray(parsed.horses)) {
      return res.status(500).json({ ok:false, error:'OCR JSON parse failed' });
    }

    // Normalize fields
    const horses = parsed.horses.map(h => ({
      name:    String(h?.name ?? '').trim(),
      odds:    String(h?.odds ?? '').trim(),
      jockey:  String(h?.jockey ?? '').trim(),
      trainer: String(h?.trainer ?? '').trim()
    })).filter(x => x.name || x.odds || x.jockey || x.trainer);

    console.log('[OCR] horses=', horses.length);
    return res.status(200).json({ ok:true, data: { horses } });

  } catch (err) {
    console.error('[OCR ERROR]', err);
    return res.status(500).json({ ok:false, error: err?.message || 'Internal error' });
  }
}