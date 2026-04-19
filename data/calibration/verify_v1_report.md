# Verify V1 Calibration Report

**Generated:** 4/19/2026, 9:10:14 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 23.5% |
| Place Hit Rate | 14.3% |
| Show Hit Rate | 12.8% |
| Top 3 Hit Rate | 80.7% |
| Any Hit Rate | 38.3% |
| Exact Trifecta Rate | 0.9% |
| Partial Order Top 3 Rate | 80.7% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 30.6% |
| Rows with Confidence | 1,528 |
| Rows with T3M | 1,528 |
| Rows with Both | 1,528 |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 371 | 25.1% | 74.9% |
| 40-50% | 636 | 11.0% | 85.1% |
| 50-60% | 238 | 50.0% | 100.0% |
| 60+% | 213 | 11.3% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score (Raw) | 0.6101 |
| Brier Score (Calibrated) | 0.1537 |
| Improvement | +0.4564 |
| Rows with Probability | 1,528 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 60-70% | 309 | 65.0% | 7.8% | -57.2% |
| 70-80% | 120 | 75.0% | 20.0% | -55.0% |
| 80+% | 1,099 | 85.0% | 23.5% | -61.5% |

### Confidence Recalibration

| Metric | Value |
|--------|-------|
| Sample Size | 1,528 |
| Minimum Required | 300 |
| Bucket Count | 2 |
| Status | ✅ Active |

*Recalibration mapping computed using isotonic regression (PAVA algorithm).*

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Gulfstream Park | 528 | 22.7% | 86.4% |
| Fair Grounds | 360 | 26.7% | 86.7% |
| Aqueduct | 336 | 14.3% | 78.6% |
| Laurel Park | 336 | 21.4% | 85.7% |
| Oaklawn Park | 322 | 21.4% | 92.9% |
| Delta Downs | 312 | 23.1% | 76.9% |
| Tampa Bay Downs | 299 | 23.1% | 84.6% |
| Turf Paradise | 299 | 23.1% | 92.3% |
| Mahoning Valley | 264 | 9.1% | 63.6% |
| Parx Racing | 230 | 50.0% | 90.0% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 23.5% | 80.7% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
