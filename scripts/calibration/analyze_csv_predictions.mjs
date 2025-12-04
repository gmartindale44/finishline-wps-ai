#!/usr/bin/env node
/**
 * scripts/calibration/analyze_csv_predictions.mjs
 * 
 * Analyze CSV files to count rows with predictions
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function hasPrediction(columns, predWinIdx, predPlaceIdx, predShowIdx) {
  if (columns.length < Math.max(predWinIdx, predPlaceIdx, predShowIdx) + 1) {
    return false;
  }
  
  const predWin = (columns[predWinIdx] || "").trim();
  const predPlace = (columns[predPlaceIdx] || "").trim();
  const predShow = (columns[predShowIdx] || "").trim();
  
  return predWin !== "" || predPlace !== "" || predShow !== "";
}

async function analyzeCsv(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length === 0) {
      return { totalRows: 0, rowsWithPredictions: 0, sampleRows: [] };
    }
    
    // Parse header
    const header = parseCsvLine(lines[0]);
    const predWinIdx = header.indexOf("predWin");
    const predPlaceIdx = header.indexOf("predPlace");
    const predShowIdx = header.indexOf("predShow");
    
    if (predWinIdx === -1 || predPlaceIdx === -1 || predShowIdx === -1) {
      throw new Error(`Missing prediction columns in header: ${header.join(", ")}`);
    }
    
    // Process data rows
    let totalRows = 0;
    let rowsWithPredictions = 0;
    const sampleRowsWithPredictions = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      totalRows++;
      const columns = parseCsvLine(line);
      
      if (hasPrediction(columns, predWinIdx, predPlaceIdx, predShowIdx)) {
        rowsWithPredictions++;
        if (sampleRowsWithPredictions.length < 5) {
          sampleRowsWithPredictions.push(line);
        }
      }
    }
    
    return { totalRows, rowsWithPredictions, sampleRows: sampleRowsWithPredictions };
  } catch (error) {
    console.error(`Error analyzing ${filePath}:`, error.message);
    throw error;
  }
}

async function main() {
  const exportFile = path.join(__dirname, "../../data/finishline_tests_from_verify_redis_v1.csv");
  const sampleFile = path.join(__dirname, "../../data/finishline_tests_calibration_v1.csv");
  
  console.log("📊 Analyzing CSV files for predictions...\n");
  
  // Analyze export file
  try {
    console.log(`1. Export file: ${path.basename(exportFile)}`);
    const exportStats = await analyzeCsv(exportFile);
    console.log(`   Total rows: ${exportStats.totalRows}`);
    console.log(`   Rows with predictions: ${exportStats.rowsWithPredictions}`);
    if (exportStats.sampleRows.length > 0) {
      console.log(`\n   Sample rows with predictions (first ${exportStats.sampleRows.length}):`);
      exportStats.sampleRows.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ${row.substring(0, 120)}${row.length > 120 ? "..." : ""}`);
      });
    } else {
      console.log(`   ⚠️  No rows with predictions found`);
    }
    console.log("");
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    console.log("");
  }
  
  // Analyze sample file
  try {
    console.log(`2. Calibration sample: ${path.basename(sampleFile)}`);
    const sampleStats = await analyzeCsv(sampleFile);
    console.log(`   Total rows: ${sampleStats.totalRows}`);
    console.log(`   Rows with predictions: ${sampleStats.rowsWithPredictions}`);
    if (sampleStats.sampleRows.length > 0) {
      console.log(`\n   Sample rows with predictions (first ${sampleStats.sampleRows.length}):`);
      sampleStats.sampleRows.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ${row.substring(0, 120)}${row.length > 120 ? "..." : ""}`);
      });
    } else {
      console.log(`   ⚠️  No rows with predictions found`);
    }
    console.log("");
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    console.log("");
  }
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

