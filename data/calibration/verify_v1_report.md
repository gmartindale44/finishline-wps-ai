# Verify V1 Calibration Report

**Generated:** 12/28/2025, 1:09:53 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 22.8% |
| Place Hit Rate | 16.5% |
| Show Hit Rate | 12.9% |
| Top 3 Hit Rate | 79.0% |
| Any Hit Rate | 38.1% |
| Exact Trifecta Rate | 1.2% |
| Partial Order Top 3 Rate | 79.0% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 16.4% |
| Rows with Confidence | 822 |
| Rows with T3M | 822 |
| Rows with Both | 822 |

### Accuracy by Confidence Bucket

| Confidence | Races | Win Hit Rate | Top 3 Hit Rate |
|------------|-------|--------------|----------------|
| 60-70% | 29 | 0.0% | 100.0% |
| 70-80% | 89 | 32.6% | 100.0% |
| 80+% | 704 | 12.5% | 79.3% |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 203 | 0.0% | 71.4% |
| 40-50% | 325 | 0.0% | 81.8% |
| 50-60% | 147 | 79.6% | 100.0% |
| 60+% | 89 | 0.0% | 100.0% |

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Gulfstream Park | 551 | 26.3% | 89.5% |
| Laurel Park | 377 | 23.1% | 92.3% |
| Aqueduct | 300 | 10.0% | 70.0% |
| Tampa Bay Downs | 290 | 20.0% | 80.0% |
| Delta Downs | 270 | 22.2% | 77.8% |
| Oaklawn Park | 261 | 11.1% | 100.0% |
| Mahoning Valley | 232 | 12.5% | 87.5% |
| Parx Racing | 232 | 50.0% | 87.5% |
| Turf Paradise | 232 | 25.0% | 87.5% |
| Fair Grounds | 209 | 13.9% | 85.6% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 22.8% | 79.0% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
