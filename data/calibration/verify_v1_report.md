# Verify V1 Calibration Report

**Generated:** 1/20/2026, 4:01:21 PM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 24.3% |
| Place Hit Rate | 15.2% |
| Show Hit Rate | 13.2% |
| Top 3 Hit Rate | 83.9% |
| Any Hit Rate | 40.3% |
| Exact Trifecta Rate | 1.4% |
| Partial Order Top 3 Rate | 83.9% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 51.0% |
| Rows with Confidence | 2,551 |
| Rows with T3M | 2,551 |
| Rows with Both | 2,551 |

### Accuracy by Confidence Bucket

| Confidence | Races | Win Hit Rate | Top 3 Hit Rate |
|------------|-------|--------------|----------------|
| 50-60% | 33 | 48.5% | 100.0% |
| 60-70% | 101 | 33.7% | 100.0% |
| 70-80% | 221 | 23.1% | 100.0% |
| 80+% | 2,196 | 23.0% | 87.1% |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 572 | 32.3% | 79.7% |
| 40-50% | 1,017 | 16.7% | 90.1% |
| 50-60% | 524 | 32.1% | 90.3% |
| 60+% | 389 | 21.6% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score | 0.6198 |
| Rows with Probability | 2,551 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 50-60% | 33 | 55.0% | 48.5% | -6.5% |
| 60-70% | 101 | 65.0% | 33.7% | -31.3% |
| 70-80% | 221 | 75.0% | 23.1% | -51.9% |
| 80+% | 2,196 | 85.0% | 23.0% | -62.0% |

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Fair Grounds | 442 | 30.8% | 88.5% |
| Gulfstream Park | 425 | 24.0% | 92.0% |
| Mahoning Valley | 425 | 16.0% | 80.0% |
| Aqueduct | 408 | 20.8% | 87.5% |
| Parx Racing | 357 | 28.6% | 95.2% |
| Laurel Park | 306 | 22.2% | 94.4% |
| Delta Downs | 272 | 18.8% | 75.0% |
| Oaklawn Park | 255 | 20.0% | 86.7% |
| Tampa Bay Downs | 255 | 20.0% | 86.7% |
| Turf Paradise | 250 | 26.4% | 87.2% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 24.3% | 83.9% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
