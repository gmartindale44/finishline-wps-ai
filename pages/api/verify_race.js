// Temporary ultra-safe stub for /api/verify_race
// Purpose: eliminate 500s while we rebuild the real implementation.

function safeParseBody(body) {
  if (body == null) return null;
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export default async function handler(req, res) {
  const parsedBody = safeParseBody(req.body);

  return res.status(200).json({
    ok: true,
    step: "verify_race_stub",
    message: "Temporary verify_race stub handler reached successfully.",
    method: req.method || null,
    body: parsedBody,
    note:
      "This is a temporary stub to keep the app stable while verify_race is being reworked.",
  });
}
