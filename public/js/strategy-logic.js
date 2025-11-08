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

export function evaluateStrategySignal({ confidence, top3Mass, gap1, gap2 }) {
  const conf = normalizePct(confidence);
  const mass = normalizePct(top3Mass);
  const g1 = normalizePct(gap1);
  const g2 = normalizePct(gap2);
  const maxGap = Math.max(isFinite(g1) ? g1 : 0, isFinite(g2) ? g2 : 0);

  if (!isFinite(conf) || !isFinite(mass)) {
    return cautionSignal();
  }

  const meetsGreen =
    conf >= STRATEGY_THRESHOLDS.GREEN.confidence &&
    mass >= STRATEGY_THRESHOLDS.GREEN.top3Mass &&
    maxGap >= STRATEGY_THRESHOLDS.GREEN.gap;

  if (meetsGreen) {
    return {
      color: 'green',
      label: 'Go',
      action: '✅ Go — Win-Only or ATB (bankroll-scaled)',
    };
  }

  const meetsYellow =
    conf >= STRATEGY_THRESHOLDS.YELLOW.minConfidence ||
    mass >= STRATEGY_THRESHOLDS.YELLOW.minTop3Mass;

  if (meetsYellow) {
    return cautionSignal();
  }

  return {
    color: 'red',
    label: 'Avoid',
    action: '⛔ Avoid — Low edge',
  };
}

function cautionSignal() {
  return {
    color: 'yellow',
    label: 'Caution',
    action: '⚠️ Caution — Light ATB ($1–$3) or Win-Only if Confidence ≥ 80%',
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

