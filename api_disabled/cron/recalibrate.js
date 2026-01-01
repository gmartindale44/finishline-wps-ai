export const config = { runtime: 'nodejs' };

import fs from "node:fs/promises";
import path from "node:path";
import { redisKeys, redisHGetAll } from "../../lib/redis.js";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const CSV_PATH = path.join(root, "data", "finishline_tests_v1.csv");

function toRow(h) {
  // Map redis hash -> CSV row expected by calibrate.js
  // Confidence (0-1), Top_3_Mass, AI_Picks "A-B-C", Strategy (ATB/Exacta Box/Trifecta Box), Result (Hit/Partial/Miss), ROI_Percent
  let picks = {};
  try { picks = JSON.parse(h.picks || "{}"); } catch {}
  const ai = [picks.win, picks.place, picks.show].filter(Boolean).join("-");
  const conf = h.confidence || "";
  const mass = h.top3_mass || "";
  const strat = h.strategy || "ATB";
  const result = h.result || (h.status==="resolved" ? "Hit" : "Pending");
  const roi = h.roi_percent || "";
  const notes = h.notes || "";
  return `,${(h.track||"")},${(h.raceNo||"")},,,"${conf}","${mass}","${ai}","${strat}","${result}","${roi}",,"${notes.replaceAll('"','""')}"`;
}

function ensureHeader(csv) {
  const header = "Test_ID,Track,Race_No,Surface,Distance,Confidence,Top_3_Mass,AI_Picks,Strategy,Result,ROI_Percent,WinRate,Notes\n";
  return csv.startsWith("Test_ID,") ? csv : header + csv;
}

export default async function handler(req, res) {
  try {
    // Collect resolved logs not yet appended
    const keys = await redisKeys("fl:pred:*");
    const resolved = [];
    
    for (const k of keys) {
      const h = await redisHGetAll(k);
      if (!h || h.status !== "resolved") continue;
      resolved.push(h);
    }
    
    if (!resolved.length) {
      return res.status(200).json({ ok:true, appended:0, calibrated:false });
    }
    
    // Load existing CSV
    let csv = "";
    try { csv = await fs.readFile(CSV_PATH, "utf8"); } catch {}
    csv = ensureHeader(csv);
    
    // Find next Test_ID
    const lastId = (csv.trim().split("\n").length - 1); // naive but fine
    const rows = resolved.map((h, i) => `${lastId + i + 1}${toRow(h)}`).join("\n") + "\n";
    
    await fs.mkdir(path.dirname(CSV_PATH), { recursive: true });
    await fs.appendFile(CSV_PATH, rows, "utf8");
    
    // Run calibrate
    const cmd = "npm run calibrate";
    await new Promise((resolve, reject) => {
      exec(cmd, { cwd: root }, (err, stdout, stderr) => {
        if (err) return reject(stderr || err.message);
        resolve(stdout);
      });
    });
    
    return res.status(200).json({ ok:true, appended: resolved.length, calibrated:true });
  } catch (e) {
    return res.status(200).json({ ok:false, error:String(e) });
  }
}

