// pages/api/greenzone_today.js

export default async function handler(req, res) {
  try {
    // Stub implementation for GreenZone lab – always returns 200 with no suggestions.
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
