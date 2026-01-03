// pages/api/calibration/summary.js
// Calibration summary endpoint with PayGate protection

export const config = { runtime: 'nodejs' };

import { getCalibrationSummary } from '../../../lib/calibration-summary.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Server-side PayGate check (non-blocking in monitor mode)
  try {
    const { checkPayGateAccess } = await import('../../../lib/paygate-server.js');
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
    console.warn('[calibration/summary] PayGate check failed (non-fatal):', paygateErr?.message);
  }

  try {
    const limit = Math.min(200, Number(req.query.limit || 50));
    const data = await getCalibrationSummary(limit);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
}

