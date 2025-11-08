export const STRATEGY_THRESHOLDS = {
  GREEN: {
    confidence: 82,
    top3Mass: 40,
    gap: 1.8,
  },
  YELLOW: {
    minConfidence: 68,
    minTop3Mass: 33,
  },
};

export function evaluateStrategySignal({ confidence, top3Mass, gap1, gap2 } = {}) {
  const thresholds = STRATEGY_THRESHOLDS || {};
  const green = thresholds.GREEN || { confidence: 82, top3Mass: 40, gap: 1.8 };
  const yellow = thresholds.YELLOW || { minConfidence: 68, minTop3Mass: 33 };

  const conf = normalizePct(confidence);
  const mass = normalizePct(top3Mass);
  const g1 = normalizePct(gap1);
  const g2 = normalizePct(gap2);
  const maxGap = Math.max(Number.isFinite(g1) ? g1 : 0, Number.isFinite(g2) ? g2 : 0);

  if (!Number.isFinite(conf) || !Number.isFinite(mass)) {
    return cautionSignal();
  }

  if (
    conf >= green.confidence &&
    mass >= green.top3Mass &&
    maxGap >= green.gap
  ) {
    return {
      color: 'green',
      label: 'Go',
      action: '✅ Go — Win-Only or ATB (bankroll-scaled)',
      message: '✅ Go — Win-Only or ATB (bankroll-scaled)',
    };
  }

  if (
    conf >= yellow.minConfidence ||
    mass >= yellow.minTop3Mass
  ) {
    const caution = cautionSignal();
    return caution;
  }

  return {
    color: 'red',
    label: 'Avoid',
    action: '⛔ Avoid — Low edge',
    message: '⛔ Avoid — Low edge',
  };
}

function cautionSignal() {
  return {
    color: 'yellow',
    label: 'Caution',
    action: '⚠️ Caution — Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%',
    message: '⚠️ Caution — Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%',
  };
}

function normalizePct(value) {
  if (value == null || value === '') return NaN;
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  if (num <= 1 && num >= 0) return num * 100;
  return num;
}

if (typeof window !== 'undefined') {
  window.FLStrategyLogic = {
    STRATEGY_THRESHOLDS,
    evaluateStrategySignal,
  };
}

