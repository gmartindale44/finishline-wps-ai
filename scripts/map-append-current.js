import fs from 'fs';
import path from 'path';

const INPUT_FILE = path.join('data', 'append_2025-11-07_master.csv');
const OUTPUT_DIR = '.tmp';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'append_current_2025-11-07.csv');

const LEGACY_HEADER = [
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

if (!fs.existsSync(INPUT_FILE)) {
  console.error(`[map-append-current] Missing input file: ${INPUT_FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(INPUT_FILE, 'utf8');
const rows = parseCSV(raw);
if (!rows.length) {
  console.error('[map-append-current] Input CSV has no rows.');
  process.exit(1);
}

const header = rows[0];
const indexMap = new Map(header.map((name, idx) => [name.trim(), idx]));

function get(row, name) {
  const idx = indexMap.get(name);
  return idx != null ? row[idx] ?? '' : '';
}

const outputLines = [csvJoin(LEGACY_HEADER)];
let appendedCount = 0;

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || row.every((cell) => cell.trim() === '')) continue;

  const aiWin = get(row, 'AI_Win');
  const aiPlace = get(row, 'AI_Place');
  const aiShow = get(row, 'AI_Show');
  const picksParts = [];
  picksParts.push(`WIN: ${aiWin || ''}`.trim());
  picksParts.push(`PLACE: ${aiPlace || ''}`.trim());
  picksParts.push(`SHOW: ${aiShow || ''}`.trim());
  const aiPicks = picksParts.join(' | ');

  const notesParts = [];
  const live = get(row, 'Live');
  const stakes = get(row, 'Suggested_Stakes');
  const notesSrc = get(row, 'Notes');
  if (live) notesParts.push(live);
  if (stakes) notesParts.push(stakes);
  if (notesSrc) notesParts.push(notesSrc);
  const notes = notesParts.join(' | ');

  const legacyRow = [
    '',
    get(row, 'Track'),
    get(row, 'Race_No'),
    get(row, 'Surface'),
    get(row, 'Distance'),
    get(row, 'AI_Confidence'),
    get(row, 'Top_3_Mass'),
    aiPicks,
    get(row, 'Strategy'),
    get(row, 'Result_Order'),
    get(row, 'ROI_Percent'),
    get(row, 'WinRate'),
    notes,
  ];

  outputLines.push(csvJoin(legacyRow));
  appendedCount++;
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

fs.writeFileSync(OUTPUT_FILE, outputLines.join('\n') + '\n', 'utf8');
console.log(`[map-append-current] Wrote ${OUTPUT_FILE}`);
console.log(`[map-append-current] Rows mapped: ${appendedCount}`);
