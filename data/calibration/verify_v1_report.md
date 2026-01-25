# Verify V1 Calibration Report

**Generated:** 1/25/2026, 9:38:47 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 24.0% |
| Place Hit Rate | 15.0% |
| Show Hit Rate | 13.6% |
| Top 3 Hit Rate | 83.3% |
| Any Hit Rate | 40.3% |
| Exact Trifecta Rate | 1.3% |
| Partial Order Top 3 Rate | 83.3% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 51.2% |
| Rows with Confidence | 2,558 |
| Rows with T3M | 2,558 |
| Rows with Both | 2,558 |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 554 | 32.7% | 79.4% |
| 40-50% | 1,045 | 15.7% | 87.3% |
| 50-60% | 512 | 32.4% | 90.4% |
| 60+% | 398 | 21.1% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score (Raw) | 0.6159 |
| Brier Score (Calibrated) | 0.1786 |
| Improvement | +0.4374 |
| Rows with Probability | 2,558 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 50-60% | 33 | 55.0% | 48.5% | -6.5% |
| 60-70% | 151 | 65.0% | 22.5% | -42.5% |
| 70-80% | 218 | 75.0% | 23.4% | -51.6% |
| 80+% | 2,156 | 85.0% | 22.9% | -62.1% |

### Confidence Recalibration

| Metric | Value |
|--------|-------|
| Sample Size | 2,558 |
| Minimum Required | 300 |
| Bucket Count | 2 |
| Status | ✅ Active |

*Recalibration mapping computed using isotonic regression (PAVA algorithm).*

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Fair Grounds | 476 | 28.6% | 85.7% |
| Gulfstream Park | 442 | 23.1% | 88.5% |
| Aqueduct | 408 | 20.8% | 87.5% |
| Mahoning Valley | 405 | 15.8% | 80.2% |
| Parx Racing | 336 | 28.6% | 95.2% |
| Laurel Park | 323 | 21.1% | 89.5% |
| Delta Downs | 272 | 18.8% | 75.0% |
| Tampa Bay Downs | 272 | 23.5% | 88.2% |
| Oaklawn Park | 240 | 20.0% | 86.7% |
| Turf Paradise | 240 | 26.7% | 86.7% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 24.0% | 83.3% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
