// Temporary smoke-test stub for /api/verify_race

// This should NEVER throw and should always return 200.

export default async function handler(req, res) {
  try {
    const method = req.method || "UNKNOWN";

    // Try to parse JSON body safely (handles string or object)
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // ignore parse error, keep raw string
      }
    }

    return res.status(200).json({
      ok: true,
      step: "verify_race_stub",
      message: "Temporary stub handler reached successfully.",
      method,
      body: body ?? null,
    });
  } catch (err) {
    // Even if something unexpected happens, still return 200 with an error field
    return res.status(200).json({
      ok: false,
      step: "verify_race_stub_error",
      error: String(err?.message || err),
    });
  }
}
