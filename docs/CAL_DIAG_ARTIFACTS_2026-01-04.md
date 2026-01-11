# Calibration Artifacts Diagnostic Report

**Generated:** 2026-01-04  
**Report Type:** Nightly Calibration Artifacts Comparison

## Summary

This report compares the two most recent nightly calibration runs to identify changes in performance metrics, hit rates, and data coverage.

**Key Findings:**
- **Latest Run:** 2026-01-04 09:03:50 UTC (commit `4efa012f`)
- **Previous Run:** 2025-12-28 09:25:04 UTC (commit `406fd1d6`)
- **Time Delta:** 7 days, 23 hours, 38 minutes

### Overall Changes

- **Total Races:** 5,000 → 5,000 (no change)
- **Win Hit Rate:** 23.68% → 24.38% (+0.70pp, +2.96%)
- **Place Hit Rate:** 14.86% → 13.72% (-1.14pp, -7.67%)
- **Show Hit Rate:** 11.64% → 12.24% (+0.60pp, +5.15%)
- **Top 3 Hit Rate:** 80.02% → 81.30% (+1.28pp, +1.60%)
- **Any Hit Rate:** 37.50% → 38.58% (+1.08pp, +2.88%)
- **Exact Trifecta Rate:** 1.04% → 0.92% (-0.12pp, -11.54%)
- **Predmeta Coverage:** 24.82% → 32.86% (+8.04pp, +32.39%) ⬆️

**Highlights:**
- ✅ **Top 3 Hit Rate improved** by 1.28 percentage points
- ✅ **Win Hit Rate improved** by 0.70 percentage points
- ✅ **Predmeta coverage increased significantly** by 8.04 percentage points (32.39% relative increase)
- ⚠️ **Place Hit Rate declined** by 1.14 percentage points
- ⚠️ **Exact Trifecta Rate declined** by 0.12 percentage points

---

## Artifacts Compared

### Latest Run (2026-01-04)

- **Commit:** `4efa012f879b1b19f216f0409daa536d86f3d1b6`
- **Author:** github-actions[bot]
- **Date:** 2026-01-04 09:03:50 UTC
- **Message:** ci: nightly calibration artifacts
- **Artifacts:**
  - `data/calibration/verify_v1_report.json` (generatedAt: 2026-01-04T09:03:50.460Z)
  - `data/calibration/verify_v1_report.md`
  - `data/finishline_tests_calibration_v1.csv` (5,000 rows)
  - `data/finishline_tests_from_verify_redis_v1.csv`

### Previous Run (2025-12-28)

- **Commit:** `406fd1d65f98cdcb4d60d1c159b7d298623fa627`
- **Author:** github-actions[bot]
- **Date:** 2025-12-28 09:25:04 UTC
- **Message:** ci: nightly calibration artifacts
- **Artifacts:**
  - `data/calibration/verify_v1_report.json` (generatedAt: 2025-12-28T09:25:03.992Z)
  - `data/calibration/verify_v1_report.md`
  - `data/finishline_tests_calibration_v1.csv` (5,000 rows)
  - `data/finishline_tests_from_verify_redis_v1.csv`

---

## Metrics Delta

### Global Metrics Comparison

| Metric | Previous Value | Latest Value | Absolute Delta | Percentage Change | Status |
|--------|---------------|--------------|----------------|-------------------|--------|
| **Total Races** | 5,000 | 5,000 | 0 | 0.00% | ➡️ Unchanged |
| **Win Hit Rate** | 23.68% | 24.38% | +0.70pp | +2.96% | ⬆️ Improved |
| **Place Hit Rate** | 14.86% | 13.72% | -1.14pp | -7.67% | ⬇️ Declined |
| **Show Hit Rate** | 11.64% | 12.24% | +0.60pp | +5.15% | ⬆️ Improved |
| **Top 3 Hit Rate** | 80.02% | 81.30% | +1.28pp | +1.60% | ⬆️ Improved |
| **Any Hit Rate** | 37.50% | 38.58% | +1.08pp | +2.88% | ⬆️ Improved |
| **Exact Trifecta Rate** | 1.04% | 0.92% | -0.12pp | -11.54% | ⬇️ Declined |
| **Partial Order Top 3 Rate** | 80.02% | 81.30% | +1.28pp | +1.60% | ⬆️ Improved |

*pp = percentage points*

### Predmeta Coverage Metrics

| Metric | Previous Value | Latest Value | Absolute Delta | Percentage Change | Status |
|--------|---------------|--------------|----------------|-------------------|--------|
| **Total Rows** | 5,000 | 5,000 | 0 | 0.00% | ➡️ Unchanged |
| **Rows with Confidence** | 1,241 | 1,643 | +402 | +32.39% | ⬆️ Increased |
| **Rows with T3M** | 1,241 | 1,643 | +402 | +32.39% | ⬆️ Increased |
| **Rows with Both** | 1,241 | 1,643 | +402 | +32.39% | ⬆️ Increased |
| **Coverage Rate** | 24.82% | 32.86% | +8.04pp | +32.39% | ⬆️ Increased |

### Accuracy by Confidence Bucket

| Confidence Bucket | Previous | Latest | Delta (Win) | Delta (Top 3) |
|-------------------|----------|--------|-------------|---------------|
| **60-70%** | 26 races, 0.0% win, 100.0% top3 | 94 races, 25.5% win, 100.0% top3 | +25.5pp | 0.0pp |
| **70-80%** | 108 races, 25.0% win, 100.0% top3 | 143 races, 16.8% win, 100.0% top3 | -8.2pp | 0.0pp |
| **80+%** | 1,107 races, 21.5% win, 83.4% top3 | 1,406 races, 25.0% win, 85.0% top3 | +3.5pp | +1.6pp |

