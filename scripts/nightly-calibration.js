import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sh = (cmd, opts = {}) => {
  console.log(`[run] ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
};

const exists = (p) => {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
};

const CSV_MAIN = path.join('data', 'finishline_tests_v1.csv');
const CAL_JSON = path.join('data', 'calibration_v1.json');
const CAL_JSON_TMP = path.join('public', 'data', 'calibration_v1.tmp.json');
const CAL_JSON_OUT = path.join('public', 'data', 'calibration_v1.json');
const CAL_JSON_PREV = path.join('public', 'data', 'calibration_v1.prev.json');
const CSV_OUT = path.join('public', 'data', 'finishline_tests_v1.csv');

const THRESH_MIN_NEW = Number.parseInt(
  process.env.CAL_THRESHOLD_MIN_NEW || '10',
  10
);

const fileSize = (p) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
};

const changedCSV = () => {
  try {
    const status = execSync(`git status --porcelain "${CSV_MAIN}"`, {
      encoding: 'utf8',
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
};

const copy = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
};

const atomicPublish = () => {
  const size = fileSize(CAL_JSON);
  if (!exists(CAL_JSON) || size < 512) {
    throw new Error(
      `[nightly] calibration_v1.json missing or too small (${size} bytes)`
    );
  }

  copy(CAL_JSON, CAL_JSON_TMP);

  const parsed = JSON.parse(fs.readFileSync(CAL_JSON_TMP, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.version) {
    throw new Error(
      '[nightly] calibration_v1.tmp.json invalid JSON or missing {version}'
    );
  }

  if (exists(CAL_JSON_OUT)) {
    copy(CAL_JSON_OUT, CAL_JSON_PREV);
  }
  copy(CAL_JSON_TMP, CAL_JSON_OUT);

  if (exists(CSV_MAIN)) {
    copy(CSV_MAIN, CSV_OUT);
  }

  console.log('[nightly] Published public/data/calibration_v1.json and CSV.');
};

(async function main() {
  console.log('=== Nightly Calibration (preview) ===');

  try {
    sh('npm run append:redis');
  } catch {
    console.log(
      '[nightly] append:redis not defined or failed — continuing without it'
    );
  }

  try {
    sh('npm run append:rows');
  } catch {
    console.log(
      '[nightly] append:rows not defined or failed — continuing without it'
    );
  }

  const csvChanged = changedCSV();

  if (!csvChanged && THRESH_MIN_NEW > 0) {
    console.log(
      `[nightly] No detected CSV changes — skipping calibration (threshold ${THRESH_MIN_NEW}).`
    );
    process.exit(0);
  }

  sh('npm run data:validate');
  sh('npm run calibrate:all');

  atomicPublish();

  console.log('=== Nightly Calibration complete ===');
  process.exit(0);
})().catch((err) => {
  console.error('[nightly] FAILED:', err?.message || err);
  process.exit(1);
});

