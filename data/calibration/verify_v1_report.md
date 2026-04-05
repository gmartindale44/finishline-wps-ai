# Verify V1 Calibration Report

**Generated:** 4/5/2026, 10:11:35 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 23.3% |
| Place Hit Rate | 15.3% |
| Show Hit Rate | 14.1% |
| Top 3 Hit Rate | 83.1% |
| Any Hit Rate | 39.7% |
| Exact Trifecta Rate | 1.5% |
| Partial Order Top 3 Rate | 83.1% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 45.2% |
| Rows with Confidence | 2,259 |
| Rows with T3M | 2,259 |
| Rows with Both | 2,259 |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 493 | 26.2% | 77.7% |
| 40-50% | 855 | 15.2% | 91.2% |
| 50-60% | 484 | 31.2% | 88.6% |
| 60+% | 372 | 20.2% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score (Raw) | 0.6100 |
| Brier Score (Calibrated) | 0.1683 |
| Improvement | +0.4417 |
| Rows with Probability | 2,259 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 50-60% | 37 | 55.0% | 48.6% | -6.4% |
| 60-70% | 281 | 65.0% | 13.5% | -51.5% |
| 70-80% | 170 | 75.0% | 22.4% | -52.6% |
| 80+% | 1,771 | 85.0% | 22.1% | -62.9% |

### Confidence Recalibration

| Metric | Value |
|--------|-------|
| Sample Size | 2,259 |
| Minimum Required | 300 |
| Bucket Count | 3 |
| Status | ✅ Active |

*Recalibration mapping computed using isotonic regression (PAVA algorithm).*

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Fair Grounds | 494 | 26.9% | 84.6% |
| Gulfstream Park | 475 | 24.0% | 88.0% |
| Mahoning Valley | 443 | 16.9% | 79.5% |
| Parx Racing | 378 | 28.6% | 95.2% |
| Aqueduct | 361 | 21.1% | 84.2% |
| Laurel Park | 342 | 22.2% | 88.9% |
| Delta Downs | 285 | 20.0% | 80.0% |
| Turf Paradise | 270 | 26.7% | 86.7% |
| Oaklawn Park | 252 | 21.4% | 92.9% |
| Tampa Bay Downs | 252 | 21.4% | 85.7% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 23.3% | 83.1% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
