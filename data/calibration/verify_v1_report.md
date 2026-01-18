# Verify V1 Calibration Report

**Generated:** 1/18/2026, 10:23:25 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 24.1% |
| Place Hit Rate | 15.0% |
| Show Hit Rate | 13.3% |
| Top 3 Hit Rate | 83.6% |
| Any Hit Rate | 40.1% |
| Exact Trifecta Rate | 1.4% |
| Partial Order Top 3 Rate | 83.6% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 51.3% |
| Rows with Confidence | 2,567 |
| Rows with T3M | 2,567 |
| Rows with Both | 2,567 |

### Accuracy by Confidence Bucket

| Confidence | Races | Win Hit Rate | Top 3 Hit Rate |
|------------|-------|--------------|----------------|
| 50-60% | 34 | 50.0% | 100.0% |
| 60-70% | 102 | 33.3% | 100.0% |
| 70-80% | 221 | 23.1% | 100.0% |
| 80+% | 2,210 | 23.1% | 86.9% |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 578 | 32.4% | 79.4% |
| 40-50% | 1,020 | 16.7% | 90.0% |
| 50-60% | 527 | 32.3% | 90.3% |
| 60+% | 391 | 21.7% | 100.0% |

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Fair Grounds | 425 | 28.0% | 88.0% |
| Gulfstream Park | 425 | 24.0% | 92.0% |
| Aqueduct | 376 | 22.6% | 85.9% |
| Mahoning Valley | 374 | 18.2% | 90.9% |
| Parx Racing | 357 | 28.6% | 95.2% |
| Laurel Park | 306 | 22.2% | 94.4% |
| Delta Downs | 272 | 18.8% | 75.0% |
| Oaklawn Park | 255 | 20.0% | 86.7% |
| Tampa Bay Downs | 255 | 20.0% | 86.7% |
| Turf Paradise | 255 | 26.7% | 86.7% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 24.1% | 83.6% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
