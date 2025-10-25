/**
 * Node serverless function (Vercel) to accept multipart "file",
 * send to OpenAI OCR (image->text), and return horses[] in a safe normalized format.
 */
export const config = {
  // Force Node.js runtime; Edge cannot handle formidable/multipart streams.
  runtime: "nodejs"
};

const MAX_BYTES = 10 * 1024 * 1024; // 10MB cap

// Minimal base64 helper
function toBase64(buf) {
  return Buffer.from(buf).toString("base64");
}

function log(...args) {
  console.log("[OCR]", ...args);
}

function errorRes(res, code, message, extra) {
  res.status(code).json({ ok: false, error: message, ...extra });
}

async function parseMultipart(req) {
  // formidable is CommonJS; use dynamic import to keep ESM compat
  const formidable = (await import("formidable")).default;
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_BYTES,
    allowEmptyFiles: false
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const file = files?.file || files?.image || files?.upload;
      if (!file) return reject(new Error("No file field named 'file' found."));
      // formidable v3 returns file as array or single; normalize
      const f = Array.isArray(file) ? file[0] : file;
      resolve({ fields, file: f });
    });
  });
}

function normalizeHorsesFromText(text) {
  // Extremely forgiving extractor: look for lines like:
  // Clarita ... 10/1 ... Luis Saez ... Philip A. Bauer
  // This is a simple heuristic; your smarter parser can remain elsewhere.
  const horses = [];
  const lines = (text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  // Very simple grouping per line; let your existing downstream logic improve this.
  for (const line of lines) {
    // Try odds like "10/1", "5/2", "9/5", "20/1" etc.
    const oddsMatch = line.match(/\b\d{1,2}\/\d{1,2}\b/);
    // Try to split name before odds
    let name = line;
    let odds = "";
    if (oddsMatch) {
      odds = oddsMatch[0];
      name = line.split(odds)[0].trim();
    }
    if (name) {
      horses.push({ name, odds, jockey: "", trainer: "" });
    }
  }
  return horses;
}

async function callOpenAIImageToText({ key, model, b64, filename, mimetype }) {
  // Use the official REST endpoint with JSON (no SDK required).
  // Model defaults to gpt-4o-mini; fallback to gpt-4o if needed.
  const endpoint = "https://api.openai.com/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json"
  };

  // Use Chat Completions with vision content (image_url + data URI)
  const imageDataUrl = `data:${mimetype};base64,${b64}`;
  const body = {
    model: model || "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the horse entries (horse name, odds, jockey, trainer) from this image. Output as JSON array with keys: name, odds, jockey, trainer. If info is missing for a horse, leave that key empty." },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]
      }
    ],
    temperature: 0.2
  };

  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text || res.statusText}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || "";
  return text;
}

export default async function handler(req, res) {
  const started = Date.now();
  const reqId = req.headers["x-vercel-id"] || `local-${started}`;
  try {
    log("START", { reqId, method: req.method });

    if (req.method !== "POST") {
      return errorRes(res, 405, "Method not allowed");
    }

    // Resolve API key
    const key = process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
    if (!key) {
      return errorRes(res, 500, "Missing FINISHLINE_OPENAI_API_KEY / OPENAI_API_KEY");
    }
    const model = process.env.FINISHLINE_OPENAI_MODEL || process.env.FINISHLINE_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Parse multipart
    const { file } = await parseMultipart(req);
    const filepath = file?.filepath || file?.path;
    const mimetype = file?.mimetype || file?.type || "application/octet-stream";
    const originalFilename = file?.originalFilename || file?.name || "upload";

    if (!filepath) throw new Error("Upload parse failed (no filepath).");

    // Read file
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(filepath);
    if (!buf?.length) throw new Error("File read returned empty buffer.");

    const b64 = toBase64(buf);
    log("File parsed", { reqId, bytes: buf.length, mimetype, originalFilename, model });

    // Call OpenAI for OCR/text extraction
    let text;
    try {
      text = await callOpenAIImageToText({ key, model, b64, filename: originalFilename, mimetype });
    } catch (e) {
      // Retry with fallback model
      log("Primary model failed, retrying with gpt-4o", e?.message);
      text = await callOpenAIImageToText({ key, model: "gpt-4o", b64, filename: originalFilename, mimetype });
    }

    // Try to parse JSON block if the model returned a JSON array; otherwise, use a heuristic
    let horses = [];
    try {
      const jsonBlock = text.match(/\[[\s\S]*\]/)?.[0];
      if (jsonBlock) {
        horses = JSON.parse(jsonBlock);
      } else {
        horses = normalizeHorsesFromText(text);
      }
    } catch {
      horses = normalizeHorsesFromText(text);
    }

    const payload = { ok: true, horses };
    log("DONE", { reqId, ms: Date.now() - started, horses: horses.length });
    return res.status(200).json(payload);
  } catch (e) {
    log("ERROR", { reqId, message: e?.message, stack: e?.stack });
    return errorRes(res, 500, "FUNCTION_INVOCATION_FAILED", { reqId, detail: e?.message });
  }
}
