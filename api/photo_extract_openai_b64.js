export const config = {
  runtime: "nodejs",
  api: { bodyParser: { sizeLimit: "15mb" } }
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imagesB64, kind = "main" } = req.body || {};
    if (!Array.isArray(imagesB64) || imagesB64.length === 0) {
      return res.status(400).json({ error: "No imagesB64 provided" });
    }

    const model = process.env.FINISHLINE_OPENAI_MODEL || "gpt-4o-mini";

    // Prefer helper if present, else fallback client
    let openai;
    try {
      const mod = await import("./_openai.js");
      openai = mod.getOpenAIClient ? mod.getOpenAIClient() : (mod.default?.getOpenAIClient?.() ?? null);
    } catch {}
    if (!openai) {
      const { default: OpenAI } = await import("openai");
      const key = process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      if (!key) return res.status(500).json({ error: "Missing OPENAI API key" });
      openai = new OpenAI({ apiKey: key });
    }

    let promptText;
    if (kind === "speed") {
      promptText = "Extract a JSON object {speed:[{name, speedFig}...]} from this Speed Figure table. Match horse names and their speed figures. Return only JSON, no prose.";
    } else {
      promptText = "Extract a JSON object {entries:[{horse, odds, jockey, trainer, speedFig}...]} strictly. Include speedFig if present (e.g., from '(114*)' format). No prose.";
    }

    const content = [
      { type: "text", text: promptText },
      ...imagesB64.map(b64 => ({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }))
    ];

    const r = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" }
    });

    const text = r?.choices?.[0]?.message?.content ?? "{}";
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    // Extract speed figures from text (for main or speed kind)
    function extractSpeedFigsFromText(text) {
      const map = {};
      // Matches: Horse Name (113) or Horse Name (113*)
      const re = /([A-Za-z0-9'&.\-\s]+?)\s*\(\s*(\d{2,3})\s*\*?\s*\)/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const name = m[1].trim().replace(/\s+/g, ' ');
        const fig = Number(m[2]);
        if (fig) map[name] = fig;
      }
      return map;
    }

    if (kind === "speed") {
      // Normalize speed table
      let speedFigs = {};
      if (json.speed && Array.isArray(json.speed)) {
        json.speed.forEach(s => {
          const name = String(s.name || s.horse || '').trim();
          const fig = typeof s.speedFig === 'number' ? s.speedFig : (s.speedFig ? Number(s.speedFig) : null);
          if (name && fig) speedFigs[name] = fig;
        });
      }
      // Also extract from raw text
      const textFigs = extractSpeedFigsFromText(text);
      speedFigs = { ...speedFigs, ...textFigs };
      return res.status(200).json({ ok: true, model, speed: Object.keys(speedFigs).map(n => ({ name: n, speedFig: speedFigs[n] })), speedFigs });
    } else {
      // Normalize entries to ensure speedFig is present
      if (json.entries && Array.isArray(json.entries)) {
        json.entries = json.entries.map(e => ({
          horse: e.horse || e.name || '',
          jockey: e.jockey || '',
          trainer: e.trainer || '',
          odds: e.odds || '',
          speedFig: typeof e.speedFig === 'number' ? e.speedFig : (e.speedFig ? Number(e.speedFig) : null),
        }));
      }

      // Extract speedFigs from text
      const speedFigs = extractSpeedFigsFromText(text);

      // Ensure notes structure
      if (!json.notes) json.notes = { alsoRans: [] };

      return res.status(200).json({ ok: true, model, ...json, speedFigs });
    }
  } catch (err) {
    console.error("[OCR] err", err?.message);
    return res.status(500).json({ error: err?.message || "OCR failed" });
  }
}
