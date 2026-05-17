# Verify V1 Calibration Report

**Generated:** 5/17/2026, 10:02:55 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 24.3% |
| Place Hit Rate | 14.3% |
| Show Hit Rate | 12.2% |
| Top 3 Hit Rate | 80.8% |
| Any Hit Rate | 38.2% |
| Exact Trifecta Rate | 1.0% |
| Partial Order Top 3 Rate | 80.8% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 27.5% |
| Rows with Confidence | 1,374 |
| Rows with T3M | 1,374 |
| Rows with Both | 1,374 |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 403 | 25.1% | 74.9% |
| 40-50% | 535 | 14.2% | 90.5% |
| 50-60% | 205 | 62.4% | 100.0% |
| 60+% | 181 | 14.4% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score (Raw) | 0.6382 |
| Brier Score (Calibrated) | 0.1821 |
| Improvement | +0.4561 |
| Rows with Probability | 1,374 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 60-70% | 77 | 65.0% | 33.8% | -31.2% |
| 70-80% | 130 | 75.0% | 20.0% | -55.0% |
| 80+% | 1,167 | 85.0% | 23.9% | -61.1% |

### Confidence Recalibration

| Metric | Value |
|--------|-------|
| Sample Size | 1,374 |
| Minimum Required | 300 |
| Bucket Count | 2 |
| Status | ✅ Active |

*Recalibration mapping computed using isotonic regression (PAVA algorithm).*

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Gulfstream Park | 493 | 26.2% | 89.5% |
| Aqueduct | 364 | 14.3% | 78.6% |
| Oaklawn Park | 350 | 21.4% | 92.9% |
| Laurel Park | 325 | 23.1% | 92.3% |
| Turf Paradise | 325 | 23.1% | 92.3% |
| Delta Downs | 312 | 25.0% | 75.0% |
| Fair Grounds | 286 | 27.3% | 90.9% |
| Mahoning Valley | 275 | 9.1% | 63.6% |
| Parx Racing | 250 | 50.0% | 90.0% |
| Tampa Bay Downs | 250 | 20.0% | 80.0% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 24.3% | 80.8% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
