export const config = { runtime: 'nodejs' };

import { redisHSet } from "../../lib/redis.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok:false });
    
    const body = req.body || {};
    
    // Required minimal fields:
    // race_id (deterministic: `${track}:${date}:${raceNo}`), track, date, raceNo
    // picks {win,place,show}, confidence, top3_mass, strategy, meta
    // Example race_id if not provided:
    const race_id = body.race_id || `${(body.track||'').trim()}:${(body.date||'').trim()}:${(body.raceNo||'').trim()}`;
    
    const log_key = `fl:pred:${race_id}`;
    
    const payload = {
      race_id,
      track: body.track || "",
      date: body.date || "",
      raceNo: String(body.raceNo||""),
      picks: JSON.stringify(body.picks||{}),
      confidence: String(body.confidence ?? ""),
      top3_mass: String(body.top3_mass ?? ""),
      strategy: body.strategy || "",
      status: "pending",
      created_ts: String(Date.now()),
      result: "",
      roi_percent: "",
      notes: body.notes || ""
    };
    
    const ok = await redisHSet(log_key, payload);
    return res.status(200).json({ ok, race_id });
  } catch(e) {
    return res.status(200).json({ ok:false, error:String(e) });
  }
}

