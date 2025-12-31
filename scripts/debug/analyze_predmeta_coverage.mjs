#!/usr/bin/env node
/**
 * Analyze predmeta coverage in calibration CSVs
 */

import fs from 'node:fs/promises';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';

// CSV parser that handles commas inside quoted values
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

async function analyzeCsv(filePath) {
  const fileStream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let header = null;
  let headerCols = null;
  let confIdx = -1;
  let t3mIdx = -1;
  let top3Idx = -1;
  let totalRows = 0;
  let rowsWithBoth = 0;
  const samples = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!header) {
      header = trimmed;
      headerCols = parseCsvLine(header);
      confIdx = headerCols.indexOf('confidence_pct');
      t3mIdx = headerCols.indexOf('t3m_pct');
      top3Idx = headerCols.indexOf('top3_list');
      console.log(`\n📊 Analyzing: ${filePath}`);
      console.log(`   Columns: ${headerCols.length}`);
      console.log(`   confidence_pct index: ${confIdx}`);
      console.log(`   t3m_pct index: ${t3mIdx}`);
      console.log(`   top3_list index: ${top3Idx}`);
      continue;
    }

    totalRows++;
    const cols = parseCsvLine(trimmed);
    
    if (confIdx >= 0 && t3mIdx >= 0 && cols.length > Math.max(confIdx, t3mIdx)) {
      const conf = cols[confIdx]?.trim() || '';
      const t3m = cols[t3mIdx]?.trim() || '';
      const top3 = cols[top3Idx]?.trim() || '';
      
      if (conf !== '' && t3m !== '' && rowsWithBoth < 3) {
        samples.push({
          conf,
          t3m,
          top3: top3.substring(0, 100), // Truncate if long
          row: trimmed.substring(0, 200) // First 200 chars of row
        });
      }
      
      if (conf !== '' && t3m !== '') {
        rowsWithBoth++;
      }
    }
  }

  return {
    totalRows,
    rowsWithBoth,
    samples,
    headerCols: headerCols?.length || 0
  };
}

async function main() {
  console.log('🔍 Predmeta Coverage Analysis\n');
  
  // Analyze both CSVs
  const exportCsv = await analyzeCsv('data/finishline_tests_from_verify_redis_v1.csv');
  const calibCsv = await analyzeCsv('data/finishline_tests_calibration_v1.csv');
  
  console.log('\n📈 Summary:');
  console.log(`   Export CSV: ${exportCsv.totalRows} rows, ${exportCsv.rowsWithBoth} with predmeta (${((exportCsv.rowsWithBoth/exportCsv.totalRows)*100).toFixed(2)}%)})`);
  console.log(`   Calibration CSV: ${calibCsv.totalRows} rows, ${calibCsv.rowsWithBoth} with predmeta (${((calibCsv.rowsWithBoth/calibCsv.totalRows)*100).toFixed(2)}%)`);
  
  if (exportCsv.samples.length > 0) {
    console.log('\n📋 Sample rows with predmeta:');
    exportCsv.samples.forEach((s, i) => {
      console.log(`\n   Sample ${i + 1}:`);
      console.log(`     confidence_pct: ${s.conf}`);
      console.log(`     t3m_pct: ${s.t3m}`);
      console.log(`     top3_list: ${s.top3.substring(0, 80)}...`);
    });
  }
}

main().catch(console.error);

