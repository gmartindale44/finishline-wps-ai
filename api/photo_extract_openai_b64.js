import OpenAI from "openai";

export const config = {
  runtime: "nodejs"
};

const OPENAI_KEY   = process.env.FINISHLINE_OPENAI_API_KEY;
const PRIMARY_MODEL = process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o";
const FALLBACK_MODEL = "gpt-4o-mini";

// JSON schema for race list extraction
const RACE_SCHEMA = {
  name: "RaceHorses",
  schema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      horses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            odds: { type: "string" },
            jockey: { type: "string" },
            trainer: { type: "string" }
          },
          required: ["name", "odds", "jockey", "trainer"],
          additionalProperties: false
        }
      }
    },
    required: ["ok", "horses"],
    additionalProperties: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  if (!OPENAI_KEY) return res.status(500).json({ ok:false, error:'Missing FINISHLINE_OPENAI_API_KEY' });

  try {
    // Accept both formats: {image_b64, mode} or {filename, mime, data}
    const { image_b64, mode, filename, mime, data } = req.body || {};
    const base64Data = image_b64 || data;
    const detectedMime = mime || 'image/png';
    
    if (!base64Data) {
      return res.status(400).json({ ok:false, error:'Bad body: need image_b64 (or filename+mime+data)' });
    }

    const imageUrl = `data:${detectedMime};base64,${base64Data}`;
    const client = new OpenAI({ apiKey: OPENAI_KEY });

    // Tailored prompt for race lists
    const SYSTEM = `You extract structured data from race program lists. Output only JSON that matches the provided schema.`;

    const USER_PROMPT = `
You are given an image of a horse race entry list. It has three logical columns:

- Left: Horse name (e.g., "Clairita", "Absolute Honor", "Indict", "Jewel Box"...)
- Middle: "Trainer / Jockey". Usually two stacked lines, trainer on top and jockey on bottom:
    Example cell:
      "Philip A. Bauer
       Luis Saez"
- Right: Morning-line odds (e.g., "10/1", "5/2", "8/1", "15/1", "9/2", "20/1", "9/5", "6/1")

Rules:
- Return an array "horses", one object per row.
- For each row, extract:
  - name (horse name only, no sire/breeding)
  - trainer (trainer's full name)
  - jockey (jockey's full name)
  - odds (verbatim odds string like "10/1", "5/2", "9/5")
- Ignore sire, breeding, numbers in parentheses, and other noise.
- If a field is missing, use an empty string "".
- Output only JSON in the exact schema—no prose, no markup.
`;

    // Call OpenAI with race list tailored prompt and schema
    async function callOpenAI(model) {
      const r = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: USER_PROMPT.trim() },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: RACE_SCHEMA
        }
      });
      return r;
    }

    // Safe JSON parsing helper
    function safeJSON(str) {
      try { return JSON.parse(str); } catch { return null; }
    }

    // Regex/line-parser fallback for race lists
    function parseLinesFallback(rawText) {
      // Normalize newlines and collapse weird spacing
      const text = rawText.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();

      // Split into lines and group rows by blank lines or odds end anchors
      const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);

      // We'll collect rows: name, trainer, jockey, odds
      const horses = [];

      // A row in the snapshot typically looks like:
      // HorseName
      // Trainer Name
      // Jockey Name
      // Odds (on far right)
      // But because OCR mixes columns, we center our extraction around odds tokens:
      const ODDS = /\b(\d+\s*\/\s*\d+)\b/;   // 10/1, 5/2, 9/5, 20/1, etc.

      // Walk through lines; whenever a line has odds, look back a few lines for name/trainer/jockey
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(ODDS);
        if (!m) continue;
        const odds = m[1].replace(/\s+/g, '');

        // Look back up to 3-4 lines for trainer and jockey; name is usually above them
        const back = (k) => (i - k >= 0 ? lines[i - k] : '');

        // Heuristic:
        // i-1: jockey (often shorter, last line in the middle column)
        // i-2: trainer (often above jockey)
        // i-3+: name (horse name - likely a single capitalized phrase without commas/slashes)
        const jockeyLine  = back(1);
        const trainerLine = back(2);

        // find a plausible name among the previous 3–5 lines
        let name = '';
        for (let k = 3; k <= 6; k++) {
          const candidate = back(k);
          if (!candidate) break;
          // Reject lines that look like odds or clearly not a name
          if (ODDS.test(candidate)) continue;
          if (/trainer|jockey|odds/i.test(candidate)) continue;
          // Prefer a couple words with capitals
          if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/.test(candidate)) {
            name = candidate.replace(/\s+\(\d+\)\s*$/, '').trim(); // drop "(93)" etc.
            break;
          }
        }

        // Clean trainer/jockey (strip stray punctuation)
        const clean = (s) => (s || '').replace(/^[•\-\u2022]+\s*/,'').trim();

        const trainer = clean(trainerLine);
        const jockey  = clean(jockeyLine);

        if (name || trainer || jockey) {
          horses.push({ name, trainer, jockey, odds });
        }
      }

      // De-dup by (name,odds) in case OCR repeats
      const dedup = new Map();
      for (const h of horses) {
        const key = `${h.name}|${h.odds}`;
        if (!dedup.has(key)) dedup.set(key, h);
      }
      return Array.from(dedup.values());
    }

    console.log('[OCR] model=', PRIMARY_MODEL, 'mode=', mode || 'default', 'size=', base64Data.length);

    let response = null;
    let usedModel = PRIMARY_MODEL;
    
    // Try primary model first
    try {
      response = await callOpenAI(PRIMARY_MODEL);
    } catch (e) {
      console.error('[OCR] primary model failed:', e?.message || e);
      
      // Try fallback model if primary fails
      if (e?.message?.includes('model') || e?.message?.includes('not found') || e?.message?.includes('Invalid model')) {
        console.warn('[OCR] trying fallback model=', FALLBACK_MODEL);
        try {
          response = await callOpenAI(FALLBACK_MODEL);
          usedModel = FALLBACK_MODEL;
        } catch (e2) {
          console.error('[OCR] fallback model failed:', e2?.message || e2);
          throw e2;
        }
      } else {
        throw e;
      }
    }

    // Parse response
    let payload = null;
    const responseText = response?.choices?.[0]?.message?.content || "";
    
    // Try schema parsing first
    payload = safeJSON(responseText);
    if (!payload?.horses) {
      console.log('[OCR] Schema parsing failed, trying line parser fallback');
      const fallbackHorses = parseLinesFallback(responseText);
      payload = { ok: true, horses: fallbackHorses };
    }

    if (!payload || !Array.isArray(payload.horses)) {
      throw new Error('No valid horse data found in response');
    }

    // Normalize and validate fields
    const horses = payload.horses.map(h => ({
      name:    String(h?.name ?? '').trim(),
      odds:    String(h?.odds ?? '').trim(),
      jockey:  String(h?.jockey ?? '').trim(),
      trainer: String(h?.trainer ?? '').trim()
    })).filter(x => x.name || x.odds || x.jockey || x.trainer);

    console.log('[OCR] success:', {
      model: usedModel,
      horses: horses.length,
      preview: horses.slice(0, 2).map(h => h.name)
    });

    return res.status(200).json({ ok: true, horses });

  } catch (err) {
    console.error('[API ERROR]', err);
    const status = err?.status || err?.statusCode || 500;
    return res.status(status).json({ 
      ok: false, 
      error: String(err?.message || err || 'OCR extraction failed')
    });
  }
}