# Verify V1 Calibration Report

**Generated:** 12/28/2025, 9:25:03 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 23.7% |
| Place Hit Rate | 14.9% |
| Show Hit Rate | 11.6% |
| Top 3 Hit Rate | 80.0% |
| Any Hit Rate | 37.5% |
| Exact Trifecta Rate | 1.0% |
| Partial Order Top 3 Rate | 80.0% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 24.8% |
| Rows with Confidence | 1,241 |
| Rows with T3M | 1,241 |
| Rows with Both | 1,241 |

### Accuracy by Confidence Bucket

| Confidence | Races | Win Hit Rate | Top 3 Hit Rate |
|------------|-------|--------------|----------------|
| 60-70% | 26 | 0.0% | 100.0% |
| 70-80% | 108 | 25.0% | 100.0% |
| 80+% | 1,107 | 21.5% | 83.4% |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 392 | 20.2% | 73.2% |
| 40-50% | 478 | 11.1% | 88.9% |
| 50-60% | 212 | 62.7% | 100.0% |
| 60+% | 107 | 0.0% | 100.0% |

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Gulfstream Park | 501 | 26.3% | 89.4% |
| Laurel Park | 338 | 23.1% | 92.3% |
| Oaklawn Park | 338 | 15.4% | 92.3% |
| Turf Paradise | 338 | 23.1% | 92.3% |
| Delta Downs | 324 | 25.0% | 75.0% |
| Fair Grounds | 297 | 27.3% | 90.9% |
| Aqueduct | 270 | 10.0% | 70.0% |
| Tampa Bay Downs | 260 | 20.0% | 80.0% |
| Mahoning Valley | 208 | 12.5% | 87.5% |
| Parx Racing | 208 | 50.0% | 87.5% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 23.7% | 80.0% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
