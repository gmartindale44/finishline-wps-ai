#!/usr/bin/env node
/**
 * rebuild_calibration_from_logs.mjs
 *
 * Calibration Rebuilder (defensive version)
 * -----------------------------------------
 * - Reads prediction logs from Redis keys with prefix "fl:pred:"
 * - Reads verify logs from Redis keys with prefix "fl:verify:"
 * - Joins them on (track, date, raceNo)
 * - Computes hit flags (win / place / show / top3)
 * - Writes CSV to data/calibration_from_logs_v1.csv
 *
 * This version is intentionally defensive:
 * - Fetches keys one-by-one (no pipelines)
 * - Skips keys that have WRONGTYPE or bad/missing JSON
 */

import { Redis } from "@upstash/redis";
import fs from "node:fs/promises";
import path from "node:path";

// ---- Redis setup ----------------------------------------------------------

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error(
    "[Calibration] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN."
  );
  process.exit(1);
}

const redis = new Redis({ url, token });

// Hard-code the prefixes we’ve been using in FinishLine
const PRED_PREFIX = "fl:pred:";
const VERIFY_PREFIX = "fl:verify:";

// ---- Helpers --------------------------------------------------------------

async function scanAllKeys(prefix) {
  console.log(`[Calibration] Scanning keys with prefix "${prefix}"...`);
  let cursor = 0;
  const keys = [];

  // Upstash scan returns [cursor, keys]
  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match: `${prefix}*`,
      count: 100,
    });
    cursor = Number(nextCursor);
    if (Array.isArray(batch)) {
      keys.push(...batch);
    }
  } while (cursor !== 0);

  console.log(
    `[Calibration]   Found ${keys.length} keys for prefix "${prefix}".`
  );
  return keys;
}

async function safeGetJson(key) {
  try {
    const value = await redis.get(key);

    if (value == null) {
      return null;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (err) {
        console.warn(
          `[Calibration] Skipping key ${key} – value is not valid JSON.`
        );
        return null;
      }
    }

    // Sometimes Upstash returns already-parsed JSON
    if (typeof value === "object") {
      return value;
    }

    console.warn(
      `[Calibration] Skipping key ${key} – unsupported value type: ${typeof value}.`
    );
    return null;
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.includes("WRONGTYPE")) {
      console.warn(
        `[Calibration] Skipping key ${key} – WRONGTYPE (non-string Redis type).`
      );
      return null;
    }
    console.error(`[Calibration] Error reading key ${key}:`, err);
    throw err;
  }
}

function normalizeRaceId(track, date, raceNo) {
  const t = (track || "").trim();
  const d = (date || "").trim();
  const r = String(raceNo || "").trim();
  if (!t || !d || !r) return null;
  return `${t}|${d}|${r}`;
}

function csvEscape(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---- Main -----------------------------------------------------------------

async function main() {
  console.log("[Calibration] Rebuilder starting…");
  console.log(`[Calibration] Using URL: ${url}`);
  console.log("[Calibration] Using prefixes:", {
    PRED_PREFIX,
    VERIFY_PREFIX,
  });

  // 1. Collect keys
  const predKeys = await scanAllKeys(PRED_PREFIX);
  const verifyKeys = await scanAllKeys(VERIFY_PREFIX);

  // 2. Load verify logs into a lookup map
  const verifyByRaceId = new Map();

  console.log("[Calibration] Loading verify logs…");
  for (const key of verifyKeys) {
    const data = await safeGetJson(key);
    if (!data) continue;

    // Two shapes we might see:
    //  - { request: {...}, response: {...} }
    //  - or just a flat object
    const resp = data.response || data;

    const track = resp.track || resp.uiTrack || resp.trackName;
    const date =
      resp.date ||
      resp.raceDate ||
      resp.dateIso ||
      (resp.debug && resp.debug.canonicalDateIso);
    const raceNo = resp.raceNo || resp.race || resp.race_number;

    const raceId = normalizeRaceId(track, date, raceNo);
    if (!raceId) {
      console.warn(
        `[Calibration] Verify log from ${key} missing track/date/raceNo – skipping.`
      );
      continue;
    }

    verifyByRaceId.set(raceId, resp);
  }

  console.log(
    `[Calibration] Loaded ${verifyByRaceId.size} verify entries with valid race IDs.`
  );

  // 3. Walk prediction logs and join with verify logs
  console.log("[Calibration] Loading prediction logs & joining…");
  const rows = [];

  for (const key of predKeys) {
    const data = await safeGetJson(key);
    if (!data) continue;

    // Prediction log shape is a bit flexible; try multiple fields
    const ctx = data.context || data.request || data;

    const track = ctx.track || ctx.uiTrack || ctx.trackName;
    const date =
      ctx.date ||
      ctx.raceDate ||
      ctx.dateIso ||
      (ctx.debug && ctx.debug.canonicalDateIso);
    const raceNo = ctx.raceNo || ctx.race || ctx.race_number;

    const raceId = normalizeRaceId(track, date, raceNo);
    if (!raceId) {
      console.warn(
        `[Calibration] Prediction log from ${key} missing track/date/raceNo – skipping.`
      );
      continue;
    }

    const verify = verifyByRaceId.get(raceId);
    if (!verify) {
      // No matching verify race yet – skip for now
      continue;
    }

    // Pull predicted horses from prediction log
    const predBlock = ctx.predicted || ctx.prediction || {};
    const predWin = predBlock.win || predBlock.WIN || "";
    const predPlace = predBlock.place || predBlock.PLACE || "";
    const predShow = predBlock.show || predBlock.SHOW || "";

    // Outcomes from verify
    const outcome = verify.outcome || {};
    const outWin = outcome.win || outcome.WIN || "";
    const outPlace = outcome.place || outcome.PLACE || "";
    const outShow = outcome.show || outcome.SHOW || "";

    // Compute hit flags
    const winHit = predWin && outWin && predWin === outWin;
    const placeHit = predPlace && outPlace && predPlace === outPlace;
    const showHit = predShow && outShow && predShow === outShow;

    const top3Hit =
      !!(
        predWin &&
        (predWin === outWin ||
          predWin === outPlace ||
          predWin === outShow)
      );

    // Optional strategy/metadata
    const strategyName =
      ctx.strategyName || ctx.strategy || verify.strategyName || "";
    const version = ctx.version || verify.version || "";

    rows.push({
      track,
      date,
      raceNo: String(raceNo || ""),
      strategyName,
      version,
      predWin,
      predPlace,
      predShow,
      outWin,
      outPlace,
      outShow,
      winHit,
      placeHit,
      showHit,
      top3Hit,
    });
  }

  console.log(
    `[Calibration] Built ${rows.length} joined prediction/verify rows.`
  );

  // 4. Write CSV
  const headers = [
    "track",
    "date",
    "raceNo",
    "strategyName",
    "version",
    "predWin",
    "predPlace",
    "predShow",
    "outWin",
    "outPlace",
    "outShow",
    "winHit",
    "placeHit",
    "showHit",
    "top3Hit",
  ];

  const lines = [];
  lines.push(headers.join(","));

  for (const row of rows) {
    const line = headers.map((h) => csvEscape(row[h])).join(",");
    lines.push(line);
  }

  const outPath = path.join(
    process.cwd(),
    "data",
    "calibration_from_logs_v1.csv"
  );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, lines.join("\n"), "utf8");

  console.log(
    `[Calibration] Wrote ${rows.length} rows to ${outPath}. ✅`
  );
}

main().catch((err) => {
  console.error("[Calibration] Rebuilder failed:", err);
  process.exit(1);
});
