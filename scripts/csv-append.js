import fs from 'node:fs';
import path from 'node:path';

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

const CSV_PATH = path.join(process.cwd(), 'data', 'finishline_tests_v1.csv');

const INCOMING_ROWS = [
  {
    track: 'Lone Star Park',
    date_iso: '2024-11-06',
    race_num: 12,
    distance_yards: 220,
    surface: 'Dirt',
    class: 'Maiden',
    strategy: 'ATB',
    result: 'Miss',
    roi_percent: '-100',
    win_rate: 'Loss',
    ai_win_pick: 'Heza Higher Fire',
    ai_place_pick: 'Famous Moon Risen',
    ai_show_pick: 'Pyc Dash Ta Phoebe',
    ai_confidence_pct: 70,
    top3_mass_pct: 33,
    gap1to2_pct: 0.6,
    gap2to3_pct: 0.6,
    notes: '2024-11-06 R12 Sprint variance; boundary miss (finish 8-1-4).',
    source_screenshot: '/evidence/LSP_12_combo.png',
  },
  {
    track: 'Lone Star Park',
    date_iso: '2024-11-06',
    race_num: 11,
    distance_yards: 300,
    surface: 'Dirt',
    class: 'Allowance',
    strategy: 'ATB',
    result: 'Hit',
    roi_percent: '+32',
    win_rate: 'Win',
    ai_win_pick: 'Grand Charming Elan',
    ai_place_pick: 'Bv Hello Goodbye',
    ai_show_pick: 'D One Famous Bandit',
    ai_confidence_pct: 70,
    top3_mass_pct: 33,
    gap1to2_pct: 0.6,
    gap2to3_pct: 0.6,
    notes: '2024-11-06 R11 ATB primary; exotics guarded (finish 4-1-8).',
    source_screenshot: '/evidence/LSP_11_combo.png',
  },
  {
    track: 'Lone Star Park',
    date_iso: '2024-11-06',
    race_num: 10,
    distance_yards: 220,
    surface: 'Dirt',
    class: 'Maiden',
    strategy: 'ATB',
    result: 'Partial',
    roi_percent: '+12',
    win_rate: 'Place',
    ai_win_pick: 'Relentless Silk',
    ai_place_pick: 'Down in the Swamp',
    ai_show_pick: 'Sneaky Eagle',
    ai_confidence_pct: 69,
    top3_mass_pct: 39,
    gap1to2_pct: 0.9,
    gap2to3_pct: 0.9,
    notes: '2024-11-06 R10 ATB only; no exotics (finish 4-6-7).',
    source_screenshot: '/evidence/LSP_10_combo.png',
  },
  {
    track: 'Mahoning Valley',
    date_iso: '2024-11-06',
    race_num: 7,
    distance_yards: 1320,
    surface: 'Dirt',
    class: 'Claiming',
    strategy: 'Exacta Box',
    result: 'Hit',
    roi_percent: '+48',
    win_rate: 'Win',
    ai_win_pick: 'Sundown Express',
    ai_place_pick: 'Fleet Mahoning',
    ai_show_pick: 'Heritage Lane',
    ai_confidence_pct: 68,
    top3_mass_pct: 41,
    gap1to2_pct: 0.7,
    gap2to3_pct: 0.5,
    notes: '2024-11-06 MVR R7 Exacta landed (finish 3-5-2).',
    source_screenshot: '/evidence/MVR_7_combo.png',
  },
  {
    track: 'Mahoning Valley',
    date_iso: '2024-11-06',
    race_num: 8,
    distance_yards: 1430,
    surface: 'Dirt',
    class: 'Allowance',
    strategy: 'ATB',
    result: 'Miss',
    roi_percent: '-80',
    win_rate: 'Loss',
    ai_win_pick: 'Stowaway Dreams',
    ai_place_pick: 'Northern Pledge',
    ai_show_pick: 'Cash Collection',
    ai_confidence_pct: 66,
    top3_mass_pct: 36,
    gap1to2_pct: 0.5,
    gap2to3_pct: 0.4,
    notes: '2024-11-06 MVR R8 Chaotic pace collapse (finish 7-4-1).',
    source_screenshot: '/evidence/MVR_8_combo.png',
  },
  {
    track: 'Aqueduct',
    date_iso: '2024-11-06',
    race_num: 5,
    distance_yards: 1320,
    surface: 'Dirt',
    class: 'Allowance',
    strategy: 'Win Only',
    result: 'Hit',
    roi_percent: '+54',
    win_rate: 'Win',
    ai_win_pick: 'Empire Rally',
    ai_place_pick: 'Queens Charge',
    ai_show_pick: 'Morning Encore',
    ai_confidence_pct: 75,
    top3_mass_pct: 47,
    gap1to2_pct: 0.8,
    gap2to3_pct: 0.6,
    notes: '2024-11-06 AQU R5 High confidence win (finish 6-2-4).',
    source_screenshot: '/evidence/AQU_5_combo.png',
  },
  {
    track: 'Aqueduct',
    date_iso: '2024-11-06',
    race_num: 8,
    distance_yards: 1810,
    surface: 'Dirt',
    class: 'Stakes',
    strategy: 'Exacta Box',
    result: 'Partial',
    roi_percent: '+10',
    win_rate: 'Place',
    ai_win_pick: 'Broadway Bullet',
    ai_place_pick: 'Metropolitan Star',
    ai_show_pick: 'Hudson Flyer',
    ai_confidence_pct: 72,
    top3_mass_pct: 46,
    gap1to2_pct: 0.7,
    gap2to3_pct: 0.5,
    notes: '2024-11-06 AQU R8 Exacta split, trifecta whiff (finish 4-6-3).',
    source_screenshot: '/evidence/AQU_8_combo.png',
  },
  {
    track: 'Woodbine',
    date_iso: '2024-11-06',
    race_num: 9,
    distance_yards: 1760,
    surface: 'AllWeather',
    class: 'Allowance',
    strategy: 'ATB',
    result: 'Hit',
    roi_percent: '+28',
    win_rate: 'Win',
    ai_win_pick: 'Northern Spirit',
    ai_place_pick: 'Turfside Tempo',
    ai_show_pick: 'Seaway Charm',
    ai_confidence_pct: 70,
    top3_mass_pct: 44,
    gap1to2_pct: 0.6,
    gap2to3_pct: 0.4,
    notes: '2024-11-06 WO R9 AI sweep (finish 5-2-3).',
    source_screenshot: '/evidence/WO_9_combo.png',
  },
  {
    track: 'Woodbine',
    date_iso: '2024-11-06',
    race_num: 10,
    distance_yards: 1980,
    surface: 'AllWeather',
    class: 'Stakes',
    strategy: 'Trifecta Box',
    result: 'Miss',
    roi_percent: '-120',
    win_rate: 'Loss',
    ai_win_pick: 'Polar Command',
    ai_place_pick: 'Seaway City',
    ai_show_pick: 'Quiet Atlantic',
    ai_confidence_pct: 68,
    top3_mass_pct: 40,
    gap1to2_pct: 0.4,
    gap2to3_pct: 0.3,
    notes: '2024-11-06 WO R10 Late closer chaos (finish 9-7-4).',
    source_screenshot: '/evidence/WO_10_combo.png',
  },
  {
    track: 'Penn National',
    date_iso: '2024-11-06',
    race_num: 6,
    distance_yards: 1320,
    surface: 'Dirt',
    class: 'Allowance',
    strategy: 'ATB',
    result: 'Partial',
    roi_percent: '+5',
    win_rate: 'Place',
    ai_win_pick: 'Capital Lights',
    ai_place_pick: 'River Patrol',
    ai_show_pick: 'Zensational Mark',
    ai_confidence_pct: 67,
    top3_mass_pct: 38,
    gap1to2_pct: 0.5,
    gap2to3_pct: 0.4,
    notes: '2024-11-06 PEN R6 Top pick ran second (finish 2-5-4).',
    source_screenshot: '/evidence/PEN_6_combo.png',
  },
  {
    track: 'Penn National',
    date_iso: '2024-11-06',
    race_num: 8,
    distance_yards: 1430,
    surface: 'Dirt',
    class: 'Allowance',
    strategy: 'Exacta Box',
    result: 'Hit',
    roi_percent: '+60',
    win_rate: 'Win',
    ai_win_pick: 'Keystone Drive',
    ai_place_pick: 'Susquehanna Bay',
    ai_show_pick: 'Midnight Signal',
    ai_confidence_pct: 71,
    top3_mass_pct: 45,
    gap1to2_pct: 0.7,
    gap2to3_pct: 0.5,
    notes: '2024-11-06 PEN R8 Exacta hammered (finish 3-5-1).',
    source_screenshot: '/evidence/PEN_8_combo.png',
  },
  {
    track: 'Horseshoe Indianapolis',
    date_iso: '2024-11-06',
    race_num: 9,
    distance_yards: 1760,
    surface: 'Dirt',
    class: 'Allowance',
    strategy: 'Win Only',
    result: 'Hit',
    roi_percent: '+62',
    win_rate: 'Win',
    ai_win_pick: 'Hoosier Velocity',
    ai_place_pick: 'Tempo Nation',
    ai_show_pick: 'Crosswind Ace',
    ai_confidence_pct: 78,
    top3_mass_pct: 52,
    gap1to2_pct: 0.8,
    gap2to3_pct: 0.6,
    notes: '2024-11-06 IND R9 Strong closer validated (finish 7-3-4).',
    source_screenshot: '/evidence/IND_9_combo.png',
  },
  {
    track: 'Horseshoe Indianapolis',
    date_iso: '2024-11-06',
    race_num: 10,
    distance_yards: 1870,
    surface: 'Dirt',
    class: 'Claiming',
    strategy: 'ATB',
    result: 'Miss',
    roi_percent: '-90',
    win_rate: 'Loss',
    ai_win_pick: 'Backstretch Baron',
    ai_place_pick: 'Indiana Dice',
    ai_show_pick: 'Sunset Agent',
    ai_confidence_pct: 65,
    top3_mass_pct: 35,
    gap1to2_pct: 0.4,
    gap2to3_pct: 0.3,
    notes: '2024-11-06 IND R10 Sloppy track fade (finish 8-2-5).',
    source_screenshot: '/evidence/IND_10_combo.png',
  },
];

function readCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV file not found at ${CSV_PATH}`);
  }
  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.trim().split('\n');
  const headerLine = lines.shift();
  const header = headerLine ? headerLine.split(',') : [];

  if (normalizeHeader(header) !== normalizeHeader(LEGACY_HEADERS)) {
    throw new Error('CSV header mismatch – aborting append');
  }

  const rows = lines.filter(Boolean).map(line => parseCsvLine(line));
  return { header, rows, headerLine };
}

function normalizeHeader(arr) {
  return arr.map(h => h.trim()).join(',');
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  while (result.length < LEGACY_HEADERS.length) result.push('');
  return result;
}

function formatCsvValue(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || /\s/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatDecimal(input) {
  if (input == null || input === '') return '';
  const num = Number(input);
  if (!Number.isFinite(num)) return '';
  const normalized = num > 1 ? num / 100 : num;
  return normalized.toFixed(2);
}

function buildAiPicks(row) {
  const parts = [row.ai_win_pick, row.ai_place_pick, row.ai_show_pick]
    .map(v => (v || '').trim())
    .filter(Boolean);
  return parts.join(' - ');
}

function synthesizeNotes(row) {
  const base = (row.notes || '').trim();
  const shot = (row.source_screenshot || '').trim();
  if (base && shot) return `${base} [${shot}]`;
  return base || shot;
}

function distanceString(row) {
  if (row.distance) return String(row.distance);
  if (row.distance_yards) return `${row.distance_yards}Y`;
  return '';
}

function dedupeKey(columns) {
  return [
    (columns.Track || '').toLowerCase(),
    (columns.Race_No || '').toLowerCase(),
    (columns.AI_Picks || '').toLowerCase(),
    (columns.Notes || '').toLowerCase(),
  ].join('|');
}

function mapIncomingRow(row) {
  const mapped = Object.fromEntries(LEGACY_HEADERS.map(h => [h, '']));
  mapped.Track = row.track || row.Track || '';
  mapped.Race_No = row.race_num != null ? String(row.race_num) : (row.Race_No || '');
  mapped.Surface = row.surface || row.Surface || '';
  mapped.Distance = distanceString(row);
  mapped.Confidence = formatDecimal(row.ai_confidence_pct ?? row.confidence_pct ?? row.Confidence);
  mapped.Top_3_Mass = formatDecimal(row.top3_mass_pct ?? row.Top_3_Mass);
  mapped.AI_Picks = row.AI_Picks || buildAiPicks(row);
  mapped.Strategy = row.strategy || row.Strategy || 'ATB';
  mapped.Result = row.result || row.Result || '';
  mapped.ROI_Percent = row.roi_percent ?? row.ROI_Percent ?? '';
  mapped.WinRate = row.win_rate || row.WinRate || '';
  mapped.Notes = synthesizeNotes(row);
  return mapped;
}

function appendRows() {
  const { header, rows } = readCsv();
  const existing = rows.map(cols => Object.fromEntries(header.map((h, idx) => [h, cols[idx] ?? ''])));
  const existingKeys = new Set(existing.map(dedupeKey));

  const additions = [];
  for (const incoming of INCOMING_ROWS) {
    const mapped = mapIncomingRow(incoming);
    const key = dedupeKey(mapped);
    if (existingKeys.has(key)) {
      console.log(`Skipping duplicate row for ${mapped.Track} R${mapped.Race_No}`);
      continue;
    }
    existingKeys.add(key);
    additions.push(mapped);
  }

  if (!additions.length) {
    console.log('No new rows to append.');
    return;
  }

  const maxId = existing.reduce((acc, row) => {
    const tid = Number(row.Test_ID);
    return Number.isFinite(tid) ? Math.max(acc, tid) : acc;
  }, 0);

  let nextId = maxId + 1;

  const lines = additions.map(row => {
    const outputRow = { ...row, Test_ID: String(nextId++) };
    return LEGACY_HEADERS.map(h => formatCsvValue(outputRow[h])).join(',');
  });

  const appendLine = '\n' + lines.join('\n') + '\n';
  fs.appendFileSync(CSV_PATH, appendLine, 'utf8');
  console.log(`Appended ${additions.length} rows to finishline_tests_v1.csv`);
}

appendRows();
