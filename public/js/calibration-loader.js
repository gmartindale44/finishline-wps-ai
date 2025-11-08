(function () {
  const DEFAULT_CALIBRATION = {
    version: 'fallback',
    stake_curve: {
      '50': 1,
      '60': 1,
      '70': 1,
      '80': 2,
      '90': 2,
    },
    exotics_rules: {
      exacta_min_top3: 55,
      trifecta_min_top3: 65,
      min_conf_for_win_only: 80,
    },
    distance_mods: {},
  };

  const CALIBRATION_URLS = ['/public/data/calibration_v1.json', '/data/calibration_v1.json'];

  const state = {
    calibration: null,
    loaded: false,
    source: null,
  };

  function normalizePercent(value) {
    if (value == null) return NaN;
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    return num <= 1 ? num * 100 : num;
  }

  function normalizeStakeConfidence(conf) {
    if (conf == null) return NaN;
    const num = Number(conf);
    if (!Number.isFinite(num)) return NaN;
    return num <= 1 ? num * 100 : num;
  }

  function getCalibration() {
    return state.calibration || DEFAULT_CALIBRATION;
  }

  function getStakeForConfidence(confidence) {
    const cal = getCalibration();
    const stakeCurve = cal.stake_curve || {};
    const pct = normalizeStakeConfidence(confidence);
    if (!Number.isFinite(pct)) return 1;
    const thresholds = Object.keys(stakeCurve)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let stake = 1;
    for (const threshold of thresholds) {
      if (pct >= threshold) {
        stake = stakeCurve[String(threshold)] || stake;
      }
    }
    return stake;
  }

  function applyDistancePenalty(top3, context, cal) {
    const mods = cal.distance_mods || {};
    const guard = mods['≤250y_maiden'];
    if (!guard) return top3;
    const distance = Number(context.distance);
    const klass = String(context.class || context.klass || '').toLowerCase();
    if (Number.isFinite(distance) && distance <= 250 && klass.includes('maiden')) {
      const penalty = Number(guard.exotics_penalty || 0);
      if (Number.isFinite(penalty)) {
        return Math.max(0, top3 - penalty * 100);
      }
    }
    return top3;
  }

  function shouldOfferExotics(context = {}) {
    const cal = getCalibration();
    const rules = cal.exotics_rules || {};

    const confidence = normalizePercent(context.confidence);
    const top3Mass = normalizePercent(context.top3Mass ?? context.top3_mass);
    const gap12 = normalizePercent(context.gap12 ?? context.gap1to2);
    const gap23 = normalizePercent(context.gap23 ?? context.gap2to3);

    let adjustedTop3 = top3Mass;
    if (Number.isFinite(top3Mass)) {
      adjustedTop3 = applyDistancePenalty(top3Mass, context, cal);
    }

    const rationale = [];

    const allowWinOnly = Number.isFinite(confidence) && confidence >= (rules.min_conf_for_win_only ?? 80);
    if (allowWinOnly) {
      rationale.push(`Confidence ${confidence.toFixed(0)}% clears Win-only gate`);
    }

    let allowExacta = false;
    let allowTrifecta = false;

    if (Number.isFinite(adjustedTop3)) {
      const exactaGate = rules.exacta_min_top3 ?? 55;
      if (adjustedTop3 >= exactaGate) {
        allowExacta = true;
        rationale.push(`Top-3 mass ${adjustedTop3.toFixed(0)}% ≥ ${exactaGate}%`);
      }

      const trifectaGate = rules.trifecta_min_top3 ?? 65;
      if (adjustedTop3 >= trifectaGate && Number.isFinite(gap12) && Number.isFinite(gap23)) {
        const gapsStrong = gap12 >= 40 && gap23 >= 35;
        if (gapsStrong) {
          allowTrifecta = true;
          rationale.push('Gap strength supports trifecta coverage');
        }
      }
    }

    if (!allowExacta) {
      rationale.push('Exacta gated off (mass below threshold or penalties applied)');
    }
    if (!allowTrifecta) {
      rationale.push('Trifecta gated off (needs higher mass & gap support)');
    }

    const stakeReco = getStakeForConfidence(confidence);

    return {
      stake_reco: stakeReco,
      allow_win_only: allowWinOnly,
      allow_exacta: allowExacta,
      allow_trifecta: allowTrifecta,
      rationale,
    };
  }

  async function loadCalibrationFromSources(urls = CALIBRATION_URLS) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const calibration = await res.json();
        return { calibration, source: url };
      } catch (err) {
        console.warn('[calibration] fetch failed', url, err);
      }
    }
    return { calibration: DEFAULT_CALIBRATION, source: 'default' };
  }

  async function loadCalibrationOnce() {
    try {
      const { calibration, source } = await loadCalibrationFromSources();
      state.calibration = calibration || DEFAULT_CALIBRATION;
      state.source = source;
      console.info('[FinishLineCalibration] calibration loaded from', source);
    } catch (err) {
      console.info('[FinishLineCalibration] failed to load calibration – defaults in use', err?.message || err);
      state.calibration = DEFAULT_CALIBRATION;
      state.source = 'default';
    } finally {
      state.loaded = true;
    }
  }

  loadCalibrationOnce();

  window.FinishLineCalibration = {
    ready() {
      return state.loaded && !!state.calibration;
    },
    getCalibration,
    getStakeForConfidence,
    shouldOfferExotics,
    getSource() {
      return state.source;
    },
    async loadCalibration() {
      const result = await loadCalibrationFromSources();
      state.calibration = result.calibration || DEFAULT_CALIBRATION;
      state.source = result.source;
      state.loaded = true;
      return result;
    },
  };
})();
