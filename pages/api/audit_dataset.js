export default async function handler(req, res) {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // --- helpers ---
    const hasFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
    const readText = (p) => fs.readFileSync(p, 'utf8');
    const toLines = (s) => s.split(/\r?\n/);
    const trimQ = (s) => s?.replace(/^"+|"+$/g,'').trim();

    function parseCSV(text) {
      const lines = toLines(text).filter(l => l.trim().length);
      if (!lines.length) return { header: [], rows: [] };
      const header = lines[0].split(',').map(trimQ);
      const rows = lines.slice(1).map(l => {
        const cols = l.split(',').map(trimQ);
        const obj = {};
        header.forEach((h, i) => obj[h] = cols[i] ?? '');
        return obj;
      });
      return { header, rows };
    }

    function keyOfCSVRow(r) {
      return [r.Track, r.Race_No, r.Distance, r.AI_Picks, r.Strategy]
        .map(x => (x ?? '').toString().trim().toLowerCase())
        .join('|');
    }

    function classifyLive(notes) {
      const n = (notes ?? '').toLowerCase();
      return n.includes('live') || n.includes('bet') || n.includes('wager');
    }

    async function redisFetch(cmd, args = []) {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) return { ok:false, error:'Missing Upstash env vars' };
      const body = JSON.stringify({ command: [cmd, ...args] });
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body
      });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, data };
    }

    async function redisScan(prefix='fl:pred:') {
      const keysRes = await redisFetch('KEYS', [`${prefix}*`]);
      if (!keysRes.ok) return { items: [], missingEnv: true };
      const keys = keysRes.data?.result ?? [];
      const items = [];
      for (const k of keys) {
        const hres = await redisFetch('HGETALL', [k]);
        const kv = hres.data?.result ?? [];
        const obj = {};
        for (let i=0;i<kv.length;i+=2) obj[kv[i]] = kv[i+1];
        items.push({
          _key: k,
          track: obj.track || '',
          raceNo: obj.raceNo || obj.race_no || '',
          distance: obj.distance || '',
          picks: obj.picks || '',
          confidence: Number(obj.confidence || obj.conf_pct || 0),
          top3_mass: Number(obj.top3_mass || 0),
          strategy: obj.strategy || '',
          status: obj.status || 'pending',
          notes: obj.notes || '',
          result: obj.result || '',
          roi: obj.roi || obj.roi_percent || '',
          resolved_at: obj.resolved_at || ''
        });
      }
      return { items, missingEnv: false };
    }

    // --- load CSV from repo ---
    const CSV_FILE = 'data/finishline_tests_v1.csv';
    let csvRows = [];
    let csvHeader = [];
    if (hasFile(CSV_FILE)) {
      const parsed = parseCSV(readText(CSV_FILE));
      csvHeader = parsed.header;
      csvRows = parsed.rows.map(r => ({ ...r, _key: keyOfCSVRow(r), _live: classifyLive(r.Notes) }));
    }

    // dedup CSV
    const csvMap = new Map();
    for (const r of csvRows) if (!csvMap.has(r._key)) csvMap.set(r._key, r);
    const csvDedup = [...csvMap.values()];

    // --- fetch Redis logs on server (env present here) ---
    const { items: redisItems, missingEnv } = await redisScan('fl:pred:');
    const pending = redisItems.filter(x => x.status !== 'resolved');
    const resolved = redisItems.filter(x => x.status === 'resolved');

    // resolved not in CSV
    const notInCSV = resolved.filter(x => {
      const k = [
        (x.track||'').toLowerCase(),
        (x.raceNo||'').toLowerCase(),
        (x.distance||'').toLowerCase(),
        (x.picks||'').toLowerCase(),
        (x.strategy||'').toLowerCase()
      ].join('|');
      return !csvMap.has(k);
    });

    // build report
    const report = [];
    report.push(`# FinishLine WPS AI — Dataset Audit`);
    report.push(`Generated: ${new Date().toISOString()}`);
    report.push('');
    report.push('## CSV');
    report.push(`- File: ${CSV_FILE} ${csvHeader.length ? `(cols: ${csvHeader.length})` : ''}`);
    report.push(`- Rows: ${csvRows.length}  |  Dedup: **${csvDedup.length}**  |  Live-flagged (Notes): **${csvDedup.filter(r=>r._live).length}**`);
    report.push('');
    report.push('## Upstash Logs');
    if (missingEnv) {
      report.push('- Unable to read logs: **missing UPSTASH_REDIS_REST_URL/TOKEN on server**');
    } else {
      report.push(`- Total: **${redisItems.length}**  |  Resolved: **${resolved.length}**  |  Pending: **${pending.length}**`);
      report.push(`- Resolved not yet in CSV: **${notInCSV.length}**`);
      if (notInCSV.length) {
        report.push(`  - First 10:\n${notInCSV.slice(0,10).map(x=>`    - ${x.track} | ${x.raceNo} | ${x.picks} | ${x.strategy} | ${x.result} | ${x.roi}`).join('\n')}`);
      }
    }
    report.push('');
    const overall = csvDedup.length + (missingEnv ? 0 : notInCSV.length);
    report.push('## Estimated Overall Unique Tests');
    report.push(`- **${overall}**  (CSV dedup + resolved-not-in-CSV)`);
    report.push('');
    report.push('> Tip: add "live" or "bet" in Notes to flag live wagers for breakdowns.');

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      ok: true,
      csv: { rows: csvRows.length, dedup: csvDedup.length },
      redis: missingEnv ? { error: 'missing_env' } : {
        total: redisItems.length,
        resolved: resolved.length,
        pending: pending.length,
        resolved_not_in_csv: notInCSV.length
      },
      overall_estimate: overall,
      markdown: report.join('\n')
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e && e.stack || e) });
  }
}
