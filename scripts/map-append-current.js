import fs from 'fs';
import path from 'path';
import { normalizeSurface, normalizeTrack, SURFACES } from '../lib/data-normalize.js';
import { mapNamesToPosts } from './lib/card-mapper.js';

const DATA_DIR = 'data';
const OUTPUT_DIR = '.tmp';

function resolveLatestAppend() {
  const files = fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^append_\d{4}-\d{2}-\d{2}_master\.csv$/.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort();
  if (!files.length) {
    throw new Error('[map-append-current] No append_YYYY-MM-DD_master.csv found in data/');
  }
  const latest = files[files.length - 1];
  const dateMatch = latest.match(/append_(\d{4}-\d{2}-\d{2})_master\.csv/);
  return { filename: latest, date: dateMatch ? dateMatch[1] : 'unknown' };
}

function resolveArgs() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const flagOut = args.find((arg) => arg.startsWith('--out='));
  const flagStdout = args.includes('--stdout');

  let input = null;
  if (positional.length) {
    input = path.resolve(positional[0]);
  }

  let output = null;
  if (flagOut) {
    output = path.resolve(flagOut.split('=')[1]);
  } else if (positional.length > 1) {
    output = path.resolve(positional[1]);
  }

  const writeToStdout = !output && (flagStdout || Boolean(input));
  return { input, output, writeToStdout };
}

const { input, output: argOutput, writeToStdout } = resolveArgs();

let INPUT_FILE;
let INPUT_NAME;
let INPUT_DATE;

if (input) {
  if (!fs.existsSync(input)) {
    console.error(`[map-append-current] Provided input file does not exist: ${input}`);
    process.exit(1);
  }
  INPUT_FILE = input;
  INPUT_NAME = path.basename(input);
  const match = INPUT_NAME.match(/append_(\d{4}-\d{2}-\d{2})/);
  INPUT_DATE = match ? match[1] : 'custom';
} else {
  const resolved = resolveLatestAppend();
  INPUT_FILE = path.join(DATA_DIR, resolved.filename);
  INPUT_NAME = resolved.filename;
  INPUT_DATE = resolved.date;
}

const OUTPUT_FILE = argOutput ||
  (writeToStdout
    ? null
    : path.join(OUTPUT_DIR, `append_current_${INPUT_DATE || 'latest'}.csv`));

const log = writeToStdout ? (...args) => console.error(...args) : (...args) => console.log(...args);

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

function pickFirst(row, ...names) {
  for (const name of names) {
    const value = get(row, name);
    if (value !== '') return value;
  }
  return '';
}

const outputLines = [csvJoin(LEGACY_HEADER)];
let appendedCount = 0;

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row || row.every((cell) => cell.trim() === '')) continue;

  const track = get(row, 'Track');
  const raceNo = get(row, 'Race_No');
  const distance = get(row, 'Distance');
  const rawSurface = get(row, 'Surface');
  const normalizedSurface = normalizeSurface(rawSurface);

  const aiWin = get(row, 'AI_Win');
  const aiPlace = get(row, 'AI_Place');
  const aiShow = get(row, 'AI_Show');
  const rawAiPicks = get(row, 'AI_Picks');

  let aiPicks = '';
  if (rawAiPicks) {
    const picksList = rawAiPicks
      .split(/[,|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const posts = mapNamesToPosts({
      track,
      raceNo,
      surface: normalizedSurface,
      distance,
      picks: picksList,
    });
    if (Array.isArray(posts) && posts.length === picksList.length) {
      const labels = ['WIN', 'PLACE', 'SHOW'];
      aiPicks = posts
        .map((post, idx) => `${labels[idx] || `P${idx + 1}`}: ${post}`)
        .join(' | ');
    } else {
      aiPicks = rawAiPicks;
    }
  } else {
    const picksParts = [];
    picksParts.push(`WIN: ${aiWin || ''}`.trim());
    picksParts.push(`PLACE: ${aiPlace || ''}`.trim());
    picksParts.push(`SHOW: ${aiShow || ''}`.trim());
    aiPicks = picksParts.join(' | ');
  }

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
    normalizeTrack(track),
    raceNo,
    normalizedSurface,
    distance,
    pickFirst(row, 'AI_Confidence', 'Confidence'),
    pickFirst(row, 'Top_3_Mass', 'Top3_Mass'),
    aiPicks,
    pickFirst(row, 'Strategy'),
    pickFirst(row, 'Result_Order', 'Result'),
    pickFirst(row, 'ROI_Percent', 'ROI'),
    pickFirst(row, 'WinRate'),
    notes,
  ];

  if (normalizedSurface && !SURFACES.includes(normalizedSurface)) {
    console.warn(
      `[map-append-current] Unknown surface "${normalizedSurface}" on row ${i + 1}; keeping raw value.`
    );
  }

  const notesWithDate = (() => {
    const date = get(row, 'Date');
    if (!date) return legacyRow[12];
    const existingNotes = legacyRow[12] ? ` | ${legacyRow[12]}` : '';
    return `Date ${date}${existingNotes}`;
  })();

  const outputRow = [...legacyRow];
  outputRow[12] = notesWithDate;

  outputLines.push(csvJoin(outputRow));
  appendedCount++;
}

if (!writeToStdout && OUTPUT_FILE) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

const payload = outputLines.join('\n') + '\n';
if (writeToStdout || !OUTPUT_FILE) {
  process.stdout.write(payload);
  log(`[map-append-current] Source: ${INPUT_NAME}`);
  log(`[map-append-current] Rows mapped: ${appendedCount}`);
} else {
  fs.writeFileSync(OUTPUT_FILE, payload, 'utf8');
  log(`[map-append-current] Source: ${INPUT_NAME}`);
  log(`[map-append-current] Wrote ${OUTPUT_FILE}`);
  log(`[map-append-current] Rows mapped: ${appendedCount}`);
}
