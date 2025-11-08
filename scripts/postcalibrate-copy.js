import fs from 'fs';
import path from 'path';

const CAL_SOURCE = path.join('data', 'calibration_v1.json');
const DATA_SOURCE = path.join('data', 'finishline_tests_v1.csv');
const PUBLIC_DATA_DIR = path.join('public', 'data');
const CAL_TARGET = path.join(PUBLIC_DATA_DIR, 'calibration_v1.json');
const DATA_TARGET = path.join(PUBLIC_DATA_DIR, 'finishline_tests_v1.csv');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) {
    console.warn(`[postcalibrate-copy] source missing: ${source}`);
    return false;
  }
  fs.copyFileSync(source, target);
  return true;
}

function run() {
  try {
    ensureDir(PUBLIC_DATA_DIR);

    const copiedCal = copyIfExists(CAL_SOURCE, CAL_TARGET);
    if (copiedCal) {
      console.log(`[postcalibrate-copy] calibration copied -> ${CAL_TARGET}`);
    } else {
      console.warn('[postcalibrate-copy] calibration copy skipped (source missing)');
    }

    const copiedDataset = copyIfExists(DATA_SOURCE, DATA_TARGET);
    if (copiedDataset) {
      console.log(`[postcalibrate-copy] dataset copied -> ${DATA_TARGET}`);
    } else {
      console.warn('[postcalibrate-copy] dataset copy skipped (source missing)');
    }
  } catch (err) {
    console.error('[postcalibrate-copy] failed:', err);
    process.exit(1);
  }
}

run();


