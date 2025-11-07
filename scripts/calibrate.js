import fs from 'node:fs';
import path from 'node:path';

const CSV_PATH = path.join(process.cwd(), 'data', 'finishline_tests_v1.csv');
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'calibration_v1.json');

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

const CONFIDENCE_BINS = [
  { label: '50-54', min: 50, max: 54 },
  { label: '55-59', min: 55, max: 59 },
  { label: '60-64', min: 60, max: 64 },
  { label: '65-69', min: 65, max: 69 },
  { label: '70-74', min: 70, max: 74 },
  { label: '75-79', min: 75, max: 79 },
  { label: '80-84', min: 80, max: 84 },
  { label: '85+', min: 85, max: Infinity },
];

function loadCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error('Dataset missing – run append first.');
  }
  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.trim().split('\n');
  const headerLine = lines.shift();
  const header = headerLine ? headerLine.split(',').map(h => h.trim()) : [];

  if (header.join(',') !== LEGACY_HEADERS.join(',')) {
    throw new Error('Unexpected header – calibration expects legacy schema.');
  }

  const rows = lines.filter(Boolean).map(line => parseCsv(line, header.length));
  return rows.map(row => Object.fromEntries(LEGACY_HEADERS.map((h, idx) => [h, row[idx] ?? ''])));
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

function percentFromDecimal(value) {
  if (!value) return NaN;
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  return num * 100;
}

function parseRoi(value) {
  if (!value) return NaN;
  const cleaned = String(value).replace(/[^0-9+\-\.]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function isExotic(strategy) {
  if (!strategy) return false;
  const s = strategy.toLowerCase();
  return s.includes('exacta') || s.includes('trifecta');
}

function buildBinStats() {
  const stats = new Map();
  CONFIDENCE_BINS.forEach(bin => {
    stats.set(bin.label, {
      label: bin.label,
      count: 0,
      winHits: 0,
      top3Hits: 0,
      roiSum: 0,
      roiCount: 0,
      exoticTotal: 0,
      exoticHits: 0,
    });
  });
  return stats;
}

function pickBin(confPct) {
  for (const bin of CONFIDENCE_BINS) {
    if (confPct >= bin.min && confPct <= bin.max) return bin.label;
    if (bin.max === Infinity && confPct >= bin.min) return bin.label;
  }
  return CONFIDENCE_BINS[0].label;
}

function safeParseDistance(dist) {
  if (!dist) return { yards: NaN, surface: '', klass: '' };
  let yards = NaN;
  const matchY = /([0-9]+)Y/i.exec(dist);
  const matchF = /([0-9]+(?:\.[0-9]+)?)F/i.exec(dist);
  if (matchY) {
    yards = Number(matchY[1]);
  } else if (matchF) {
    const furlongs = Number(matchF[1]);
    if (Number.isFinite(furlongs)) {
      yards = Math.round(furlongs * 220);
    }
  }
  return { yards };
}

function computeCalibration(rows) {
  const binStats = buildBinStats();

  rows.forEach(row => {
    const confPct = percentFromDecimal(row.Confidence);
    if (!Number.isFinite(confPct)) return;
    const binLabel = pickBin(confPct);
    const stat = binStats.get(binLabel);
    stat.count += 1;

    const winRate = (row.WinRate || '').toLowerCase();
    if (winRate === 'win') stat.winHits += 1;

    const result = (row.Result || '').toLowerCase();
    if (result === 'hit' || result === 'partial') stat.top3Hits += 1;

    const roi = parseRoi(row.ROI_Percent);
    if (!Number.isNaN(roi)) {
      stat.roiSum += roi;
      stat.roiCount += 1;
    }

    if (isExotic(row.Strategy)) {
      stat.exoticTotal += 1;
      if (result === 'hit') stat.exoticHits += 1;
    }
  });

  const binMetrics = Array.from(binStats.values()).map(stat => {
    return {
      bin: stat.label,
      count: stat.count,
      win_rate: stat.count ? Number((stat.winHits / stat.count).toFixed(3)) : 0,
      top3_rate: stat.count ? Number((stat.top3Hits / stat.count).toFixed(3)) : 0,
      avg_roi_atb2: stat.roiCount ? Number((stat.roiSum / stat.roiCount).toFixed(2)) : null,
      exotic_hit_rate: stat.exoticTotal ? Number((stat.exoticHits / stat.exoticTotal).toFixed(3)) : null,
    };
  });

  return binMetrics;
}

function writeCalibrationFile(binMetrics) {
  const payload = {
    version: 'v1',
    generated_at: new Date().toISOString(),
    bin_metrics: binMetrics,
    stake_curve: {
      '50': 1,
      '55': 1,
      '60': 1,
      '65': 1,
      '70': 2,
      '75': 2,
      '80': 3,
      '85': 3,
    },
    exotics_rules: {
      exacta_min_top3: 45,
      trifecta_min_top3: 55,
      min_conf_for_win_only: 80,
    },
    distance_mods: {
      '≤250y_maiden': {
        exotics_penalty: 0.05,
      },
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[calibrate] Wrote calibration file to ${OUTPUT_PATH}`);
}

function main() {
  try {
    const rows = loadCsv();
    const metrics = computeCalibration(rows);
    writeCalibrationFile(metrics);
  } catch (err) {
    console.error('[calibrate] Fatal:', err?.message || err);
    process.exit(1);
  }
}

main();
