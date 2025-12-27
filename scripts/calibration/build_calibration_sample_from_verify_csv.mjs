#!/usr/bin/env node
/**
 * scripts/calibration/build_calibration_sample_from_verify_csv.mjs
 * 
 * Build a 5,000-row calibration sample CSV from the verify Redis export.
 * 
 * Filters the source CSV to only include rows that have at least one prediction
 * (predWin, predPlace, or predShow is non-empty).
 * 
 * Schema-flexible: Accepts both 15-column (legacy) and 18-column (with predmeta) formats.
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
 * Check if a row has at least one non-empty prediction using field map
 */
function hasPrediction(columns, fieldMap) {
  if (fieldMap.predWin === -1 || fieldMap.predPlace === -1 || fieldMap.predShow === -1) {
    return false;
  }
  
  const predWin = (columns[fieldMap.predWin] || "").trim();
  const predPlace = (columns[fieldMap.predPlace] || "").trim();
  const predShow = (columns[fieldMap.predShow] || "").trim();
  
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
  let headerColumns = null;
  let fieldMap = null;
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
      headerColumns = parseCsvLine(headerLine);
      
      // Build field map using header.indexOf() (schema-flexible)
      fieldMap = {
        track: headerColumns.indexOf("track"),
        date: headerColumns.indexOf("date"),
        raceNo: headerColumns.indexOf("raceNo"),
        strategyName: headerColumns.indexOf("strategyName"),
        version: headerColumns.indexOf("version"),
        predWin: headerColumns.indexOf("predWin"),
        predPlace: headerColumns.indexOf("predPlace"),
        predShow: headerColumns.indexOf("predShow"),
        outWin: headerColumns.indexOf("outWin"),
        outPlace: headerColumns.indexOf("outPlace"),
        outShow: headerColumns.indexOf("outShow"),
        winHit: headerColumns.indexOf("winHit"),
        placeHit: headerColumns.indexOf("placeHit"),
        showHit: headerColumns.indexOf("showHit"),
        top3Hit: headerColumns.indexOf("top3Hit"),
        // Optional predmeta fields (not required)
        confidence_pct: headerColumns.indexOf("confidence_pct"),
        t3m_pct: headerColumns.indexOf("t3m_pct"),
        top3_list: headerColumns.indexOf("top3_list"),
      };
      
      // Validate required fields
      const requiredFields = ['track', 'date', 'raceNo', 'predWin', 'predPlace', 'predShow', 'top3Hit'];
      const missingFields = [];
      for (const field of requiredFields) {
        if (fieldMap[field] === -1) {
          missingFields.push(field);
        }
      }
      
      if (missingFields.length > 0) {
        console.error("❌ Header validation failed!");
        console.error(`   Missing required fields: ${missingFields.join(', ')}`);
        console.error(`   Header found: ${headerLine}`);
        process.exitCode = 1;
        return;
      }
      
      // Write header to output (preserves schema - includes predmeta if present)
      outputLines.push(headerLine);
      
      const columnCount = headerColumns.length;
      const hasPredmeta = fieldMap.confidence_pct !== -1 || fieldMap.t3m_pct !== -1 || fieldMap.top3_list !== -1;
      console.log(`✅ Header validated (${columnCount} columns${hasPredmeta ? ', includes predmeta' : ', legacy format'})`);
      continue;
    }

    // Parse and filter data rows
    rowsScanned++;
    
    const columns = parseCsvLine(trimmedLine);
    
    // Skip rows that don't have enough columns (incomplete)
    if (columns.length < headerColumns.length) {
      continue;
    }
    
    if (hasPrediction(columns, fieldMap)) {
      rowsWithPredictions++;
      
      if (rowsWritten < MAX_ROWS) {
        // Write the full row as-is (preserves all columns including predmeta)
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

  // Ensure we found the header
  if (headerLine === null) {
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

