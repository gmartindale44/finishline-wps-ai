import fs from 'fs';
import path from 'path';
import {
  buildDedupeKey,
  normalizeDistanceKey,
  normalizeSurface,
  normalizeTrack,
} from '../lib/data-normalize.js';

const DATA_FILE = path.join('data', 'finishline_tests_v1.csv');
const MAPPED_DIR = '.tmp';

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
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function csvJoin(fields) {
  return fields
    .map((value) => {
      if (value == null) return '';
      const str = String(value);
      if (/[",\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    })
    .join(',');
}

function resolveLatestMapped() {
  if (!fs.existsSync(MAPPED_DIR)) {
    throw new Error('[merge-append-current] Missing .tmp directory; run map-append-current first.');
  }
  const files = fs
    .readdirSync(MAPPED_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^append_current_\d{4}-\d{2}-\d{2}\.csv$/.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort();
  if (!files.length) {
    throw new Error('[merge-append-current] No append_current_YYYY-MM-DD.csv files found in .tmp/');
  }
  const latest = files[files.length - 1];
  const dateMatch = latest.match(/append_current_(\d{4}-\d{2}-\d{2})\.csv/);
  return { filename: latest, date: dateMatch ? dateMatch[1] : '' };
}

const cliArgs = process.argv.slice(2);
const positionalArgs = cliArgs.filter((arg) => !arg.startsWith('--'));

let APPEND_FILE;
let APPEND_NAME;
let APPEND_DATE;

if (positionalArgs.length) {
  const providedPath = path.resolve(positionalArgs[0]);
  if (!fs.existsSync(providedPath)) {
    console.error(`[merge-append-current] Provided mapped file not found: ${providedPath}`);
    process.exit(1);
  }
  APPEND_FILE = providedPath;
  APPEND_NAME = path.basename(providedPath);
  const dateMatch = APPEND_NAME.match(/append_current_(\d{4}-\d{2}-\d{2})/);
  APPEND_DATE = dateMatch ? dateMatch[1] : '';
} else {
  const resolved = resolveLatestMapped();
  APPEND_NAME = resolved.filename;
  APPEND_DATE = resolved.date;
  APPEND_FILE = path.join(MAPPED_DIR, APPEND_NAME);
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
  console.warn(
    '[merge-append-current] Warning: dataset header differs from expected schema. Proceeding cautiously.'
  );
}

const appendRaw = fs.readFileSync(APPEND_FILE, 'utf8');
const appendRows = parseCSV(appendRaw);
if (appendRows.length <= 1) {
  console.log('[merge-append-current] No rows to append (append file empty).');
  process.exit(0);
}
const appendHeader = appendRows[0];
const appendIndex = new Map(appendHeader.map((name, idx) => [name.trim(), idx]));

const fieldIndex = new Map(existingHeader.map((name, idx) => [name, idx]));

function extractDateFromNotes(notes) {
  if (!notes) return '';
  const match = String(notes).match(/(?:Date\s+)?(20\d{2}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

const buildKey = (row, indexLookup, opts = {}) => {
  const trackIdx = indexLookup.get('Track');
  const raceIdx = indexLookup.get('Race_No');
  const distanceIdx = indexLookup.get('Distance');
  const surfaceIdx = indexLookup.get('Surface');
  const picksIdx = indexLookup.get('AI_Picks');
  const strategyIdx = indexLookup.get('Strategy');
  const resultIdx = indexLookup.get('Result');
  const notesIdx = indexLookup.get('Notes');

  const rawDate =
    (opts.date ??
      (notesIdx != null ? extractDateFromNotes(row[notesIdx] ?? '') : '')) || '';

  return buildDedupeKey([
    normalizeTrack(trackIdx != null ? row[trackIdx] : ''),
    raceIdx != null ? row[raceIdx] : '',
    rawDate,
    normalizeDistanceKey(distanceIdx != null ? row[distanceIdx] : ''),
    normalizeSurface(surfaceIdx != null ? row[surfaceIdx] : ''),
    picksIdx != null ? row[picksIdx] : '',
    strategyIdx != null ? row[strategyIdx] : '',
    resultIdx != null ? row[resultIdx] : '',
  ]);
};

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
  const appendDateIdx = appendIndex.get('Date');
  const key = buildKey(row, appendIndex, {
    date: appendDateIdx != null ? row[appendDateIdx] : APPEND_DATE,
  });
  if (existingKeys.has(key)) continue;

  existingKeys.add(key);
  const cloned = HEADER.map((name) => {
    if (name === 'Test_ID') return '';
    const srcIdx = appendIndex.get(name);
    let value = srcIdx != null ? row[srcIdx] ?? '' : '';
    if (name === 'Track') value = normalizeTrack(value);
    if (name === 'Surface') value = normalizeSurface(value);
    if (name === 'Distance') value = normalizeDistanceKey(value);
    if (name === 'Notes')
      value = ensureNotesHasDate(
        value,
        appendDateIdx != null ? row[appendDateIdx] : APPEND_DATE
      );
    return value;
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

console.log(`[merge-append-current] Source: ${APPEND_NAME}`);
console.log(`[merge-append-current] Added ${appendedRows.length} rows from today\'s append.`);
console.log(`[merge-append-current] Dataset now has ${outputRows.length - 1} rows.`);

function ensureNotesHasDate(notes, date) {
  const trimmed = (notes || '').trim();
  if (!date) return trimmed;
  if (trimmed.includes(date)) return trimmed;
  return trimmed ? `Date ${date} | ${trimmed}` : `Date ${date}`;
}
