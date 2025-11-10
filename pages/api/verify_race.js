import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CSE_BRIDGE = "/api/cse_resolver";
const TTL_SECONDS = 60 * 60 * 24;

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(
  /^"+|"+$/g,
  ""
);
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").replace(
  /^"+|"+$/g,
  ""
);

const CSV = path.join(process.cwd(), "data", "reconciliations_v1.csv");

const slug = (s = "") =>
  s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

async function ensureCsvHeader() {
  try {
    await fs.access(CSV);
  } catch {
    const header =
      "Timestamp,Track,Date,Race_No,Distance,Surface,Strategy,AI_Picks,Query,Result_Count,Top_Title,Top_Link\n";
    await fs.writeFile(CSV, header, "utf8");
  }
}

async function csvAppend(row) {
  await ensureCsvHeader();
  await fs.appendFile(CSV, row + "\n", "utf8");
}

async function redisPipeline(cmds) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
  });
  return res.ok;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ error: "POST only" });
    let payload = {};
    if (typeof req.json === "function") {
      try {
        payload = await req.json();
      } catch {
        payload = {};
      }
    }
    if (!Object.keys(payload).length && req.body) {
      if (typeof req.body === "string") {
        try {
          payload = JSON.parse(req.body);
        } catch (err) {
          return res.status(400).json({ error: "Invalid JSON" });
        }
      } else {
        payload = req.body;
      }
    }

    const {
      track,
      date, // YYYY-MM-DD
      raceNo,
      race_no, // number or string
      distance = "",
      surface = "",
      strategy = "",
      ai_picks = "", // e.g. "WIN:Dancing On Air|PLACE:Feratovic|SHOW:Cantyoustoptheking"
    } = payload;

    const raceNumber = raceNo || race_no;

    if (!track || !date || !raceNumber) {
      return res
        .status(400)
        .json({ error: "Missing required fields: track, date, raceNo" });
    }

    const qParts = [
      track,
      `Race ${raceNumber}`,
      date,
      distance && `${distance}`,
      surface && `${surface}`,
      "results Win Place Show order",
    ].filter(Boolean);
    const query = qParts.join(" ").trim();

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const url = `${proto}://${host}${CSE_BRIDGE}?q=${encodeURIComponent(
      query
    )}`;
    const r = await fetch(url, { cache: "no-store" });
    const payload = await r.json();
    if (!r.ok) {
      return res
        .status(r.status)
        .json({ error: "CSE failed", details: payload?.error || payload });
    }

    const results = Array.isArray(payload?.results) ? payload.results : [];
    const top = results[0] || {};
    const ts = new Date().toISOString();

    const ns = `fl:cse:reconcile:${slug(track)}:${date}:R${raceNumber}`;
    const eventKey = `${ns}:${Date.now()}:${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const cmds = [
      [
        "SET",
        eventKey,
        JSON.stringify({
          ts,
          track,
          date,
          raceNo: raceNumber,
          distance,
          surface,
          strategy,
          ai_picks,
          query,
          count: results.length,
          results: results.slice(0, 10),
        }),
      ],
      ["EXPIRE", eventKey, String(TTL_SECONDS)],
      ["LPUSH", `${ns}:log`, eventKey],
      ["LTRIM", `${ns}:log`, "0", "99"],
      ["EXPIRE", `${ns}:log`, String(TTL_SECONDS)],
    ];
    await redisPipeline(cmds);

    const csvRow = [
      ts,
      `"${track.replace(/"/g, '""')}"`,
      date,
      raceNumber,
      `"${distance.replace(/"/g, '""')}"`,
      `"${surface.replace(/"/g, '""')}"`,
      `"${strategy.replace(/"/g, '""')}"`,
      `"${ai_picks.replace(/"/g, '""')}"`,
      `"${query.replace(/"/g, '""')}"`,
      results.length,
      `"${(top.title || "").replace(/"/g, '""')}"`,
      `"${(top.link || "").replace(/"/g, '""')}"`,
    ].join(",");
    await csvAppend(csvRow);

    return res.status(200).json({
      ok: true,
      saved: { ns, eventKey },
      query,
      count: results.length,
      top,
    });
  } catch (err) {
    console.error("[/api/verify_race]", err);
    return res.status(500).json({
      error: "verify_race failed",
      details: err?.message || String(err),
    });
  }
}

