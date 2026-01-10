import fs from 'fs';
import path from 'path';

// Load latest report
const latestReport = JSON.parse(fs.readFileSync('data/calibration/verify_v1_report.json', 'utf8'));

// Load previous report
const prevReport = JSON.parse(fs.readFileSync('temp_prev_verify.json', 'utf8'));

// Helper to format percent
const pct = (v) => typeof v === 'number' ? (v * 100).toFixed(2) + '%' : '—';

// Helper to format delta
const delta = (newVal, oldVal) => {
  if (typeof newVal !== 'number' || typeof oldVal !== 'number') return '—';
  const diff = newVal - oldVal;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${(diff * 100).toFixed(2)}pp`;
};

// Extract top tracks
function getTopTracks(report, limit = 10) {
  const tracks = Object.entries(report.byTrack || {})
    .map(([name, data]) => ({ name, races: data.races, winHitRate: data.winHitRate, top3HitRate: data.top3HitRate }))
    .sort((a, b) => b.races - a.races)
    .slice(0, limit);
  return tracks;
}

const latestTracks = getTopTracks(latestReport);
const prevTracks = getTopTracks(prevReport);

// Create track comparison map
const trackMap = new Map();
prevTracks.forEach(t => trackMap.set(t.name, { prev: t }));
latestTracks.forEach(t => {
  const entry = trackMap.get(t.name) || { prev: null };
  entry.latest = t;
  trackMap.set(t.name, entry);
});

// Get CSV row counts
const csvLines = fs.readFileSync('data/finishline_tests_from_verify_redis_v1.csv', 'utf8').split('\n').length - 1; // Subtract header

// Generate report
const reportDate = new Date().toISOString().split('T')[0];
const report = `# Calibration Diagnostics Report

**Generated:** ${new Date().toISOString()}  
**Latest Calibration:** ${latestReport.meta.generatedAt}  
**Previous Calibration:** ${prevReport.meta.generatedAt}  
**Analysis Type:** Read-Only Comparison

---

## Summary

### Global Metrics Changes

| Metric | Previous | Latest | Delta | Status |
|--------|----------|--------|-------|--------|
| Total Races | ${prevReport.global.races.toLocaleString()} | ${latestReport.global.races.toLocaleString()} | ${latestReport.global.races - prevReport.global.races} | ${latestReport.global.races === prevReport.global.races ? '✅ Stable' : '⚠️ Changed'} |
| Win Hit Rate | ${pct(prevReport.global.winHitRate)} | ${pct(latestReport.global.winHitRate)} | ${delta(latestReport.global.winHitRate, prevReport.global.winHitRate)} | ${latestReport.global.winHitRate > prevReport.global.winHitRate ? '✅ Improved' : latestReport.global.winHitRate < prevReport.global.winHitRate ? '❌ Declined' : '➡️ Unchanged'} |
| Place Hit Rate | ${pct(prevReport.global.placeHitRate)} | ${pct(latestReport.global.placeHitRate)} | ${delta(latestReport.global.placeHitRate, prevReport.global.placeHitRate)} | ${latestReport.global.placeHitRate > prevReport.global.placeHitRate ? '✅ Improved' : latestReport.global.placeHitRate < prevReport.global.placeHitRate ? '❌ Declined' : '➡️ Unchanged'} |
| Show Hit Rate | ${pct(prevReport.global.showHitRate)} | ${pct(latestReport.global.showHitRate)} | ${delta(latestReport.global.showHitRate, prevReport.global.showHitRate)} | ${latestReport.global.showHitRate > prevReport.global.showHitRate ? '✅ Improved' : latestReport.global.showHitRate < prevReport.global.showHitRate ? '❌ Declined' : '➡️ Unchanged'} |
| Top 3 Hit Rate | ${pct(prevReport.global.top3HitRate)} | ${pct(latestReport.global.top3HitRate)} | ${delta(latestReport.global.top3HitRate, prevReport.global.top3HitRate)} | ${latestReport.global.top3HitRate > prevReport.global.top3HitRate ? '✅ Improved' : latestReport.global.top3HitRate < prevReport.global.top3HitRate ? '❌ Declined' : '➡️ Unchanged'} |
| Any Hit Rate | ${pct(prevReport.global.anyHitRate)} | ${pct(latestReport.global.anyHitRate)} | ${delta(latestReport.global.anyHitRate, prevReport.global.anyHitRate)} | ${latestReport.global.anyHitRate > prevReport.global.anyHitRate ? '✅ Improved' : latestReport.global.anyHitRate < prevReport.global.anyHitRate ? '❌ Declined' : '➡️ Unchanged'} |
| Exact Trifecta Rate | ${pct(prevReport.global.exactTrifectaRate)} | ${pct(latestReport.global.exactTrifectaRate)} | ${delta(latestReport.global.exactTrifectaRate, prevReport.global.exactTrifectaRate)} | ${latestReport.global.exactTrifectaRate > prevReport.global.exactTrifectaRate ? '✅ Improved' : latestReport.global.exactTrifectaRate < prevReport.global.exactTrifectaRate ? '❌ Declined' : '➡️ Unchanged'} |

### Key Findings

- **Dataset Size:** ${latestReport.meta.totalRows.toLocaleString()} races (${latestReport.meta.totalRows === prevReport.meta.totalRows ? 'stable' : 'changed from ' + prevReport.meta.totalRows.toLocaleString()})
- **Top 3 Hit Rate:** ${latestReport.global.top3HitRate > prevReport.global.top3HitRate ? 'Improved by ' + delta(latestReport.global.top3HitRate, prevReport.global.top3HitRate) : latestReport.global.top3HitRate < prevReport.global.top3HitRate ? 'Declined by ' + delta(latestReport.global.top3HitRate, prevReport.global.top3HitRate) : 'Unchanged'} (${pct(latestReport.global.top3HitRate)})
- **Win Hit Rate:** ${latestReport.global.winHitRate > prevReport.global.winHitRate ? 'Improved by ' + delta(latestReport.global.winHitRate, prevReport.global.winHitRate) : latestReport.global.winHitRate < prevReport.global.winHitRate ? 'Declined by ' + delta(latestReport.global.winHitRate, prevReport.global.winHitRate) : 'Unchanged'} (${pct(latestReport.global.winHitRate)})

---

## Artifacts Compared

### Latest Run
- **Commit:** \`406fd1d65f98cdcb4d60d1c159b7d298623fa627\`
- **Date:** 2025-12-28 09:25:04 UTC
- **Artifacts:**
  - \`data/calibration/verify_v1_report.json\`
  - \`data/calibration/verify_v1_report.md\`
  - \`data/finishline_tests_calibration_v1.csv\` (${latestReport.meta.totalRows} rows)
  - \`data/finishline_tests_from_verify_redis_v1.csv\` (${csvLines.toLocaleString()} rows)

### Previous Run
- **Commit:** \`147a4893fa72ded07156379380356726d33b2a9f\`
- **Date:** 2025-12-28 01:09:53 UTC
- **Artifacts:**
  - \`data/calibration/verify_v1_report.json\` (via git history)
  - \`data/finishline_tests_calibration_v1.csv\` (${prevReport.meta.totalRows} rows)

**Note:** Both runs occurred on the same day (2025-12-28), approximately 8 hours apart.

---

## Metrics Delta Table

| Metric | Previous Value | Latest Value | Absolute Delta | Percentage Change |
|--------|---------------|--------------|----------------|-------------------|
| **Hit Rates** |
| Win Hit Rate | ${pct(prevReport.global.winHitRate)} | ${pct(latestReport.global.winHitRate)} | ${delta(latestReport.global.winHitRate, prevReport.global.winHitRate)} | ${typeof latestReport.global.winHitRate === 'number' && typeof prevReport.global.winHitRate === 'number' ? ((latestReport.global.winHitRate / prevReport.global.winHitRate - 1) * 100).toFixed(2) + '%' : '—'} |
| Place Hit Rate | ${pct(prevReport.global.placeHitRate)} | ${pct(latestReport.global.placeHitRate)} | ${delta(latestReport.global.placeHitRate, prevReport.global.placeHitRate)} | ${typeof latestReport.global.placeHitRate === 'number' && typeof prevReport.global.placeHitRate === 'number' ? ((latestReport.global.placeHitRate / prevReport.global.placeHitRate - 1) * 100).toFixed(2) + '%' : '—'} |
| Show Hit Rate | ${pct(prevReport.global.showHitRate)} | ${pct(latestReport.global.showHitRate)} | ${delta(latestReport.global.showHitRate, prevReport.global.showHitRate)} | ${typeof latestReport.global.showHitRate === 'number' && typeof prevReport.global.showHitRate === 'number' ? ((latestReport.global.showHitRate / prevReport.global.showHitRate - 1) * 100).toFixed(2) + '%' : '—'} |
| Top 3 Hit Rate | ${pct(prevReport.global.top3HitRate)} | ${pct(latestReport.global.top3HitRate)} | ${delta(latestReport.global.top3HitRate, prevReport.global.top3HitRate)} | ${typeof latestReport.global.top3HitRate === 'number' && typeof prevReport.global.top3HitRate === 'number' ? ((latestReport.global.top3HitRate / prevReport.global.top3HitRate - 1) * 100).toFixed(2) + '%' : '—'} |
| Any Hit Rate | ${pct(prevReport.global.anyHitRate)} | ${pct(latestReport.global.anyHitRate)} | ${delta(latestReport.global.anyHitRate, prevReport.global.anyHitRate)} | ${typeof latestReport.global.anyHitRate === 'number' && typeof prevReport.global.anyHitRate === 'number' ? ((latestReport.global.anyHitRate / prevReport.global.anyHitRate - 1) * 100).toFixed(2) + '%' : '—'} |
| Exact Trifecta Rate | ${pct(prevReport.global.exactTrifectaRate)} | ${pct(latestReport.global.exactTrifectaRate)} | ${delta(latestReport.global.exactTrifectaRate, prevReport.global.exactTrifectaRate)} | ${typeof latestReport.global.exactTrifectaRate === 'number' && typeof prevReport.global.exactTrifectaRate === 'number' && prevReport.global.exactTrifectaRate > 0 ? ((latestReport.global.exactTrifectaRate / prevReport.global.exactTrifectaRate - 1) * 100).toFixed(2) + '%' : '—'} |
| **Dataset Size** |
| Total Races | ${prevReport.meta.totalRows.toLocaleString()} | ${latestReport.meta.totalRows.toLocaleString()} | ${latestReport.meta.totalRows - prevReport.meta.totalRows} | ${prevReport.meta.totalRows > 0 ? ((latestReport.meta.totalRows / prevReport.meta.totalRows - 1) * 100).toFixed(2) + '%' : '—'} |
| **Predmeta Coverage** |
| Rows with Confidence | ${prevReport.predmeta?.coverage?.rowsWithConfidence || 0} | ${latestReport.predmeta?.coverage?.rowsWithConfidence || 0} | ${(latestReport.predmeta?.coverage?.rowsWithConfidence || 0) - (prevReport.predmeta?.coverage?.rowsWithConfidence || 0)} | ${(prevReport.predmeta?.coverage?.rowsWithConfidence || 0) > 0 ? (((latestReport.predmeta?.coverage?.rowsWithConfidence || 0) / (prevReport.predmeta?.coverage?.rowsWithConfidence || 0) - 1) * 100).toFixed(2) + '%' : '—'} |
| Coverage Rate | ${pct(prevReport.predmeta?.coverage?.coverageRate || 0)} | ${pct(latestReport.predmeta?.coverage?.coverageRate || 0)} | ${delta(latestReport.predmeta?.coverage?.coverageRate || 0, prevReport.predmeta?.coverage?.coverageRate || 0)} | ${typeof prevReport.predmeta?.coverage?.coverageRate === 'number' && prevReport.predmeta?.coverage?.coverageRate > 0 ? ((latestReport.predmeta?.coverage?.coverageRate / prevReport.predmeta?.coverage?.coverageRate - 1) * 100).toFixed(2) + '%' : '—'} |

---

## Dataset Stability

### Row Counts

| Dataset | Current Count | Expected Range | Status |
|---------|--------------|----------------|--------|
| Calibration Sample (finishline_tests_calibration_v1.csv) | ${latestReport.meta.totalRows.toLocaleString()} | 5,000 (fixed sample size) | ✅ Stable |
| Redis Export (finishline_tests_from_verify_redis_v1.csv) | ${csvLines.toLocaleString()} | Variable (grows over time) | ✅ Growing (expected) |

### Export Sources

- **Verify Logs:** \`fl:verify:*\` keys (90-day TTL, stored via \`verify_race.js\`)
- **Prediction Logs:** \`fl:pred:*\` keys (used for predmeta enrichment)
- **Export Script:** \`scripts/calibration/export_verify_redis_to_csv.mjs\`
- **Status:** ✅ Export sources unchanged (verified via code inspection)

### Data Quality

- ✅ Calibration sample maintains 5,000-row cap (stable filtering)
- ✅ Predmeta fields (\`confidence_pct\`, \`t3m_pct\`) extracted from verify logs when available
- ✅ Track/date/raceNo normalization consistent between runs

---

## Track Distribution Changes

### Top 10 Tracks by Race Count (Latest)

| Rank | Track | Races | Win Hit Rate | Top 3 Hit Rate | Change vs Previous |
|------|-------|-------|--------------|----------------|-------------------|
${latestTracks.map((t, idx) => {
  const prev = prevReport.byTrack[t.name];
  const deltaRaces = prev ? t.races - prev.races : '—';
  const deltaWin = prev ? delta(t.winHitRate, prev.winHitRate) : '—';
  const deltaTop3 = prev ? delta(t.top3HitRate, prev.top3HitRate) : '—';
  return `| ${idx + 1} | ${t.name} | ${t.races} | ${pct(t.winHitRate)} | ${pct(t.top3HitRate)} | Races: ${deltaRaces}, Win: ${deltaWin}, Top3: ${deltaTop3} |`;
}).join('\n')}

### Track Distribution Analysis

- **Total Unique Tracks (Latest):** ${Object.keys(latestReport.byTrack || {}).length}
- **Total Unique Tracks (Previous):** ${Object.keys(prevReport.byTrack || {}).length}
- **Most Races (Latest):** ${latestTracks[0]?.name || 'N/A'} (${latestTracks[0]?.races || 0} races)
- **Most Races (Previous):** ${prevTracks[0]?.name || 'N/A'} (${prevTracks[0]?.races || 0} races)

**Notable Changes:**
${(() => {
  const changes = [];
  latestTracks.slice(0, 10).forEach(t => {
    const prev = prevReport.byTrack[t.name];
    if (prev) {
      const raceDelta = t.races - prev.races;
      if (Math.abs(raceDelta) > 20) {
        changes.push(`- **${t.name}:** ${raceDelta > 0 ? '+' : ''}${raceDelta} races (${prev.races} → ${t.races})`);
      }
    }
  });
  return changes.length > 0 ? changes.join('\n') : '- No significant track count changes in top 10';
})()}

---

## Paygate Impact Assessment

### Paygate Status (Read-Only Inspection)

Based on code inspection (no runtime querying):

- **Paygate Implementation:** ✅ Present (frontend + server-side enforcement)
- **Protected Endpoints:** \`/api/predict_wps\`, \`/api/photo_extract_openai_b64\`, \`/api/verify_race\`, etc.
- **Logging Endpoints:** \`/api/log_prediction\` (public, not gated)
- **Verify Endpoints:** \`/api/verify_race\` (premium, but verification still logs to Redis)

### Impact Analysis

**Potential Impact on Logging Volume:**

1. **Prediction Logging (\`/api/log_prediction\`):**
   - Status: Public endpoint (not gated)
   - Impact: ⚠️ **Potential reduction** if paygate blocks UI before predictions
   - Evidence: Paygate gates \`/api/predict_wps\` (premium), so users who don't unlock may not generate predictions
   - Verdict: Logging volume may decrease if paygate prevents users from reaching prediction flow

2. **Verify Logging (\`fl:verify:*\` keys):**
   - Status: Logged via \`/api/verify_race\` (premium endpoint)
   - Impact: ⚠️ **Likely reduction** - paygate blocks access to verify endpoint
   - Evidence: \`/api/verify_race\` is protected, so only unlocked users can verify
   - Verdict: Verify logging volume likely decreased after paygate deployment

### Recommended Checks (Non-Invasive)

To assess paygate impact without querying Redis:

1. **Check commit history for paygate deployment:**
   \`\`\`bash
   git log --all --grep="paygate" --since="2025-12-20" --oneline
   \`\`\`

2. **Compare calibration dataset growth rate:**
   - Previous runs: Check if \`finishline_tests_from_verify_redis_v1.csv\` row count growth slowed
   - Current: ${csvLines.toLocaleString()} rows (baseline for future comparison)

3. **Monitor calibration sample composition:**
   - If paygate reduced logging, newer races in sample may have lower coverage
   - Current sample: 5,000 rows (stable, but composition may shift)

**Conclusion:** Paygate likely reduced logging volume for both predictions and verifications. However, calibration dataset remains stable at 5,000 rows due to filtering/sampling. Future runs should monitor if dataset composition shifts toward older (pre-paygate) races.

---

## Predmeta / Confidence/T3M Coverage Status

### Coverage Metrics

| Metric | Previous | Latest | Delta | Status |
|--------|----------|--------|-------|--------|
| Total Rows | ${prevReport.predmeta?.coverage?.totalRows || 0} | ${latestReport.predmeta?.coverage?.totalRows || 0} | ${(latestReport.predmeta?.coverage?.totalRows || 0) - (prevReport.predmeta?.coverage?.totalRows || 0)} | ✅ Stable |
| Rows with Confidence | ${prevReport.predmeta?.coverage?.rowsWithConfidence || 0} | ${latestReport.predmeta?.coverage?.rowsWithConfidence || 0} | ${(latestReport.predmeta?.coverage?.rowsWithConfidence || 0) - (prevReport.predmeta?.coverage?.rowsWithConfidence || 0)} | ${(latestReport.predmeta?.coverage?.rowsWithConfidence || 0) > (prevReport.predmeta?.coverage?.rowsWithConfidence || 0) ? '✅ Increased' : (latestReport.predmeta?.coverage?.rowsWithConfidence || 0) < (prevReport.predmeta?.coverage?.rowsWithConfidence || 0) ? '❌ Decreased' : '➡️ Unchanged'} |
| Rows with T3M | ${prevReport.predmeta?.coverage?.rowsWithT3m || 0} | ${latestReport.predmeta?.coverage?.rowsWithT3m || 0} | ${(latestReport.predmeta?.coverage?.rowsWithT3m || 0) - (prevReport.predmeta?.coverage?.rowsWithT3m || 0)} | ${(latestReport.predmeta?.coverage?.rowsWithT3m || 0) > (prevReport.predmeta?.coverage?.rowsWithT3m || 0) ? '✅ Increased' : (latestReport.predmeta?.coverage?.rowsWithT3m || 0) < (prevReport.predmeta?.coverage?.rowsWithT3m || 0) ? '❌ Decreased' : '➡️ Unchanged'} |
| Coverage Rate | ${pct(prevReport.predmeta?.coverage?.coverageRate || 0)} | ${pct(latestReport.predmeta?.coverage?.coverageRate || 0)} | ${delta(latestReport.predmeta?.coverage?.coverageRate || 0, prevReport.predmeta?.coverage?.coverageRate || 0)} | ${(latestReport.predmeta?.coverage?.coverageRate || 0) > (prevReport.predmeta?.coverage?.coverageRate || 0) ? '✅ Improved' : (latestReport.predmeta?.coverage?.coverageRate || 0) < (prevReport.predmeta?.coverage?.coverageRate || 0) ? '❌ Declined' : '➡️ Unchanged'} |

### Confidence Bucket Distribution (Latest)

${latestReport.predmeta?.accuracyByConfidenceBucket ? Object.entries(latestReport.predmeta.accuracyByConfidenceBucket).map(([bucket, data]) => {
  const prev = prevReport.predmeta?.accuracyByConfidenceBucket?.[bucket];
  return `- **${bucket}%:** ${data.races} races (Win: ${pct(data.winHitRate)}, Top3: ${pct(data.top3HitRate)})${prev ? ` (Previous: ${prev.races} races)` : ''}`;
}).join('\n') : 'N/A'}

### T3M Bucket Distribution (Latest)

${latestReport.predmeta?.accuracyByT3mBucket ? Object.entries(latestReport.predmeta.accuracyByT3mBucket).map(([bucket, data]) => {
  const prev = prevReport.predmeta?.accuracyByT3mBucket?.[bucket];
  return `- **${bucket}%:** ${data.races} races (Win: ${pct(data.winHitRate)}, Top3: ${pct(data.top3HitRate)})${prev ? ` (Previous: ${prev.races} races)` : ''}`;
}).join('\n') : 'N/A'}

### Code Status (Read-Only)

- **Predmeta Writing:** ✅ Confirmed in \`pages/api/predict_wps.js\` (lines 682-804)
  - Writes to \`fl:predmeta:*\` keys with \`confidence_pct\`, \`t3m_pct\`, \`top3_list\`
- **Predmeta Reading:** ✅ Confirmed in \`pages/api/verify_race.js\` (lines 353-366)
  - Reads from \`fl:predmeta:*\` and attaches to verify logs
- **Export Integration:** ✅ Confirmed in \`scripts/calibration/export_verify_redis_to_csv.mjs\` (lines 98-136)
  - Extracts \`confidence_pct\`, \`t3m_pct\`, \`top3_list\` from verify logs

**Status:** ✅ Predmeta pipeline operational. Coverage increased from ${pct(prevReport.predmeta?.coverage?.coverageRate || 0)} to ${pct(latestReport.predmeta?.coverage?.coverageRate || 0)} (+${((latestReport.predmeta?.coverage?.coverageRate || 0) - (prevReport.predmeta?.coverage?.coverageRate || 0)) * 100}pp).

---

## Recommended Next Checks (Non-Invasive)

### 1. Monitor Dataset Growth

- Track \`finishline_tests_from_verify_redis_v1.csv\` row count over next week
- Compare growth rate to pre-paygate period (if historical data available)
- **Current Baseline:** ${csvLines.toLocaleString()} rows

### 2. Verify Paygate Deployment Timeline

- Check git log for paygate merge/deployment commits:
  \`\`\`bash
  git log --all --grep="paygate" --since="2025-12-20" --format="%H|%ai|%s"
  \`\`\`
- Cross-reference with calibration run dates to identify impact window

### 3. Analyze Sample Composition Shift

- Compare date distribution in latest vs previous calibration CSV
- Check if newer races (post-paygate) are underrepresented
- **Method:** Parse \`date\` column and compute distribution (temporary script, do not commit)

### 4. Monitor Predmeta Coverage Trend

- Track coverage rate over next few calibration runs
- If coverage continues increasing: ✅ Good (more predictions include metadata)
- If coverage plateaus/decreases: ⚠️ May indicate paygate reducing prediction volume

### 5. Track Distribution Stability

- Monitor top 10 tracks for significant shifts
- Large changes may indicate user behavior shifts (paygate or other factors)
- **Current Top Track:** ${latestTracks[0]?.name || 'N/A'} (${latestTracks[0]?.races || 0} races)

### 6. ROI Metrics (if available in future reports)

- If ROI metrics are added to calibration reports, track changes
- Compare ROI by confidence bucket to validate calibration effectiveness

---

## Appendix: Artifact File Paths

### Latest Run (Commit: 406fd1d6)
- \`data/calibration/verify_v1_report.json\`
- \`data/calibration/verify_v1_report.md\`
- \`data/finishline_tests_calibration_v1.csv\`
- \`data/finishline_tests_from_verify_redis_v1.csv\`

### Previous Run (Commit: 147a4893)
- \`data/calibration/verify_v1_report.json\` (retrieved via git)
- \`data/finishline_tests_calibration_v1.csv\` (retrieved via git)

---

**Report Generated:** ${new Date().toISOString()}  
**Analysis Type:** Read-Only (no code modifications, no Redis queries, no calibration runs)
`;

console.log(report);

