export const config = { runtime: 'nodejs' };

import { getCalibrationSummary } from '../../lib/calibration-summary.js';

export default async function handler(req, res) {
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

