// public/js/components/calibration-tracker.js

export function mountCalibrationTracker(containerSelector = '#fl-strategy-header') {
  const host = document.querySelector(containerSelector);
  if (!host) return;

  let el = host.querySelector('.fl-calib');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fl-calib';
    host.appendChild(el);
  }

  el.innerHTML = `
    <div class="fl-calib-card">
      <div class="fl-calib-title">Calibration</div>
      <div class="fl-calib-rows">
        <div><span>Logged:</span><b id="fl-calib-logged">—</b></div>
        <div><span>Resolved:</span><b id="fl-calib-res">—</b></div>
        <div><span>Avg Conf:</span><b id="fl-calib-conf">—</b></div>
        <div><span>Top-3 Mass:</span><b id="fl-calib-top3">—</b></div>
        <div><span>Last Write:</span><b id="fl-calib-last">—</b></div>
        <div><span>Model:</span><b id="fl-calib-model">—</b></div>
      </div>
      <button class="fl-calib-refresh" type="button">Refresh</button>
    </div>
  `;

  const $ = id => el.querySelector(id);

  const fmtPct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);

  const relTime = ts => {
    if (!ts) return '—';
    const d = Date.now() - Number(ts);
    const min = Math.floor(d / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    return `${h}h ago`;
  };

  async function load() {
    try {
      const r = await fetch('/api/calibration/summary?limit=50', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'summary failed');

      if ($('#fl-calib-logged')) $('#fl-calib-logged').textContent = j.stats.count;
      if ($('#fl-calib-res')) $('#fl-calib-res').textContent = j.stats.resolved;
      if ($('#fl-calib-conf')) $('#fl-calib-conf').textContent = j.stats.avgConf != null ? fmtPct(j.stats.avgConf) : '—';
      if ($('#fl-calib-top3')) $('#fl-calib-top3').textContent = j.stats.avgTop3 != null ? fmtPct(j.stats.avgTop3) : '—';
      if ($('#fl-calib-last')) $('#fl-calib-last').textContent = relTime(j.kv.lastWriteTs);
      if ($('#fl-calib-model')) {
        $('#fl-calib-model').textContent = j.model.calibrated
          ? `Calibrated • ${relTime(j.model.mtime)}`
          : 'Learning…';
      }
    } catch (e) {
      if ($('#fl-calib-logged')) $('#fl-calib-logged').textContent = '—';
      if ($('#fl-calib-res')) $('#fl-calib-res').textContent = '—';
      if ($('#fl-calib-conf')) $('#fl-calib-conf').textContent = '—';
      if ($('#fl-calib-top3')) $('#fl-calib-top3').textContent = '—';
      if ($('#fl-calib-last')) $('#fl-calib-last').textContent = '—';
      if ($('#fl-calib-model')) $('#fl-calib-model').textContent = 'Unavailable';
    }
  }

  const refreshBtn = el.querySelector('.fl-calib-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', load);
  }

  load();
}

