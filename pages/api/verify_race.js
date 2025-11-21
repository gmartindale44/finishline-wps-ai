// pages/api/verify_race.js
// MINIMAL PING HANDLER - for debugging Vercel crash

export default async function handler(req, res) {
  try {
    console.log("[verify_race] minimal ping handler hit", {
      method: req.method,
      body: req.body,
    });
    return res.status(200).json({
      step: "verify_race",
      ok: true,
      message: "minimal ping ok",
      echo: {
        method: req.method,
        body: req.body ?? null,
      },
    });
  } catch (err) {
    console.error("[verify_race] minimal ping handler error", err);
    return res.status(500).json({
      step: "verify_race",
      ok: false,
      error: String(err && err.message || err),
    });
  }
}
