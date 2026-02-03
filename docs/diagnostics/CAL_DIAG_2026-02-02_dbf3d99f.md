# Post-Enforcement Diagnostics Report

**Generated:** 2026-02-02T23:19:55.717Z
**Commit:** `dbf3d99f3be65d4225217952ebeab697349a31bb` (short: `dbf3d99f`)
**Report Type:** Post-Enforcement Trend Monitoring

## Executive Summary

✅ **No regression warnings or watch conditions detected.**

**Current Metrics:**
- Top 3 Hit Rate: 83.62%
- Win Hit Rate: 23.52%
- Predmeta Coverage: 52.38%

## Metrics Comparison

### Global Metrics

| Metric | Previous | Current | Delta | Status |
|--------|----------|---------|-------|--------|
| **Top 3 Hit Rate** | 83.64% | 83.62% | -0.02pp | ⬇️ Decreased |
| **Win Hit Rate** | 24.14% | 23.52% | -0.62pp | ⬇️ Decreased |
| **Place Hit Rate** | 14.96% | 14.86% | -0.10pp | ⬇️ Decreased |
| **Show Hit Rate** | 13.26% | 13.70% | +0.44pp | ⬆️ Improved |
| **Any Hit Rate** | 40.12% | 40.04% | -0.08pp | ⬇️ Decreased |
| **Exact Trifecta Rate** | 1.36% | 1.32% | -0.04pp | ⬇️ Decreased |

### Predmeta Coverage

| Metric | Previous | Current | Delta |
|--------|----------|---------|-------|
| **Coverage Rate** | 51.34% | 52.38% | +1.04pp |

## Trend History (Last 5 Runs)

| Date | Commit | Top 3 | Win | Place | Show | Coverage |
|------|--------|-------|-----|-------|------|----------|
| 2026-01-14 | `fd7d107a` | 83.16% | 24.32% | 14.92% | 13.80% | 49.48% |
| 2026-01-19 | `cccb40ee` | 83.64% | 24.14% | 14.96% | 13.26% | 51.34% |
| 2026-01-19 | `0f2b038c` | 83.64% | 24.14% | 14.96% | 13.26% | 51.34% |
| 2026-01-20 | `7f2cd1d6` | 83.90% | 24.32% | 15.22% | 13.24% | 51.02% |
| 2026-02-02 | `dbf3d99f` | 83.62% | 23.52% | 14.86% | 13.70% | 52.38% |

### Deltas (vs Previous Run)

- **Top 3 Hit Rate:** -0.28pp
- **Win Hit Rate:** -0.80pp
- **Place Hit Rate:** -0.36pp
- **Show Hit Rate:** +0.46pp
- **Predmeta Coverage:** +1.36pp

## Artifact Details

### Current Run

- **Generated At:** 2026-02-02T23:19:55.542Z
- **Commit:** `dbf3d99f3be65d4225217952ebeab697349a31bb`
- **Sample Size:** 5000 rows
- **Source:** Production Redis verify logs

### Previous Run (Baseline)

- **Generated At:** 2026-01-18T10:23:25.439Z
- **Sample Size:** 5000 rows
- **Baseline commit used:** `0f2b038ca44a452777ee035640ec5be85a60ec46` (source: trend_data)

## Calibration Metrics

### Brier Score

| Metric | Current | Previous | Delta |
|--------|---------|----------|-------|
| Brier Score (Raw) | 0.6096 | N/A | N/A |
| Brier Score (Calibrated) | 0.1728 | N/A | N/A |
| Improvement (Raw → Calibrated) | 0.4368 | - | - |
| Rows with Probability | 2,619 | - | - |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected | Observed | Error |
|------------|-------|----------|----------|-------|
| 50-60% | 33 | 55.00% | 48.48% | -6.52% |
| 60-70% | 258 | 65.00% | 12.79% | -52.21% |
| 70-80% | 212 | 75.00% | 22.64% | -52.36% |
| 80+% | 2,116 | 85.00% | 22.92% | -62.08% |

### Confidence Recalibration Status

- **Sample Size:** 2,619 (minimum: 300)
- **Bucket Count:** 2
- **Status:** ✅ Active (Isotonic Regression)

## Regression Guardrails

**Active Thresholds:**
- Top 3 Hit Rate drop ≥ 1.0pp → REGRESSION WARNING
- Win Hit Rate drop ≥ 1.0pp for 2 consecutive runs → WATCH
- Brier Score (Raw) increase ≥ 0.01 → WATCH
- Brier Score (Calibrated) increase ≥ 0.01 → WATCH
