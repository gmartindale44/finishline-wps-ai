# Verify V1 Calibration Report

**Generated:** 1/4/2026, 9:03:50 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 24.4% |
| Place Hit Rate | 13.7% |
| Show Hit Rate | 12.2% |
| Top 3 Hit Rate | 81.3% |
| Any Hit Rate | 38.6% |
| Exact Trifecta Rate | 0.9% |
| Partial Order Top 3 Rate | 81.3% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 32.9% |
| Rows with Confidence | 1,643 |
| Rows with T3M | 1,643 |
| Rows with Both | 1,643 |

### Accuracy by Confidence Bucket

| Confidence | Races | Win Hit Rate | Top 3 Hit Rate |
|------------|-------|--------------|----------------|
| 60-70% | 94 | 25.5% | 100.0% |
| 70-80% | 143 | 16.8% | 100.0% |
| 80+% | 1,406 | 25.0% | 85.0% |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 466 | 30.3% | 80.0% |
| 40-50% | 634 | 18.3% | 85.0% |
| 50-60% | 260 | 45.8% | 100.0% |
| 60+% | 213 | 11.3% | 100.0% |

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Gulfstream Park | 456 | 26.3% | 89.5% |
| Aqueduct | 336 | 14.3% | 78.6% |
| Delta Downs | 336 | 21.4% | 71.4% |
| Oaklawn Park | 322 | 21.4% | 92.9% |
| Laurel Park | 312 | 23.1% | 92.3% |
| Turf Paradise | 299 | 23.1% | 92.3% |
| Fair Grounds | 264 | 27.3% | 90.9% |
| Tampa Bay Downs | 253 | 18.2% | 81.8% |
| Parx Racing | 230 | 50.0% | 90.0% |
| Mahoning Valley | 210 | 11.0% | 89.0% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 24.4% | 81.3% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
