export const config = { runtime: 'nodejs' };

import { redisHSet } from "../../lib/redis.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok:false });
    
    const { race_id, result="Miss", roi_percent="", notes="" } = req.body || {};
    
    if (!race_id) return res.status(200).json({ ok:false, error:"race_id required" });
    
    const ok = await redisHSet(`fl:pred:${race_id}`, {
      status: "resolved",
      result,
      roi_percent: String(roi_percent),
      resolved_ts: String(Date.now()),
      notes
    });
    
    return res.status(200).json({ ok });
  } catch(e) {
    return res.status(200).json({ ok:false, error:String(e) });
  }
}

