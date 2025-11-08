import fs from 'fs';
import path from 'path';
import {
  SURFACES,
  normalizeSurface,
  normalizeTrack,
} from '../lib/data-normalize.js';

const DATA_FILE = path.join('data', 'finishline_tests_v1.csv');

if (!fs.existsSync(DATA_FILE)) {
  console.error(`[data-validate] Missing dataset at ${DATA_FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(DATA_FILE, 'utf8');
const rows = parseCSV(raw);
if (!rows.length) {
  console.error('[data-validate] Dataset is empty.');
  process.exit(1);
}

const header = rows[0];
const index = new Map(header.map((name, i) => [name, i]));

const requiredColumns = ['Track', 'Surface', 'Distance', 'Confidence', 'Top_3_Mass'];
const missingCols = requiredColumns.filter((col) => !index.has(col));
if (missingCols.length) {
  console.error(`[data-validate] Missing expected columns: ${missingCols.join(', ')}`);
  process.exit(1);
}

let hardErrors = 0;
let softWarnings = 0;

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !row.length) continue;

  const rowNum = i + 1;
  const track = (row[index.get('Track')] || '').trim();
  const surface = normalizeSurface(row[index.get('Surface')] || '');
  const distance = (row[index.get('Distance')] || '').trim();
  const confidenceRaw = row[index.get('Confidence')] ?? '';
  const top3Raw = row[index.get('Top_3_Mass')] ?? '';

  if (!track) {
    hardErrors++;
    console.error(`[data-validate] Row ${rowNum}: Track is empty.`);
  }

  if (!distance) {
    hardErrors++;
    console.error(`[data-validate] Row ${rowNum}: Distance is empty.`);
  }

  if (surface && !SURFACES.includes(surface)) {
    hardErrors++;
    console.error(
      `[data-validate] Row ${rowNum}: Surface "${surface}" is not in SURFACES (${SURFACES.join(', ')}).`
    );
  }

  const confidence = parsePercent(confidenceRaw);
  if (confidence == null) {
    if (confidenceRaw !== '' && confidenceRaw !== null) {
      softWarnings++;
      console.warn(`[data-validate] Row ${rowNum}: Confidence "${confidenceRaw}" not numeric.`);
    }
  } else if (confidence < 0 || confidence > 100) {
    hardErrors++;
    console.error(`[data-validate] Row ${rowNum}: Confidence ${confidence} out of range [0,100].`);
  }

  const top3 = parsePercent(top3Raw);
  if (top3 == null) {
    if (top3Raw !== '' && top3Raw !== null) {
      softWarnings++;
      console.warn(`[data-validate] Row ${rowNum}: Top_3_Mass "${top3Raw}" not numeric.`);
    }
  } else if (top3 < 0 || top3 > 100) {
    hardErrors++;
    console.error(`[data-validate] Row ${rowNum}: Top_3_Mass ${top3} out of range [0,100].`);
  }
}

const totalRows = rows.length - 1;
console.log(`[data-validate] Checked ${totalRows} rows.`);
console.log(`[data-validate] Warnings: ${softWarnings}`);

if (hardErrors > 0) {
  console.error(`[data-validate] Hard errors: ${hardErrors}.`);
  process.exit(1);
}

console.log('[data-validate] ✅ Dataset valid.');
process.exit(0);

function parsePercent(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const num = Number(str);
  if (!Number.isFinite(num)) return null;
  const normalized = num <= 1 && num >= 0 ? num * 100 : num;
  return Number.isFinite(normalized) ? Number(normalized.toFixed(2)) : null;
}

function parseCSV(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' || ch === '\r') {
      if (!inQuotes) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        if (ch === '\r' && content[i + 1] === '\n') i++;
      } else {
        field += ch;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

