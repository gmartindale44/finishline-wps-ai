# Verify V1 Calibration Report

**Generated:** 4/12/2026, 9:07:10 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 22.9% |
| Place Hit Rate | 14.1% |
| Show Hit Rate | 12.4% |
| Top 3 Hit Rate | 81.9% |
| Any Hit Rate | 37.4% |
| Exact Trifecta Rate | 0.9% |
| Partial Order Top 3 Rate | 81.9% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 34.8% |
| Rows with Confidence | 1,742 |
| Rows with T3M | 1,742 |
| Rows with Both | 1,742 |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 352 | 25.0% | 75.0% |
| 40-50% | 729 | 9.1% | 87.9% |
| 50-60% | 243 | 45.7% | 100.0% |
| 60+% | 352 | 18.8% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score (Raw) | 0.6213 |
| Brier Score (Calibrated) | 0.1530 |
| Improvement | +0.4684 |
| Rows with Probability | 1,742 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 50-60% | 22 | 55.0% | 0.0% | -55.0% |
| 60-70% | 330 | 65.0% | 13.3% | -51.7% |
| 70-80% | 132 | 75.0% | 33.3% | -41.7% |
| 80+% | 1,258 | 85.0% | 19.3% | -65.7% |

### Confidence Recalibration

| Metric | Value |
|--------|-------|
| Sample Size | 1,742 |
| Minimum Required | 300 |
| Bucket Count | 4 |
| Status | ✅ Active |

*Recalibration mapping computed using isotonic regression (PAVA algorithm).*

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Gulfstream Park | 528 | 20.8% | 87.5% |
| Fair Grounds | 352 | 25.0% | 87.5% |
| Laurel Park | 352 | 25.0% | 87.5% |
| Aqueduct | 336 | 13.4% | 79.8% |
| Oaklawn Park | 308 | 21.4% | 92.9% |
| Delta Downs | 286 | 23.1% | 76.9% |
| Mahoning Valley | 286 | 7.7% | 69.2% |
| Tampa Bay Downs | 286 | 23.1% | 84.6% |
| Turf Paradise | 286 | 23.1% | 92.3% |
| Parx Racing | 264 | 41.7% | 91.7% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 22.9% | 81.9% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
