// pages/api/photo_extract_openai_b64.js
// OCR endpoint for extracting horse data from images using OpenAI Vision

export const config = {
  runtime: 'nodejs',
  api: { bodyParser: { sizeLimit: '15mb' } }
};

export default async function handler(req, res) {
  // Set headers
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Handler-Identity', 'PHOTO_EXTRACT_OK');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Only allow POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ 
      ok: false, 
      error: 'POST required',
      message: `Expected POST, received ${req.method}` 
    });
  }

  // Server-side PayGate check (non-blocking in monitor mode)
  try {
    const { checkPayGateAccess } = await import('../../lib/paygate-server.js');
    const accessCheck = checkPayGateAccess(req);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        ok: false,
        error: 'PayGate locked',
        message: 'Premium access required. Please unlock to continue.',
        code: 'paygate_locked',
        reason: accessCheck.reason
      });
    }
  } catch (paygateErr) {
    // Non-fatal: log but allow request (fail-open for safety)
    console.warn('[photo_extract_openai_b64] PayGate check failed (non-fatal):', paygateErr?.message);
  }

  try {
    const body = req.body || {};
    
    // Handle multiple payload formats from frontend
    let imagesB64 = [];
    let kind = 'main';
    
    // Format 1: { imagesB64: string[], kind?: string }
    if (Array.isArray(body.imagesB64)) {
      imagesB64 = body.imagesB64;
      kind = body.kind || 'main';
    }
    // Format 2: { b64: string }
    else if (body.b64) {
      imagesB64 = [body.b64];
    }
    // Format 3: { data_b64: string } or { data: string }
    else if (body.data_b64 || body.data) {
      imagesB64 = [body.data_b64 || body.data];
    }
    // Format 4: { imagesBase64: string[] }
    else if (Array.isArray(body.imagesBase64)) {
      imagesB64 = body.imagesBase64;
    }
    // Format 5: Legacy form data (shouldn't happen with JSON, but handle gracefully)
    else {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid payload format',
        message: 'Expected one of: { imagesB64: string[] }, { b64: string }, { data_b64: string }, { data: string }, or { imagesBase64: string[] }'
      });
    }

    // Validate input
    if (!Array.isArray(imagesB64) || imagesB64.length === 0) {
      return res.status(400).json({ 
        ok: false, 
        error: 'No images provided',
        message: 'At least one base64 image is required'
      });
    }

    // Validate each image is a string
    for (let i = 0; i < imagesB64.length; i++) {
      if (typeof imagesB64[i] !== 'string' || imagesB64[i].length === 0) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Invalid image data',
          message: `Image at index ${i} must be a non-empty base64 string`
        });
      }
    }

    // Get OpenAI model
    const model = process.env.FINISHLINE_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // Initialize OpenAI client
    let openai;
    try {
      const { default: OpenAI } = await import('openai');
      const apiKey = process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ 
          ok: false, 
          error: 'Missing OpenAI API key',
          message: 'FINISHLINE_OPENAI_API_KEY or OPENAI_API_KEY environment variable is required'
        });
      }
      openai = new OpenAI({ apiKey });
    } catch (importErr) {
      console.error('[Photo Extract] Failed to import OpenAI:', importErr?.message);
      return res.status(500).json({ 
        ok: false, 
        error: 'OpenAI client initialization failed',
        message: importErr?.message || 'Unknown error'
      });
    }

    // Build prompt based on kind
    let promptText;
    if (kind === 'speed') {
      promptText = 'Extract a JSON object {speed:[{name, speedFig}...]} from this Speed Figure table. Match horse names and their speed figures. Return only JSON, no prose.';
    } else {
      promptText = 'Extract a JSON object {entries:[{horse, odds, jockey, trainer, speedFig}...]} strictly. Include speedFig if present (e.g., from \'(114*)\' format). No prose.';
    }

    // Build content array with prompt and images
    const content = [
      { type: 'text', text: promptText },
      ...imagesB64.map(b64 => {
        // Remove data URL prefix if present
        const cleanB64 = b64.includes(',') ? b64.split(',')[1] : b64;
        return { 
          type: 'image_url', 
          image_url: { url: `data:image/png;base64,${cleanB64}` } 
        };
      })
    ];

    // Call OpenAI Vision API
    let response;
    try {
      response = await openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        max_tokens: 4000
      });
    } catch (openaiErr) {
      console.error('[Photo Extract] OpenAI API error:', openaiErr?.message);
      return res.status(500).json({ 
        ok: false, 
        error: 'OCR processing failed',
        message: openaiErr?.message || 'OpenAI API error'
      });
    }

    // Parse response
    const text = response?.choices?.[0]?.message?.content ?? '{}';
    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.error('[Photo Extract] JSON parse error:', parseErr?.message);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to parse OCR response',
        message: 'OpenAI returned invalid JSON',
        raw: text.substring(0, 500)
      });
    }

    // Extract speed figures from text (helper function)
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

    // Handle speed kind
    if (kind === 'speed') {
      let speedFigs = {};
      if (json.speed && Array.isArray(json.speed)) {
        json.speed.forEach(s => {
          const name = String(s.name || s.horse || '').trim();
          const fig = typeof s.speedFig === 'number' ? s.speedFig : (s.speedFig ? Number(s.speedFig) : null);
          if (name && fig) speedFigs[name] = fig;
        });
      }
      const textFigs = extractSpeedFigsFromText(text);
      speedFigs = { ...speedFigs, ...textFigs };
      
      return res.status(200).json({ 
        ok: true, 
        model, 
        speed: Object.keys(speedFigs).map(n => ({ name: n, speedFig: speedFigs[n] })), 
        speedFigs 
      });
    }

    // Handle main kind (default)
    // Normalize entries
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

    // Return success response
    return res.status(200).json({ 
      ok: true, 
      model, 
      ...json, 
      speedFigs 
    });

  } catch (err) {
    console.error('[Photo Extract] Unexpected error:', err?.message || err);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error',
      message: err?.message || 'Unexpected error during OCR processing'
    });
  }
}

