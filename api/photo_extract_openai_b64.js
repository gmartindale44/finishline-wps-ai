// /api/photo_extract_openai_b64.js (Node runtime)
import OpenAI from "openai";

const OPENAI_KEY   = process.env.FINISHLINE_OPENAI_API_KEY;
const PRIMARY_MODEL = process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o-mini";
const FALLBACK_MODEL = "gpt-4o";

export const config = {
  runtime: "nodejs"
};

// JSON schema for strict validation
const HORSE_SCHEMA = {
  "type": "object",
  "required": ["horses"],
  "properties": {
    "horses": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "jockey", "trainer", "odds"],
        "properties": {
          "name": {"type": "string"},
          "jockey": {"type": "string"},
          "trainer": {"type": "string"},
          "odds": {"type": "string"}
        }
      }
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  if (!OPENAI_KEY) return res.status(500).json({ ok:false, error:'Missing FINISHLINE_OPENAI_API_KEY' });

  try {
    const { filename, mime, data } = req.body || {};
    if (!filename || !mime || !data) return res.status(400).json({ ok:false, error:'Bad body: need filename, mime, data' });

    const imageUrl = `data:${mime};base64,${data}`;
    const client = new OpenAI({ apiKey: OPENAI_KEY });

    // Strict JSON mode with schema validation
    async function callOpenAI(model, prompt, imageB64, mime) {
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
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "FinishLineHorseList",
            schema: HORSE_SCHEMA
          }
        }
      });
      return r;
    }

    // Robust parsing with multiple fallback strategies
    function parseResponse(response) {
      let data = null;
      
      // Strategy 1: Trust JSON-mode response (already structured)
      if (response.choices?.[0]?.message?.content) {
        try {
          data = JSON.parse(response.choices[0].message.content);
          console.log('[OCR] JSON-mode success');
          return data;
        } catch (e) {
          console.warn('[OCR] JSON-mode parse failed:', e.message);
        }
      }

      // Strategy 2: Try direct JSON parsing
      const responseText = response.choices?.[0]?.message?.content || "";
      try {
        data = JSON.parse(responseText);
        console.log('[OCR] Direct JSON parse success');
        return data;
      } catch (e) {
        console.warn('[OCR] Direct JSON parse failed:', e.message);
      }

      // Strategy 3: Salvage JSON with balanced-brace heuristic
      try {
        const match = responseText.match(/\{[\s\S]*\}/);
        if (match) {
          data = JSON.parse(match[0]);
          console.log('[OCR] Salvaged JSON success');
          return data;
        }
      } catch (e) {
        console.warn('[OCR] JSON salvage failed:', e.message);
      }

      // Strategy 4: Line parser fallback
      console.log('[OCR] Falling back to line parser');
      return lineParseHorses(responseText);
    }

    // Lightweight line parser for fallback
    function lineParseHorses(text) {
      const horses = [];
      const lines = (text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      
      for (const line of lines) {
        // Look for odds patterns like "10/1", "5/2", "9/5", "20/1"
        const oddsMatch = line.match(/\b\d{1,2}\/\d{1,2}\b/);
        if (oddsMatch) {
          const odds = oddsMatch[0];
          const name = line.split(odds)[0].trim();
          if (name) {
            horses.push({
              name: name,
              odds: odds,
              jockey: "",
              trainer: ""
            });
          }
        }
      }
      
      return { horses };
    }

    const prompt = "Extract a JSON object with property 'horses' which is an array of objects with fields: name (string), jockey (string), trainer (string), odds (string). Return ONLY JSON. Do not include explanations. The input is an image of a race card.";

    console.log('[OCR] model=', PRIMARY_MODEL, 'file=', filename, 'mime=', mime, 'size=', data.length);

    let response = null;
    let usedModel = PRIMARY_MODEL;
    
    // Try primary model first
    try {
      response = await callOpenAI(PRIMARY_MODEL, prompt, data, mime);
    } catch (e) {
      console.error('[OCR] primary model failed:', e?.message || e);
      
      // Try fallback model if primary fails
      if (e?.message?.includes('model') || e?.message?.includes('not found') || e?.message?.includes('Invalid model')) {
        console.warn('[OCR] trying fallback model=', FALLBACK_MODEL);
        try {
          response = await callOpenAI(FALLBACK_MODEL, prompt, data, mime);
          usedModel = FALLBACK_MODEL;
        } catch (e2) {
          console.error('[OCR] fallback model failed:', e2?.message || e2);
          throw e2;
        }
      } else {
        throw e;
      }
    }

    // Parse response with robust fallback strategies
    const parsed = parseResponse(response);
    
    if (!parsed || !Array.isArray(parsed.horses)) {
      throw new Error('No valid horse data found in response');
    }

    // Validate and normalize fields
    const horses = parsed.horses.map(h => ({
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
    console.error('[OCR ERROR]', err);
    return res.status(500).json({ 
      ok: false, 
      error: "OCR JSON parse failed", 
      diag: err?.message || 'Internal error' 
    });
  }
}