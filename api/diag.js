// api/diag.js
// --------------------------------------------------
// Quick masked diagnostics so you can confirm keys & flags in Production/Preview.
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const mask = v => (v ? '●●●● set' : '—');
  res.status(200).json({
    ok: true,
    env: {
      FINISHLINE_OPENAI_API_KEY: mask(process.env.FINISHLINE_OPENAI_API_KEY),
      OPENAI_API_KEY: mask(process.env.OPENAI_API_KEY),
      FINISHLINE_OPENAI_MODEL: process.env.FINISHLINE_OPENAI_MODEL || 'default',
      FINISHLINE_OCR_ENABLED: process.env.FINISHLINE_OCR_ENABLED || 'unset',
      RUNTIME: 'nodejs',
    }
  });
}

