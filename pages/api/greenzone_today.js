// pages/api/greenzone_today.js
// Safe stub for GreenZone lab – always returns 200 with empty suggestions.

export default async function handler(req, res) {
  try {
    return res.status(200).json({
      suggestions: [],
      info: "GreenZone lab stub: no suggestions yet.",
    });
  } catch (err) {
    console.error("[greenzone_today] error", err);
    return res.status(200).json({
      suggestions: [],
      error: err?.message || String(err) || "Unknown error",
    });
  }
}
