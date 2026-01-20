# Post-Enforcement Diagnostics Report

**Generated:** 2026-01-19T00:19:17.825Z
**Commit:** `cccb40ee86376fb39856174c430fe791e3f6f91d` (short: `cccb40ee`)
**Report Type:** Post-Enforcement Trend Monitoring

## Executive Summary

✅ **No regression warnings or watch conditions detected.**

**Current Metrics:**
- Top 3 Hit Rate: 83.64%
- Win Hit Rate: 24.14%
- Predmeta Coverage: 51.34%

## Metrics Comparison

### Global Metrics

| Metric | Previous | Current | Delta | Status |
|--------|----------|---------|-------|--------|
| **Top 3 Hit Rate** | 82.76% | 83.64% | +0.88pp | ⬆️ Improved |
| **Win Hit Rate** | 24.82% | 24.14% | -0.68pp | ⬇️ Decreased |
| **Place Hit Rate** | 15.12% | 14.96% | -0.16pp | ⬇️ Decreased |
| **Show Hit Rate** | 13.66% | 13.26% | -0.40pp | ⬇️ Decreased |
| **Any Hit Rate** | 41.00% | 40.12% | -0.88pp | ⬇️ Decreased |
| **Exact Trifecta Rate** | 1.44% | 1.36% | -0.08pp | ⬇️ Decreased |

### Predmeta Coverage

| Metric | Previous | Current | Delta |
|--------|----------|---------|-------|
| **Coverage Rate** | 48.60% | 51.34% | +2.74pp |

## Trend History (Last 5 Runs)

| Date | Commit | Top 3 | Win | Place | Show | Coverage |
|------|--------|-------|-----|-------|------|----------|
| 2026-01-14 | `fd7d107a` | 83.16% | 24.32% | 14.92% | 13.80% | 49.48% |
| 2026-01-18 | `cccb40ee` | 83.64% | 24.14% | 14.96% | 13.26% | 51.34% |
| 2026-01-19 | `cccb40ee` | 83.64% | 24.14% | 14.96% | 13.26% | 51.34% |

### Deltas (vs Previous Run)

- **Top 3 Hit Rate:** +0.00pp
- **Win Hit Rate:** +0.00pp
- **Place Hit Rate:** +0.00pp
- **Show Hit Rate:** +0.00pp
- **Predmeta Coverage:** +0.00pp

## Artifact Details

### Current Run

- **Generated At:** 2026-01-19T00:19:17.664Z
- **Commit:** `cccb40ee86376fb39856174c430fe791e3f6f91d`
- **Sample Size:** 5000 rows
- **Source:** Production Redis verify logs

### Previous Run (Baseline)

- **Generated At:** 2026-01-11T10:14:36.324Z
- **Sample Size:** 5000 rows
- **Baseline commit used:** `fd7d107ae4015206bc758686d046821189604899` (source: trend_data)

## Regression Guardrails

**Active Thresholds:**
- Top 3 Hit Rate drop ≥ 1.0pp → REGRESSION WARNING
- Win Hit Rate drop ≥ 1.0pp for 2 consecutive runs → WATCH
