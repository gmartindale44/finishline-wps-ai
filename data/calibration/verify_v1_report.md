# Verify V1 Calibration Report

**Generated:** 4/26/2026, 10:59:12 AM
**Source:** finishline_tests_calibration_v1.csv
**Total Rows:** 5,000
**Filtered Rows:** 5,000

## Global Metrics

| Metric | Value |
|--------|-------|
| Total Races | 5,000 |
| Win Hit Rate | 23.5% |
| Place Hit Rate | 14.3% |
| Show Hit Rate | 12.3% |
| Top 3 Hit Rate | 81.4% |
| Any Hit Rate | 37.8% |
| Exact Trifecta Rate | 1.0% |
| Partial Order Top 3 Rate | 81.4% |

## Predmeta Metrics

| Metric | Value |
|--------|-------|
| Predmeta Coverage | 29.9% |
| Rows with Confidence | 1,493 |
| Rows with T3M | 1,493 |
| Rows with Both | 1,493 |

### Accuracy by T3M Bucket

| T3M % | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| 30-40% | 387 | 25.1% | 74.9% |
| 40-50% | 588 | 12.4% | 91.7% |
| 50-60% | 247 | 50.2% | 100.0% |
| 60+% | 198 | 12.6% | 100.0% |

### Brier Score (Win Probability Calibration)

| Metric | Value |
|--------|-------|
| Brier Score (Raw) | 0.6168 |
| Brier Score (Calibrated) | 0.1628 |
| Improvement | +0.4540 |
| Rows with Probability | 1,493 |
| Total Rows | 5,000 |

*Lower is better (0 = perfect calibration, 1 = worst)*

### Confidence Bucket Calibration (Raw)

| Confidence | Races | Expected Win Rate | Observed Win Rate | Calibration Error |
|------------|-------|-------------------|-------------------|-------------------|
| 60-70% | 246 | 65.0% | 10.2% | -54.8% |
| 70-80% | 125 | 75.0% | 20.0% | -55.0% |
| 80+% | 1,122 | 85.0% | 24.0% | -61.0% |

### Confidence Recalibration

| Metric | Value |
|--------|-------|
| Sample Size | 1,493 |
| Minimum Required | 300 |
| Bucket Count | 2 |
| Status | ✅ Active |

*Recalibration mapping computed using isotonic regression (PAVA algorithm).*

## Top 10 Tracks (by Race Count)

| Track | Races | Win Hit Rate | Top 3 Hit Rate |
|-------|-------|--------------|----------------|
| Gulfstream Park | 525 | 23.8% | 90.5% |
| Aqueduct | 350 | 14.3% | 78.6% |
| Oaklawn Park | 336 | 21.4% | 92.9% |
| Delta Downs | 325 | 23.1% | 76.9% |
| Laurel Park | 325 | 23.1% | 92.3% |
| Turf Paradise | 312 | 23.1% | 92.3% |
| Fair Grounds | 300 | 25.0% | 91.7% |
| Mahoning Valley | 274 | 9.1% | 63.9% |
| Tampa Bay Downs | 264 | 18.2% | 81.8% |
| Parx Racing | 240 | 50.0% | 90.0% |

## Strategy Summary

| Strategy | Races | Win Hit Rate | Top 3 Hit Rate |
|----------|-------|--------------|----------------|
| default@v1 | 5,000 | 23.5% | 81.4% |

## Notes

This report is based on 5,000 races with predictions from Redis verify logs.
