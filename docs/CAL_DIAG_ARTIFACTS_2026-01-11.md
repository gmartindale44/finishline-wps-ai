# Calibration Artifacts Diagnostic Report

**Generated:** 2026-01-11
**Report Type:** Nightly Calibration Artifacts Comparison

## Summary

This report compares the two most recent nightly calibration runs to identify changes in performance metrics, hit rates, and data coverage.

**Key Findings:**
- **Latest Run:** 2026-01-11 10:14:36 +0000 UTC (commit `2fe1edad`)
- **Previous Run:** 2026-01-04 09:03:50 +0000 UTC (commit `4efa012f`)
- **Time Delta:** 7 days, 1 hours, 10 minutes

### Overall Changes

- **Total Races:** 5000 → 5000 (no change)
- **Win Hit Rate:** 24.38% → 24.82% (+0.44pp, +1.80%)
- **Place Hit Rate:** 13.72% → 15.12% (+1.40pp, +10.20%)
- **Show Hit Rate:** 12.24% → 13.66% (+1.42pp, +11.60%)
- **Top 3 Hit Rate:** 81.30% → 82.76% (+1.46pp, +1.80%)
- **Any Hit Rate:** 38.58% → 41.00% (+2.42pp, +6.27%)
- **Exact Trifecta Rate:** 0.92% → 1.44% (+0.52pp, +56.52%)
- **Predmeta Coverage:** 32.86% → 48.60% (+15.74pp, +47.90%)

**Highlights:**
- ✅ **Top 3 Hit Rate improved** by +1.46pp
- ✅ **Win Hit Rate improved** by +0.44pp
- ✅ **Predmeta coverage increased significantly** by +15.74pp (+47.90% relative increase)

---

## Artifacts Compared

### Latest Run

- **Commit:** `2fe1edad`
- **Author:** github-actions[bot]
- **Date:** 2026-01-11 10:14:36 +0000 UTC
- **Message:** ci: nightly calibration artifacts
- **Artifacts:**
  - `data/calibration/verify_v1_report.json` (generatedAt: 2026-01-11T10:14:36.324Z)
  - `data/calibration/verify_v1_report.md`
  - `data/finishline_tests_calibration_v1.csv` (5000 rows)
  - `data/finishline_tests_from_verify_redis_v1.csv`

### Previous Run

- **Commit:** `4efa012f`
- **Author:** github-actions[bot]
- **Date:** 2026-01-04 09:03:50 +0000 UTC
- **Message:** ci: nightly calibration artifacts
- **Artifacts:**
  - `data/calibration/verify_v1_report.json` (generatedAt: 2026-01-04T09:03:50.460Z)
  - `data/calibration/verify_v1_report.md`
  - `data/finishline_tests_calibration_v1.csv` (5000 rows)
  - `data/finishline_tests_from_verify_redis_v1.csv`

---

## Metrics Delta

### Global Metrics Comparison

| Metric | Previous Value | Latest Value | Absolute Delta | Percentage Change | Status |
|--------|---------------|--------------|----------------|-------------------|--------|
| **Total Races** | 5000 | 5000 | 0 | +0.00% | ➡️ Unchanged |
| **Win Hit Rate** | 24.38% | 24.82% | +0.44pp | +1.80% | ⬆️ Improved |
| **Place Hit Rate** | 13.72% | 15.12% | +1.40pp | +10.20% | ⬆️ Improved |
| **Show Hit Rate** | 12.24% | 13.66% | +1.42pp | +11.60% | ⬆️ Improved |
| **Top 3 Hit Rate** | 81.30% | 82.76% | +1.46pp | +1.80% | ⬆️ Improved |
| **Any Hit Rate** | 38.58% | 41.00% | +2.42pp | +6.27% | ⬆️ Improved |
| **Exact Trifecta Rate** | 0.92% | 1.44% | +0.52pp | +56.52% | ⬆️ Improved |
| **Partial Order Top 3 Rate** | 81.30% | 82.76% | +1.46pp | +1.80% | ⬆️ Improved |

*pp = percentage points*

### Predmeta Coverage Metrics

| Metric | Previous Value | Latest Value | Absolute Delta | Percentage Change | Status |
|--------|---------------|--------------|----------------|-------------------|--------|
| **Total Rows** | 5000 | 5000 | 0 | +0.00% | ➡️ Unchanged |
| **Rows with Confidence** | 1643 | 2430 | 787 | +47.90% | ⬆️ Increased |
| **Rows with T3M** | 1643 | 2430 | 787 | +47.90% | ⬆️ Increased |
| **Rows with Both** | 1643 | 2430 | 787 | +47.90% | ⬆️ Increased |
| **Coverage Rate** | 32.86% | 48.60% | +15.74pp | +47.90% | ⬆️ Increased |

### Accuracy by Confidence Bucket

| Confidence Bucket | Previous | Latest | Delta (Win) | Delta (Top 3) |
|-------------------|----------|--------|-------------|---------------|
| **50-60%** | N/A | 18 races, 100.00% win, 100.00% top3 | N/A | N/A |
| **60-70%** | 94 races, 25.53% win, 100.00% top3 | 72 races, 25.00% win, 100.00% top3 | -0.53pp | +0.00pp |
| **70-80%** | 143 races, 16.78% win, 100.00% top3 | 216 races, 16.67% win, 100.00% top3 | -0.12pp | +0.00pp |
| **80+%** | 1406 races, 25.04% win, 84.99% top3 | 2124 races, 25.42% win, 85.59% top3 | +0.39pp | +0.60pp |

### Accuracy by T3M Bucket

| T3M Bucket | Previous | Latest | Delta (Win) | Delta (Top 3) |
|------------|----------|--------|-------------|---------------|
| **30-40%** | 466 races, 30.26% win, 80.04% top3 | 594 races, 33.33% win, 78.79% top3 | +3.08pp | -1.26pp |
| **40-50%** | 634 races, 18.30% win, 85.02% top3 | 954 races, 18.87% win, 88.68% top3 | +0.57pp | +3.66pp |
| **50-60%** | 260 races, 45.77% win, 100.00% top3 | 540 races, 33.33% win, 90.00% top3 | -12.44pp | -10.00pp |
| **60+%** | 213 races, 11.27% win, 100.00% top3 | 288 races, 18.75% win, 100.00% top3 | +7.48pp | +0.00pp |

---

## Analysis Notes

1. **Predmeta Coverage:** The increase in predmeta coverage (+15.74pp) indicates improved data quality and availability.

2. **Overall Hit Rate Trends:** The improvement in Top 3 Hit Rate (+1.46pp) suggests the model's predictive performance has improved.

3. **Sample Stability:** The calibration sample size remained constant at 5000 races, indicating the sampling strategy is stable.

4. **ROI Metrics:** ROI metrics are not present in these calibration reports. These reports focus on hit rates rather than financial returns.

---

## Conclusion

The latest calibration run shows **overall positive trends** in key performance metrics:
- ✅ Improved Top 3 Hit Rate and Win Hit Rate
- ✅ Significant increase in predmeta coverage (+47.90% relative increase)

The increased predmeta coverage suggests better data availability, which should enable more refined calibration in future runs.
