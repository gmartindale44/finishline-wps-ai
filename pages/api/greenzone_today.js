// pages/api/greenzone_today.js

export default async function handler(req, res) {
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
    console.warn('[greenzone_today] PayGate check failed (non-fatal):', paygateErr?.message);
  }

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
