import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join('data', 'finishline_tests_v1.csv');
const APPEND_FILE = path.join('.tmp', 'append_current_2025-11-07.csv');

const HEADER = [
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
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function csvJoin(fields) {
  return fields.map((value) => {
    if (value == null) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }).join(',');
}

if (!fs.existsSync(APPEND_FILE)) {
  console.error(`[merge-append-current] Missing mapped append file: ${APPEND_FILE}`);
  process.exit(1);
}

if (!fs.existsSync(DATA_FILE)) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, csvJoin(HEADER) + '\n', 'utf8');
}

const existingRaw = fs.readFileSync(DATA_FILE, 'utf8');
const existingRows = parseCSV(existingRaw);
if (!existingRows.length) {
  existingRows.push(HEADER);
}
const existingHeader = existingRows[0];
const existing = existingRows.slice(1);

if (existingHeader.join('|') !== HEADER.join('|')) {
  console.warn('[merge-append-current] Warning: dataset header differs from expected schema. Proceeding cautiously.');
}

const appendRaw = fs.readFileSync(APPEND_FILE, 'utf8');
const appendRows = parseCSV(appendRaw);
if (appendRows.length <= 1) {
  console.log('[merge-append-current] No rows to append (append file empty).');
  process.exit(0);
}
const appendHeader = appendRows[0];
const appendIndex = new Map(appendHeader.map((name, idx) => [name, idx]));

const fieldIndex = new Map(existingHeader.map((name, idx) => [name, idx]));
const keyFields = ['Track', 'Race_No', 'Distance', 'AI_Picks', 'Strategy', 'Result'];
const buildKey = (row, indexLookup) => keyFields.map((name) => {
  const idx = indexLookup.get(name);
  return idx != null ? (row[idx] ?? '').trim().toLowerCase() : '';
}).join('|');

const existingKeys = new Set();
let maxId = 0;
for (const row of existing) {
  if (!row.length || row.every((cell) => cell.trim() === '')) continue;
  existingKeys.add(buildKey(row, fieldIndex));
  const idIdx = fieldIndex.get('Test_ID');
  if (idIdx != null) {
    const id = Number(row[idIdx]);
    if (Number.isFinite(id) && id > maxId) maxId = id;
  }
}

const appendedRows = [];

for (let i = 1; i < appendRows.length; i++) {
  const row = appendRows[i];
  if (!row.length || row.every((cell) => cell.trim() === '')) continue;
  const key = buildKey(row, appendIndex);
  if (existingKeys.has(key)) continue;

  existingKeys.add(key);
  const cloned = HEADER.map((name, idx) => {
    if (name === 'Test_ID') return ''; // placeholder for now
    const srcIdx = appendIndex.get(name);
    return srcIdx != null ? row[srcIdx] ?? '' : '';
  });

  const nextId = (++maxId).toString();
  cloned[0] = nextId;
  appendedRows.push(cloned);
}

if (!appendedRows.length) {
  console.log('[merge-append-current] No new rows added from today\'s append.');
  process.exit(0);
}

const outputRows = [existingHeader, ...existing, ...appendedRows];
const outputContent = outputRows.map(csvJoin).join('\n') + '\n';
fs.writeFileSync(DATA_FILE, outputContent, 'utf8');

console.log(`[merge-append-current] Added ${appendedRows.length} rows from today\'s append.`);
console.log(`[merge-append-current] Dataset now has ${outputRows.length - 1} rows.`);
