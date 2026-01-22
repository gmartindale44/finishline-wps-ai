#!/usr/bin/env node
/**
 * scripts/calibration/export_verify_redis_to_csv.mjs
 * 
 * Export verify logs from Redis (fl:verify:*) to CSV for calibration.
 * 
 * This script:
 * - Scans all fl:verify:* keys in Redis
 * - Reads verify logs (stored as JSON strings via redis.set())
 * - Maps each verify log to the calibration CSV schema
 * - Supports all step types: verify_race_full, verify_race_full_fallback, manual_verify
 * - Writes a new CSV file: data/finishline_tests_from_verify_redis_v1.csv
 * 
 * CSV Schema (matches calibration_from_logs_v1.csv + predmeta):
 * track,date,raceNo,strategyName,version,predWin,predPlace,predShow,outWin,outPlace,outShow,winHit,placeHit,showHit,top3Hit,confidence_pct,t3m_pct,top3_list
 * 
 * Note: Verify logs are stored as JSON strings (not hashes), so we use redis.get() and parse JSON.
 * Manual verify entries are fully supported and treated as valid calibration data.
 * 
 * Usage:
 *   npm run export:verify-redis
 *   node scripts/calibration/export_verify_redis_to_csv.mjs
 */

import { Redis } from "@upstash/redis";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "url";
import { normalizeTrackName } from "../../lib/calibration/track_normalize.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERIFY_PREFIX = "fl:verify:";
const OUTPUT_FILE = path.join(__dirname, "../../data/finishline_tests_from_verify_redis_v1.csv");

/**
 * CSV escape helper - properly escapes quotes, commas, and newlines
 */
