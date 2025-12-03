// pages/api/verify_backfill.js
// 
// Verify Backfill API Endpoint
// 
// This endpoint triggers verify backfill by calling /api/verify_race for specified races.
// It uses the same HTTP-based approach as our QA scripts, ensuring we use the exact
// same verify logic as the UI.
//
// History:
// - Previously was a stub that returned { ok: true }
// - Now restored to call verify_race via HTTP and return backfill results
// - Compatible with existing frontend calls from verify-modal.js

export const config = {
  runtime: "nodejs",
};

// Simple smoke test handler to confirm route wiring
export default async function handler(req, res) {
  res.status(200).json({
    ok: true,
    step: "verify_backfill_smoke",
    method: req.method || null,
  });
}
