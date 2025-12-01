#!/usr/bin/env node
/**
 * Calibration Rebuilder v1
 *
 * Goal:
 *  - Read all prediction + verify logs out of Redis
 *  - Join them into a single race-centric dataset
 *  - Compute hit flags (win/place/show/top3)
 *  - Write CSV to data/finishline_calibration_v1.csv
 *
 * Assumptions:
 *  - Redis is Upstash, already used by the app
 *  - Logs are stored as JSON blobs under key prefixes:
 *      PREDICTION: "fl:pred:" (one key per race)
 *      VERIFY    : "fl:verify:" (one key per race)
 *
 *  If your actual key prefixes differ, you can override via env:
 *      FL_PRED_PREFIX=some_prefix
 *      FL_VERIFY_PREFIX=some_prefix
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";

// ---------- Config ----------

const PRED_PREFIX = process.env.FL_PRED_PREFIX || "fl:pred:";
const VERIFY_PREFIX = process.env.FL_VERIFY_PREFIX || "fl:verify:";

// Uses the same env Upstash expects: UPSTASH_REDIS_REST_URL / TOKEN
const redis = Redis.fromEnv();

// Target CSV
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_PATH = path.join(__dirname, "..", "data", "finishline_calibration_v1.csv");

// ---------- Helpers ----------

function normalizeTrack(track) {
  if (!track) return "";
  return String(track)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function makeRaceId({ track, raceNo, date }) {
  return [
    normalizeTrack(track),
    String(raceNo || "").trim(),
    String(date || "").trim(),
  ].join("::");
}

function safeJsonParse(str, fallback = null) {
  if (typeof str !== "string") return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// Hit calculation: compare predicted vs outcome
function computeHits(predicted, outcome) {
  const pWin = predicted?.win || "";
  const pPlace = predicted?.place || "";
  const pShow = predicted?.show || "";

  const oWin = outcome?.win || "";
  const oPlace = outcome?.place || "";
  const oShow = outcome?.show || "";

  const winHit = !!pWin && pWin === oWin;
  const placeHit = !!pPlace && pPlace === oPlace;
  const showHit = !!pShow && pShow === oShow;

  // top3 hit = any of (win/place/show) predicted appears in actual top3
  const actualTop3 = [oWin, oPlace, oShow].filter(Boolean);
  const anyPredTop3 = [pWin, pPlace, pShow].filter(Boolean);

  const top3Hit = anyPredTop3.some((h) => actualTop3.includes(h));

  return { winHit, placeHit, showHit, top3Hit };
}

// CSV helper
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ---------- Redis scan helpers ----------

async function scanKeysWithPrefix(prefix) {
  let cursor = "0";
  const keys = [];

  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match: `${prefix}*`,
      count: 500,
    });
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
}

async function getJsonByKeys(keys) {
  if (!keys.length) return {};
  const result = {};

  // Upstash supports mget but we'll keep it simple & robust:
  for (const key of keys) {
    const raw = await redis.get(key);
    const json = safeJsonParse(raw);
    if (!json) continue;

    // Expect logs to include track, raceNo, date
    const track = json.track || json.request?.track;
    const raceNo = json.raceNo || json.request?.raceNo;
    const date = json.date || json.request?.date;

    const raceId = makeRaceId({ track, raceNo, date });
    result[raceId] = json;
  }

  return result;
}

// ---------- Main ----------

async function main() {
  console.log("▶ Calibration Rebuilder starting…");
  console.log(`  Using PRED_PREFIX=${PRED_PREFIX}`);
  console.log(`  Using VERIFY_PREFIX=${VERIFY_PREFIX}`);

  // 1) Load prediction logs
  console.log("▶ Scanning prediction keys…");
  const predKeys = await scanKeysWithPrefix(PRED_PREFIX);
  console.log(`  Found ${predKeys.length} prediction keys`);

  const predsByRace = await getJsonByKeys(predKeys);
  console.log(`  Collapsed to ${Object.keys(predsByRace).length} prediction races`);

  // 2) Load verify logs
  console.log("▶ Scanning verify keys…");
  const verifyKeys = await scanKeysWithPrefix(VERIFY_PREFIX);
  console.log(`  Found ${verifyKeys.length} verify keys`);

  const verifyByRace = await getJsonByKeys(verifyKeys);
  console.log(`  Collapsed to ${Object.keys(verifyByRace).length} verified races`);

  // 3) Join them
  const allRaceIds = new Set([
    ...Object.keys(predsByRace),
    ...Object.keys(verifyByRace),
  ]);

  console.log(`▶ Joining datasets, total races: ${allRaceIds.size}`);

  const rows = [];

  for (const raceId of allRaceIds) {
    const predLog = predsByRace[raceId] || null;
    const verLog = verifyByRace[raceId] || null;

    // Try to pull canonical fields from either side
    const track =
      verLog?.track ||
      verLog?.request?.track ||
      predLog?.track ||
      predLog?.request?.track ||
      "";

    const raceNo =
      verLog?.raceNo ||
      verLog?.request?.raceNo ||
      predLog?.raceNo ||
      predLog?.request?.raceNo ||
      "";

    const date =
      verLog?.date ||
      verLog?.request?.date ||
      predLog?.date ||
      predLog?.request?.date ||
      "";

    // Outcomes (from verify)
    const outcome = verLog?.outcome || verLog?.response?.outcome || null;

    // Predictions: these field names should match whatever log_prediction pushes
    // Adjust here if your structure differs
    const predicted =
      predLog?.predicted ||
      predLog?.picks ||
      predLog?.prediction ||
      null;

    const hits = computeHits(predicted || {}, outcome || {});

    rows.push({
      track,
      raceNo,
      date,
      predictedWin: predicted?.win || "",
      predictedPlace: predicted?.place || "",
      predictedShow: predicted?.show || "",
      outcomeWin: outcome?.win || "",
      outcomePlace: outcome?.place || "",
      outcomeShow: outcome?.show || "",
      winHit: hits.winHit ? 1 : 0,
      placeHit: hits.placeHit ? 1 : 0,
      showHit: hits.showHit ? 1 : 0,
      top3Hit: hits.top3Hit ? 1 : 0,
      // raw JSON for later debugging (optional)
      predJson: predLog ? JSON.stringify(predLog) : "",
      verifyJson: verLog ? JSON.stringify(verLog) : "",
    });
  }

  // 4) Write CSV
  console.log(`▶ Writing CSV with ${rows.length} rows…`);
  const headers = [
    "track",
    "raceNo",
    "date",
    "predictedWin",
    "predictedPlace",
    "predictedShow",
    "outcomeWin",
    "outcomePlace",
    "outcomeShow",
    "winHit",
    "placeHit",
    "showHit",
    "top3Hit",
    "predJson",
    "verifyJson",
  ];

  const lines = [headers.map(csvEscape).join(",")];

  for (const r of rows) {
    lines.push(
      [
        r.track,
        r.raceNo,
        r.date,
        r.predictedWin,
        r.predictedPlace,
        r.predictedShow,
        r.outcomeWin,
        r.outcomePlace,
        r.outcomeShow,
        r.winHit,
        r.placeHit,
        r.showHit,
        r.top3Hit,
        r.predJson,
        r.verifyJson,
      ].map(csvEscape).join(",")
    );
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf8");
  console.log(`✅ Done. Wrote: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("❌ Calibration Rebuilder failed:", err);
  process.exit(1);
});
