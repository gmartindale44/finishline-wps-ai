# Verify V1 Calibration Report

**Generated:** 1/11/2026, 10:14:36 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 24.8% |
| Place Hit Rate | 15.1% |
| Show Hit Rate | 13.7% |
| Top 3 Hit Rate | 82.8% |
| Any Hit Rate | 41.0% |
| Exact Trifecta Rate | 1.4% |
| Partial Order Top 3 Rate | 82.8% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 48.6% |
| Rows with Confidence | 2,430 |
| Rows with T3M | 2,430 |
| Rows with Both | 2,430 |

### Accuracy by Confidence Bucket

| Confidence | Races | Win Hit Rate | Top 3 Hit Rate |
|------------|-------|--------------|----------------|
| 50-60% | 18 | 100.0% | 100.0% |
| 60-70% | 72 | 25.0% | 100.0% |
| 70-80% | 216 | 16.7% | 100.0% |
| 80+% | 2,124 | 25.4% | 85.6% |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 594 | 33.3% | 78.8% |
| 40-50% | 954 | 18.9% | 88.7% |
| 50-60% | 540 | 33.3% | 90.0% |
| 60+% | 288 | 18.8% | 100.0% |

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Fair Grounds | 432 | 29.2% | 87.5% |
| Gulfstream Park | 414 | 26.1% | 91.3% |
| Aqueduct | 396 | 22.7% | 86.4% |
| Mahoning Valley | 360 | 20.0% | 90.0% |
| Parx Racing | 342 | 31.6% | 94.7% |
| Laurel Park | 288 | 18.8% | 93.8% |
| Oaklawn Park | 270 | 20.0% | 86.7% |
| Tampa Bay Downs | 270 | 20.0% | 86.7% |
| Turf Paradise | 270 | 26.7% | 86.7% |
| Delta Downs | 252 | 21.4% | 71.4% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 24.8% | 82.8% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
