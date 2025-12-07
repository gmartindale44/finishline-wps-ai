# Calibration Pipeline Documentation

## Overview

The FinishLine WPS AI calibration pipeline runs nightly to:
1. Export verify logs from Redis to CSV
2. Build a filtered calibration sample
3. Generate calibration metrics and reports
4. Update the GreenZone similarity dataset

## Pipeline Components

### 1. Export Script: `scripts/calibration/export_verify_redis_to_csv.mjs`

**Purpose**: Exports all verify logs from Redis (`fl:verify:*` keys) to CSV format.

**What it does**:
- Scans all `fl:verify:*` keys in Redis
- Reads verify logs (stored as JSON strings via `redis.set()`)
- Normalizes data to calibration CSV schema
- Writes to `data/finishline_tests_from_verify_redis_v1.csv`

**Supported step types**:
- `verify_race_full` (normal scrape-based verify)
- `verify_race_full_fallback` (HRN/Equibase fallbacks)
- `manual_verify` (manual outcome entry)
- Any other step type that includes required fields

**Required fields per log**:
- `track` (string)
- `date` or `dateIso` (YYYY-MM-DD format)
- `raceNo` (string/number)
- `outcome` object with `win`, `place`, `show`
- `predicted` object with `win`, `place`, `show`
- `hits` object with `winHit`, `placeHit`, `showHit`, `top3Hit` (booleans)

**Usage**:
```bash
npm run export:verify-redis
```

### 2. Calibration Sample Builder: `scripts/calibration/build_calibration_sample_from_verify_csv.mjs`

**Purpose**: Filters the exported CSV to create a predictions-only sample (max 5,000 rows).

**What it does**:
- Reads `data/finishline_tests_from_verify_redis_v1.csv`
- Filters to rows where at least one of `predWin`, `predPlace`, `predShow` is non-empty
- Keeps first 5,000 qualifying rows (stable order)
- Writes to `data/finishline_tests_calibration_v1.csv`

**Usage**:
```bash
npm run build:calibration-sample
```

### 3. Verify v1 Calibration: `scripts/calibration/run_calibrate_verify_v1.mjs`

**Purpose**: Computes performance metrics from the calibration sample.

**What it does**:
- Loads the filtered calibration CSV
- Computes global and per-track hit rates
- Generates JSON report: `data/calibration/verify_v1_report.json`
- Generates Markdown summary: `data/calibration/verify_v1_report.md`

**Usage**:
```bash
npm run calibrate:verify-v1
```

### 4. GreenZone Dataset Loading: `lib/greenzone/greenzone_v1.js`

**Purpose**: Loads merged prediction + verify data for similarity matching at runtime.

**What it does**:
- Loads prediction logs from Redis (`fl:pred:*` keys as hashes via `hgetall()`)
- Loads verify logs from Redis (`fl:verify:*` keys as JSON strings via `get()`)
- Merges by (track, date, raceNo) to combine confidence/top3Mass with outcomes
- Filters to "good outcomes" (winHit=true OR top3Hit=true)
- Caches dataset for 5 minutes to avoid repeated Redis calls

**Key points**:
- Predictions are stored as **hashes** (use `hgetall()`)
- Verify logs are stored as **JSON strings** (use `get()` + `JSON.parse()`)
- Manual verify entries are fully supported and treated as valid calibration data
- If date is missing from verify log, tries `debug.canonicalDateIso` as fallback

**Usage** (runtime, called by `/api/verify_race`):
- Automatically called when verifying races
- Can be tested locally: `npm run debug:greenzone`

## Nightly Workflow

The GitHub Actions workflow `.github/workflows/nightly-calibration.yml` runs daily at 08:00 UTC:

1. Checks out repo
2. Installs dependencies
3. Runs export script
4. Runs calibration sample builder
5. Runs verify v1 calibration
6. Commits updated artifacts to `master` if changed

**Artifacts committed**:
- `data/finishline_tests_from_verify_redis_v1.csv`
- `data/finishline_tests_calibration_v1.csv`
- `data/calibration/verify_v1_report.json`
- `data/calibration/verify_v1_report.md`

## Local Testing

### Full Pipeline Run
```bash
npm run export:verify-redis
npm run build:calibration-sample
npm run calibrate:verify-v1
```

### GreenZone Debug
```bash
npm run debug:greenzone
```

This tests:
- Loading merged dataset from Redis
- Computing similarity for a sample race
- Card candidate matching

## Data Flow

```
Redis (fl:verify:*) 
  ↓ (export script)
CSV (finishline_tests_from_verify_redis_v1.csv)
  ↓ (sample builder)
CSV (finishline_tests_calibration_v1.csv)
  ↓ (verify v1 calibration)
Reports (JSON + Markdown)
  
Redis (fl:pred:* + fl:verify:*)
  ↓ (GreenZone runtime loader)
Merged Dataset (in-memory, cached 5min)
  ↓ (similarity computation)
GreenZone Results (returned to /api/verify_race)
```

## Important Notes

### Verify Log Storage Format
- Verify logs are stored as **JSON strings** using `redis.set(key, JSON.stringify(payload))`
- Use `redis.get()` + `JSON.parse()` to read them
- GreenZone was updated to handle this format correctly

### Manual Verify Support
- Manual verify entries (`step: "manual_verify"`) are fully supported
- They include the same fields as normal verify logs
- Date fallback to today is handled gracefully

### Historical Count Meaning
When GreenZone returns `historicalCount: 0` or `insufficient_historical_data`:
- This means there aren't enough races with both:
  - Prediction logs (confidence + top3Mass)
  - Verify logs with good outcomes (winHit=true OR top3Hit=true)
- Minimum required: 20 historical races (configurable in `GREENZONE_CONFIG.MIN_HISTORICAL_RACES`)

### Date Handling
- Verify logs should have `date` or `dateIso` field
- Manual verify may fallback to today if date parsing fails
- Export script tries `debug.canonicalDateIso` as fallback
- GreenZone extracts date from key pattern if missing from data

## Troubleshooting

### No historical data
- Check Redis has prediction logs: `fl:pred:*` keys
- Check Redis has verify logs: `fl:verify:*` keys
- Verify logs must have `hits.winHit=true` OR `hits.top3Hit=true` to be "good outcomes"

### Export script fails
- Check Redis connection: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Verify logs must be valid JSON (if parsing fails, entry is skipped)

### GreenZone disabled
- Check `historicalCount` in debug output
- Need at least 20 races with predictions + good outcomes
- Check that prediction logs have `confidence` and `top3_mass` fields

