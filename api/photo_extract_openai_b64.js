export const config = {
  runtime: "nodejs",
  api: { bodyParser: { sizeLimit: "15mb" } }
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imagesB64 } = req.body || {};
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

    const content = [
      { type: "text", text: "Extract a JSON object {entries:[{horse, odds, jockey, trainer}...]} strictly. No prose." },
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

    return res.status(200).json({ ok: true, model, ...json });
  } catch (err) {
    console.error("[OCR] err", err?.message);
    return res.status(500).json({ error: err?.message || "OCR failed" });
  }
}