function csvEscape(value) {
  if (value == null || value === undefined) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Normalize a verify log object into a calibration CSV row
 * @param {object} verifyLog - Verify log from Redis
 * @returns {object|null} - CSV row object or null if invalid
 */
function normalizeToCalibrationRow(verifyLog) {
  if (!verifyLog || typeof verifyLog !== "object") {
    return null;
  }

  // Extract fields from verify log and normalize track name
  const rawTrack = verifyLog.track || "";
  const normalizedTrack = normalizeTrackName(rawTrack);
  const track = csvEscape(normalizedTrack);
  const date = csvEscape(verifyLog.date || verifyLog.dateIso || "");
  const raceNo = csvEscape(verifyLog.raceNo || "");

  // Strategy and version (may not be in verify logs, leave empty)
  const strategyName = csvEscape(verifyLog.strategy || verifyLog.strategyName || "");
  const version = csvEscape(verifyLog.version || "");

  // Predicted picks
  const predicted = verifyLog.predicted || {};
  const predWin = csvEscape(predicted.win || "");
  const predPlace = csvEscape(predicted.place || "");
  const predShow = csvEscape(predicted.show || "");

  // Actual outcome
  const outcome = verifyLog.outcome || {};
  const outWin = csvEscape(outcome.win || "");
  const outPlace = csvEscape(outcome.place || "");
  const outShow = csvEscape(outcome.show || "");

  // Hit flags
  const hits = verifyLog.hits || {};
  const winHit = hits.winHit === true ? "true" : "false";
  const placeHit = hits.placeHit === true ? "true" : "false";
  const showHit = hits.showHit === true ? "true" : "false";
  const top3Hit = hits.top3Hit === true ? "true" : "false";

  // Validate required fields
  // Note: manual_verify entries may have date fallback to today, so we're more lenient
  if (!track || !raceNo) {
    return null;
  }
  
  // If date is missing, try debug.canonicalDateIso or skip (shouldn't happen but be safe)
  const finalDate = date || (verifyLog.debug && verifyLog.debug.canonicalDateIso) || "";
  if (!finalDate) {
    return null; // Still require some date
  }

  // Extract predmeta fields (if present, added by verify_race.js)
  const confidencePct = verifyLog.confidence_pct;
  const rawConfidence = verifyLog.raw_confidence; // ADDITIVE: Raw confidence (0-100, 1 decimal) - preferred
  const rawConfidencePct = verifyLog.raw_confidence_pct; // Legacy: Raw confidence before recalibration (optional)
  const t3mPct = verifyLog.t3m_pct;
  const top3List = verifyLog.top3_list;

  // Format predmeta fields (backward compatible - empty if missing)
  const confidencePctStr = typeof confidencePct === 'number' && Number.isFinite(confidencePct)
    ? csvEscape(String(Math.round(confidencePct)))
    : "";
  
  // ADDITIVE: Format raw_confidence (0-100, 1 decimal) if available
  const rawConfidenceStr = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
    ? csvEscape(String(Math.round(rawConfidence * 10) / 10)) // 1 decimal precision
    : "";
  
  const rawConfidencePctStr = typeof rawConfidencePct === 'number' && Number.isFinite(rawConfidencePct)
    ? csvEscape(String(Math.round(rawConfidencePct)))
    : "";
  
  const t3mPctStr = typeof t3mPct === 'number' && Number.isFinite(t3mPct)
    ? csvEscape(String(Math.round(t3mPct)))
    : "";
  
  // top3_list: JSON stringify array if present, then CSV escape the JSON string
  const top3ListStr = Array.isArray(top3List) && top3List.length > 0
    ? csvEscape(JSON.stringify(top3List))
    : "";

  return {
    track,
    date: finalDate,
    raceNo,
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
    confidence_pct: confidencePctStr,
    raw_confidence: rawConfidenceStr, // ADDITIVE: Raw confidence (0-100, 1 decimal) - preferred
    raw_confidence_pct: rawConfidencePctStr, // Legacy: Raw confidence (optional, backward compatible)
    t3m_pct: t3mPctStr,
    top3_list: top3ListStr,
  };
}

/**
 * Write CSV rows to file
 */
async function writeCsv(rows, outputPath) {
  // CSV header (matches calibration_from_logs_v1.csv schema + predmeta fields)
  const header = [
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
    "confidence_pct",
    "raw_confidence", // ADDITIVE: Raw confidence (0-100, 1 decimal) - preferred
    "raw_confidence_pct", // Legacy: Raw confidence before recalibration (optional)
    "t3m_pct",
    "top3_list",
  ].join(",");

  // Build CSV content
  const lines = [header];
  for (const row of rows) {
    const csvRow = [
      row.track,
      row.date,
      row.raceNo,
      row.strategyName,
      row.version,
      row.predWin,
      row.predPlace,
      row.predShow,
      row.outWin,
      row.outPlace,
      row.outShow,
      row.winHit,
      row.placeHit,
      row.showHit,
      row.top3Hit,
      row.confidence_pct || "",
      row.raw_confidence || "", // ADDITIVE: Raw confidence (0-100, 1 decimal) - preferred
      row.raw_confidence_pct || "", // Legacy: Raw confidence (optional, backward compatible)
      row.t3m_pct || "",
      row.top3_list || "",
    ].join(",");
    lines.push(csvRow);
  }

  const content = lines.join("\n") + "\n";
  await fs.writeFile(outputPath, content, "utf8");
}

async function main() {
  console.log("📊 Exporting verify logs from Redis to CSV...\n");

  // Connect to Redis
  let redis;
  try {
    redis = Redis.fromEnv();
  } catch (error) {
    console.error("❌ Failed to connect to Redis:", error.message);
    console.error("   Make sure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.");
    process.exit(1);
  }

  // Scan all verify keys
  console.log(`🔍 Scanning keys with prefix "${VERIFY_PREFIX}"...`);
  let allKeys = [];
  let cursor = 0;
  const maxIterations = 1000; // Safety limit
  let iterations = 0;

  try {
    do {
      const result = await redis.scan(cursor, {
        match: `${VERIFY_PREFIX}*`,
        count: 100,
      });
      cursor = result[0];
      allKeys = allKeys.concat(result[1]);
      iterations++;
      
      if (iterations % 10 === 0) {
        console.log(`   Scanned ${allKeys.length} keys so far...`);
      }
    } while (cursor !== 0 && iterations < maxIterations);

    console.log(`✅ Found ${allKeys.length} verify keys\n`);
  } catch (error) {
    console.error("❌ Error scanning Redis keys:", error.message);
    process.exit(1);
  }

  if (allKeys.length === 0) {
    console.log("⚠️  No verify keys found in Redis.");
    console.log("   Nothing to export.");
    process.exit(0);
  }

  // Fetch and normalize all verify logs
  console.log("📥 Fetching and normalizing verify logs...");
  const rows = [];
  let skipped = 0;

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i];
    
    if ((i + 1) % 100 === 0) {
      console.log(`   Processed ${i + 1}/${allKeys.length} keys...`);
    }

    try {
      const rawValue = await redis.get(key);
      if (!rawValue) {
        skipped++;
        continue;
      }

      let verifyLog;
      if (typeof rawValue === "string") {
        try {
          verifyLog = JSON.parse(rawValue);
        } catch {
          skipped++;
          continue;
        }
      } else if (typeof rawValue === "object") {
        verifyLog = rawValue;
      } else {
        skipped++;
        continue;
      }

      const row = normalizeToCalibrationRow(verifyLog);
      if (row) {
        rows.push(row);
      } else {
        skipped++;
      }
    } catch (error) {
      console.warn(`⚠️  Error processing key ${key}:`, error.message);
      skipped++;
    }
  }

  console.log(`✅ Processed ${allKeys.length} keys:`);
  console.log(`   - Valid rows: ${rows.length}`);
  console.log(`   - Skipped: ${skipped}\n`);

  if (rows.length === 0) {
    console.log("⚠️  No valid rows to export.");
    process.exit(0);
  }

  // Write CSV file
  console.log(`📝 Writing CSV to ${OUTPUT_FILE}...`);
  try {
    await writeCsv(rows, OUTPUT_FILE);
    console.log(`✅ Exported ${rows.length} Redis verify records to ${OUTPUT_FILE}\n`);
  } catch (error) {
    console.error("❌ Error writing CSV file:", error.message);
    process.exit(1);
  }

  // Summary
  console.log("📊 Summary:");
  console.log(`   Total keys scanned: ${allKeys.length}`);
  console.log(`   Valid rows exported: ${rows.length}`);
  console.log(`   Skipped (invalid/missing): ${skipped}`);
  console.log(`   Output file: ${OUTPUT_FILE}`);
  console.log("");
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});

