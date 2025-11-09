import fs from 'node:fs';
import path from 'node:path';

const CSV_PATH = path.join(process.cwd(), 'data', 'finishline_tests_v1.csv');
const LEGACY_HEADERS = [
  'Test_ID',
  'Track',
  'Race_No',
  'Surface',
  'Distance',
  'Confidence',
  'Top_3_Mass',
  'AI_Picks',
  'Strategy',
  'Result',
  'ROI_Percent',
  'WinRate',
  'Notes',
];

function loadCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at ${CSV_PATH}`);
  }
  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.trim().split('\n');
  const headerLine = lines.shift();
  const header = headerLine ? headerLine.split(',').map(h => h.trim()) : [];

  if (header.join(',') !== LEGACY_HEADERS.join(',')) {
    throw new Error('Header mismatch – expected legacy schema');
  }

  const rows = lines.filter(Boolean).map(line => parseCsv(line, header.length));
  return { header, rows };
}

function parseCsv(line, size) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  while (result.length < size) result.push('');
  return result;
}

function toMap(row) {
  const map = {};
  LEGACY_HEADERS.forEach((h, idx) => {
    map[h] = row[idx] ?? '';
  });
  return map;
}

function isNumeric(value) {
  if (value == null || value === '') return false;
  const num = Number(value);
  return Number.isFinite(num);
}

function numericFromPercent(val) {
  if (!val) return NaN;
  const cleaned = String(val).replace(/[^0-9+\-\.]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function main() {
  try {
    const { rows } = loadCsv();
    if (rows.length < 20) {
      console.warn(`[validate-dataset] WARNING: expected at least 20 rows, found ${rows.length}`);
    }

    const seen = new Set();
    const softWarnings = [];

    rows.forEach((row, idx) => {
      const map = toMap(row);
      const key = [map.Track.trim().toLowerCase(), map.Race_No.trim(), map.AI_Picks.trim().toLowerCase()].join('|');
      if (seen.has(key)) {
        console.error(`[validate-dataset] Duplicate natural key detected at row ${idx + 2}: ${map.Track} #${map.Race_No}`);
        process.exit(1);
      }
      seen.add(key);

      if (!isNumeric(map.Confidence)) {
        softWarnings.push(`Row ${idx + 2}: Confidence not numeric (${map.Confidence})`);
      }
      if (!isNumeric(map.Top_3_Mass)) {
        softWarnings.push(`Row ${idx + 2}: Top_3_Mass not numeric (${map.Top_3_Mass})`);
      }

      const roi = numericFromPercent(map.ROI_Percent);
      if (Number.isNaN(roi)) {
        softWarnings.push(`Row ${idx + 2}: ROI_Percent not numeric (${map.ROI_Percent})`);
      }
    });

    console.log(`[validate-dataset] Checked ${rows.length} rows. Duplicates: 0.`);
    if (softWarnings.length) {
      softWarnings.forEach(w => console.warn(`[validate-dataset] WARN: ${w}`));
    } else {
      console.log('[validate-dataset] No soft warnings.');
    }
  } catch (err) {
    console.error('[validate-dataset] Fatal:', err?.message || err);
    process.exit(1);
  }
}

main();
