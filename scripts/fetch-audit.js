import fs from 'fs';

const URL = process.env.AUDIT_URL || 'https://<YOUR_DEPLOYMENT_HOST>/api/audit_dataset'; // replace host or set AUDIT_URL env
const OUT = 'data/dataset_audit_report.md';

const r = await fetch(URL);
if (!r.ok) {
  console.error(`[fetch-audit] HTTP ${r.status}`);
  process.exit(1);
}
const json = await r.json();
if (!json.ok) {
  console.error(`[fetch-audit] Error:`, json);
  process.exit(1);
}
fs.writeFileSync(OUT, json.markdown, 'utf8');
console.log(`[fetch-audit] Wrote ${OUT}`);
console.log(`[fetch-audit] Overall estimate: ${json.overall_estimate}`);
