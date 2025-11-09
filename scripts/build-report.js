import fs from 'node:fs';
import path from 'node:path';

const INPUT_PATH = path.join(process.cwd(), 'data', 'calibration_v1.json');
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'calibration_report_v1.md');

function loadCalibration() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error('Calibration JSON missing – run calibrate first.');
  }
  return JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return (num * 100).toFixed(1) + '%';
}

function buildTable(binMetrics) {
  const header = ['| Bin | Samples | Win Rate | Top-3 Rate | Avg ROI (ATB) | Exotic Hit Rate |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  const rows = binMetrics.map(bin => {
    const avgRoi = bin.avg_roi_atb2 == null ? '—' : `${bin.avg_roi_atb2.toFixed(1)}%`;
    const exotic = bin.exotic_hit_rate == null ? '—' : formatPercent(bin.exotic_hit_rate);
    return `| ${bin.bin} | ${bin.count} | ${formatPercent(bin.win_rate)} | ${formatPercent(bin.top3_rate)} | ${avgRoi} | ${exotic} |`;
  });
  return header.concat(rows).join('\n');
}

function buildStakeList(stakeCurve) {
  const entries = Object.entries(stakeCurve)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([bucket, stake]) => `- Confidence ≥ ${bucket}% → Stake x${stake}`);
  return entries.join('\n');
}

function buildRules(rules) {
  const lines = [];
  if (rules?.exacta_min_top3 != null) {
    lines.push(`- Offer Exacta Box when Top-3 Mass ≥ ${rules.exacta_min_top3}%`);
  }
  if (rules?.trifecta_min_top3 != null) {
    lines.push(`- Offer Trifecta Box when Top-3 Mass ≥ ${rules.trifecta_min_top3}% and gaps confirm`);
  }
  if (rules?.min_conf_for_win_only != null) {
    lines.push(`- Allow Win-Only when confidence ≥ ${rules.min_conf_for_win_only}%`);
  }
  return lines.join('\n');
}

function buildDistanceMods(distanceMods) {
  if (!distanceMods) return '';
  return Object.entries(distanceMods).map(([key, val]) => {
    const penalty = val.exotics_penalty != null ? ` (exotics penalty ${val.exotics_penalty * 100}%)` : '';
    return `- ${key}${penalty}`;
  }).join('\n');
}

function main() {
  try {
    const data = loadCalibration();
    const lines = [];
    lines.push('# FinishLine Calibration Report');
    lines.push('');
    lines.push(`- Version: ${data.version}`);
    lines.push(`- Generated: ${data.generated_at}`);
    lines.push('');
    lines.push('## Bin Metrics');
    lines.push(buildTable(data.bin_metrics || []));
    lines.push('');
    lines.push('## Stake Curve');
    lines.push(buildStakeList(data.stake_curve || {}));
    lines.push('');
    lines.push('## Exotics Rules');
    lines.push(buildRules(data.exotics_rules || {}));
    lines.push('');
    if (data.distance_mods) {
      lines.push('## Distance Mods');
      lines.push(buildDistanceMods(data.distance_mods));
      lines.push('');
    }

    fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');
    console.log(`[calibrate:report] Wrote report to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('[calibrate:report] Fatal:', err?.message || err);
    process.exit(1);
  }
}

main();
