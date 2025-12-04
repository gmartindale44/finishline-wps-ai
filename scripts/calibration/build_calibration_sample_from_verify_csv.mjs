#!/usr/bin/env node
/**
 * scripts/calibration/build_calibration_sample_from_verify_csv.mjs
 * 
 * Build a 5,000-row calibration sample CSV from the verify Redis export.
 * 
 * Filters the source CSV to only include rows that have at least one prediction
 * (predWin, predPlace, or predShow is non-empty).
 * 
 * Usage:
 *   npm run build:calibration-sample
 *   node scripts/calibration/build_calibration_sample_from_verify_csv.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "url";
import { createReadStream } from "node:fs";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE = path.join(__dirname, "../../data/finishline_tests_from_verify_redis_v1.csv");
const TARGET = path.join(__dirname, "../../data/finishline_tests_calibration_v1.csv");
const MAX_ROWS = 5000;

const EXPECTED_HEADER = "track,date,raceNo,strategyName,version,predWin,predPlace,predShow,outWin,outPlace,outShow,winHit,placeHit,showHit,top3Hit";

/**
 * CSV parser that handles commas inside quoted values
 */
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((cell) => cell.trim());
}

/**
 * Check if a row has at least one non-empty prediction
 */
function hasPrediction(columns) {
  // Map columns: track,date,raceNo,strategyName,version,predWin,predPlace,predShow,outWin,outPlace,outShow,winHit,placeHit,showHit,top3Hit
  if (columns.length < 8) return false;
  
  const predWin = (columns[5] || "").trim();
  const predPlace = (columns[6] || "").trim();
  const predShow = (columns[7] || "").trim();
  
  return predWin !== "" || predPlace !== "" || predShow !== "";
}

async function main() {
  console.log("📊 Building calibration sample from verify CSV...\n");

  // Check source file exists
  try {
    await fs.access(SOURCE);
  } catch (error) {
    console.error(`❌ Source file not found: ${SOURCE}`);
    process.exitCode = 1;
    return;
  }

  // Read and validate header
  const fileStream = createReadStream(SOURCE, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let headerLine = null;
  let headerValid = false;
  let rowsScanned = 0;
  let rowsWithPredictions = 0;
  let rowsWritten = 0;
  const outputLines = [];

  for await (const line of rl) {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) continue;

    // First non-empty line should be the header
    if (headerLine === null) {
      headerLine = trimmedLine;
      
      // Validate header matches expected format exactly
      if (headerLine !== EXPECTED_HEADER) {
        console.error("❌ Header validation failed!");
        console.error(`   Expected: ${EXPECTED_HEADER}`);
        console.error(`   Found:    ${headerLine}`);
        console.error("\n   Header must match exactly (including column order).");
        process.exitCode = 1;
        return;
      }
      
      headerValid = true;
      outputLines.push(headerLine);
      console.log("✅ Header validated");
      continue;
    }

    // Parse and filter data rows
    rowsScanned++;
    
    const columns = parseCsvLine(trimmedLine);
    
    if (hasPrediction(columns)) {
      rowsWithPredictions++;
      
      if (rowsWritten < MAX_ROWS) {
        outputLines.push(trimmedLine);
        rowsWritten++;
      }
      
      // Stop if we've reached the max
      if (rowsWritten >= MAX_ROWS) {
        break;
      }
    }

    // Progress logging for large files
    if (rowsScanned % 5000 === 0) {
      console.log(`   Scanned ${rowsScanned} rows, found ${rowsWithPredictions} with predictions...`);
    }
  }

  // Ensure we wrote the header even if no rows matched
  if (!headerValid) {
    console.error("❌ No header found in source file!");
    process.exitCode = 1;
    return;
  }

  // Write output file
  const outputContent = outputLines.join("\n") + "\n";
  await fs.writeFile(TARGET, outputContent, "utf8");

  // Summary
  console.log("\n📊 Summary:");
  console.log(`   Scanned ${rowsScanned} rows from source`);
  console.log(`   Filtered rows with predictions: ${rowsWithPredictions}`);
  console.log(`   Wrote ${rowsWritten} rows to ${path.basename(TARGET)} (cap: ${MAX_ROWS})`);
  
  if (rowsWritten === 0) {
    console.log("\n⚠️  WARNING: No rows had predictions. Calibration may not work.");
  } else if (rowsWritten < rowsWithPredictions) {
    console.log(`   (Capped at ${MAX_ROWS} rows; ${rowsWithPredictions - rowsWritten} additional rows with predictions were skipped)`);
  }
  
  console.log(`\n✅ Output file: ${TARGET}\n`);
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exitCode = 1;
});