**Notes:**
- 60-70% bucket shows significant improvement in win rate (0% → 25.5%) with larger sample size
- 70-80% bucket shows decline in win rate (25.0% → 16.8%) but maintains 100% top3 rate
- 80+% bucket shows improvement in both win rate (+3.5pp) and top3 rate (+1.6pp) with larger sample

### Accuracy by T3M Bucket

| T3M Bucket | Previous | Latest | Delta (Win) | Delta (Top 3) |
|------------|----------|--------|-------------|---------------|
| **30-40%** | 392 races, 20.2% win, 73.2% top3 | 466 races, 30.3% win, 80.0% top3 | +10.1pp | +6.8pp |
| **40-50%** | 478 races, 11.1% win, 88.9% top3 | 634 races, 18.3% win, 85.0% top3 | +7.2pp | -3.9pp |
| **50-60%** | 212 races, 62.7% win, 100.0% top3 | 260 races, 45.8% win, 100.0% top3 | -16.9pp | 0.0pp |
| **60+%** | 107 races, 0.0% win, 100.0% top3 | 213 races, 11.3% win, 100.0% top3 | +11.3pp | 0.0pp |

**Notes:**
- 30-40% bucket shows strong improvement in both win rate (+10.1pp) and top3 rate (+6.8pp)
- 40-50% bucket shows improvement in win rate (+7.2pp) but slight decline in top3 rate (-3.9pp)
- 50-60% bucket shows decline in win rate (-16.9pp) but maintains 100% top3 rate
- 60+% bucket shows improvement in win rate (0% → 11.3%) with doubled sample size

### Track Count Changes (Top 10 by Latest Count)

| Track | Previous Races | Latest Races | Delta | Previous Win % | Latest Win % | Delta |
|-------|---------------|--------------|-------|----------------|--------------|-------|
| **Gulfstream Park** | 501 | 456 | -45 | 26.3% | 26.3% | 0.0pp |
| **Laurel Park** | 338 | 312 | -26 | 23.1% | 23.1% | 0.0pp |
| **Oaklawn Park** | 338 | 322 | -16 | 15.4% | 21.4% | +6.0pp |
| **Turf Paradise** | 338 | 299 | -39 | 23.1% | 23.1% | 0.0pp |
| **Delta Downs** | 324 | 336 | +12 | 25.0% | 21.4% | -3.6pp |
| **Aqueduct** | 270 | 336 | +66 | 10.0% | 14.3% | +4.3pp |
| **Fair Grounds** | 297 | 264 | -33 | 27.3% | 27.3% | 0.0pp |
| **Tampa Bay Downs** | 260 | 253 | -7 | 20.0% | 18.2% | -1.8pp |
| **Mahoning Valley** | 208 | 210 | +2 | 12.5% | 10.9% | -1.6pp |
| **Parx Racing** | 208 | 230 | +22 | 50.0% | 50.0% | 0.0pp |

**New Tracks in Latest Run:**
- HK Sha Tin (24 races, 0.0% win, 100.0% top3)
- Meadowlands (23 races, 100.0% win, 100.0% top3)
- NZ Trentham (23 races, 0.0% win, 100.0% top3)

### Race Number Distribution Changes

| Race No | Previous Races | Latest Races | Delta | Previous Win % | Latest Win % | Delta |
|---------|---------------|--------------|-------|----------------|--------------|-------|
| **1** | 1,103 | 1,171 | +68 | 16.6% | 17.8% | +1.2pp |
| **2** | 894 | 869 | -25 | 26.4% | 24.2% | -2.2pp |
| **3** | 656 | 657 | +1 | 16.0% | 18.0% | +2.0pp |
| **4** | 473 | 494 | +21 | 16.5% | 19.0% | +2.5pp |
| **5** | 501 | 493 | -8 | 26.1% | 23.7% | -2.4pp |
| **6** | 213 | 212 | -1 | 50.2% | 55.7% | +5.5pp |
| **7** | 183 | 164 | -19 | 14.2% | 14.6% | +0.4pp |
| **8** | 264 | 282 | +18 | 39.8% | 49.6% | +9.8pp |
| **9** | 396 | 351 | -45 | 33.3% | 33.3% | 0.0pp |
| **10** | 158 | 141 | -17 | 17.1% | 17.0% | -0.1pp |
| **11** | 133 | 142 | +9 | 40.6% | 33.8% | -6.8pp |

---

## Analysis Notes

1. **Predmeta Coverage Improvement:** The significant increase in predmeta coverage (24.82% → 32.86%) indicates improved data quality and availability of confidence/top3 mass metrics. This is a positive trend for model calibration.

2. **Overall Hit Rate Trends:** The improvement in Top 3 Hit Rate (+1.28pp) and Win Hit Rate (+0.70pp) suggests the model's predictive performance has improved over the week, though Place Hit Rate declined.

3. **Sample Stability:** The calibration sample size remained constant at 5,000 races, indicating the sampling strategy is stable.

4. **ROI Metrics:** ROI metrics are not present in these calibration reports. These reports focus on hit rates rather than financial returns.

5. **Track Composition Changes:** The distribution of races across tracks has shifted, with some tracks showing increases (Aqueduct +66, Delta Downs +12) and others showing decreases. This reflects natural variation in race scheduling and data collection.

---

## Conclusion

The latest calibration run (2026-01-04) shows **overall positive trends** in key performance metrics:
- ✅ Improved Top 3 Hit Rate and Win Hit Rate
- ✅ Significant increase in predmeta coverage (32% relative increase)
- ⚠️ Place Hit Rate declined, warranting further investigation
- ⚠️ Exact Trifecta Rate declined slightly

The increased predmeta coverage suggests better data availability, which should enable more refined calibration in future runs.

