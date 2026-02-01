# Verify V1 Calibration Report

**Generated:** 2/1/2026, 8:57:41 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 23.5% |
| Place Hit Rate | 14.9% |
| Show Hit Rate | 13.7% |
| Top 3 Hit Rate | 83.6% |
| Any Hit Rate | 40.0% |
| Exact Trifecta Rate | 1.3% |
| Partial Order Top 3 Rate | 83.6% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 52.4% |
| Rows with Confidence | 2,619 |
| Rows with T3M | 2,619 |
| Rows with Both | 2,619 |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 547 | 32.5% | 79.5% |
| 40-50% | 1,067 | 15.1% | 87.9% |
| 50-60% | 534 | 30.3% | 91.0% |
| 60+% | 407 | 19.9% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score (Raw) | 0.6096 |
| Brier Score (Calibrated) | 0.1728 |
| Improvement | +0.4368 |
| Rows with Probability | 2,619 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 50-60% | 33 | 55.0% | 48.5% | -6.5% |
| 60-70% | 258 | 65.0% | 12.8% | -52.2% |
| 70-80% | 212 | 75.0% | 22.6% | -52.4% |
| 80+% | 2,116 | 85.0% | 22.9% | -62.1% |

### Confidence Recalibration

| Metric | Value |
|--------|-------|
| Sample Size | 2,619 |
| Minimum Required | 300 |
| Bucket Count | 2 |
| Status | ✅ Active |

*Recalibration mapping computed using isotonic regression (PAVA algorithm).*

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Fair Grounds | 464 | 27.6% | 86.2% |
| Gulfstream Park | 448 | 21.4% | 89.3% |
| Aqueduct | 408 | 20.8% | 87.5% |
| Mahoning Valley | 400 | 16.0% | 80.0% |
| Parx Racing | 336 | 28.6% | 95.2% |
| Laurel Park | 304 | 21.1% | 89.5% |
| Tampa Bay Downs | 288 | 22.2% | 88.9% |
| Delta Downs | 272 | 17.6% | 76.5% |
| Oaklawn Park | 240 | 20.0% | 86.7% |
| Turf Paradise | 240 | 26.7% | 86.7% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 23.5% | 83.6% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
