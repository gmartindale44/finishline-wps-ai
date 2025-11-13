import { toROI } from "./dataset.js";

const FEATURE_ORDER = ["confidence", "top3_mass", "gap_1_2", "gap_2_3"];

/**
 * @param {import("./dataset.js").FinishLineRow[]} rows
 */
export function buildSignalDataset(rows) {
  const X = [];
  const y = [];

  for (const row of rows) {
    const roi = toROI(row);
    if (!Number.isFinite(roi)) continue;

    const features = FEATURE_ORDER.map((key) => {
      const value = Number(row[key]) || 0;
      return Number.isFinite(value) ? value : 0;
    });

    if (features.every((val) => Number.isFinite(val))) {
      X.push(features);
      y.push(roi);
    }
  }

  return { X, y, featureOrder: FEATURE_ORDER.slice() };
}

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const aug = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    while (pivot < size && Math.abs(aug[pivot][col]) < 1e-9) {
      pivot += 1;
    }
    if (pivot === size) {
      return null;
    }
    if (pivot !== col) {
      const temp = aug[col];
      aug[col] = aug[pivot];
      aug[pivot] = temp;
    }
    const pivotVal = aug[col][col];
    for (let j = col; j <= size; j += 1) {
      aug[col][j] /= pivotVal;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= size; j += 1) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row[size]);
}

/**
 * @param {number[][]} X
 * @param {number[]} y
 */
export function fitLinearWeights(X, y) {
  if (!Array.isArray(X) || !X.length || !Array.isArray(X[0])) {
    throw new Error("Signal dataset empty – cannot fit weights");
  }

  const rows = X.length;
  const features = X[0].length;
  const xtx = Array.from({ length: features + 1 }, () =>
    Array(features + 1).fill(0)
  );
  const xty = Array(features + 1).fill(0);

  for (let i = 0; i < rows; i += 1) {
    const extended = [1, ...X[i]];
    for (let r = 0; r < extended.length; r += 1) {
      for (let c = 0; c < extended.length; c += 1) {
        xtx[r][c] += extended[r] * extended[c];
      }
      xty[r] += extended[r] * y[i];
    }
  }

  const solution = solveLinearSystem(xtx, xty);
  if (!solution) {
    return {
      intercept: 0,
      weights: [0.5, 0.3, 0.1, 0.1],
      fallback: true,
    };
  }

  const intercept = solution[0];
  const weights = solution.slice(1);

  const maxAbs = Math.max(1, ...weights.map((val) => Math.abs(val)));
  const normalizedWeights = weights.map((val) => Number((val / maxAbs).toFixed(4)));
  const normalizedIntercept = Number((intercept / maxAbs).toFixed(4));

  return {
    intercept: normalizedIntercept,
    weights: normalizedWeights,
    fallback: false,
  };
}

/**
 * @param {import("./dataset.js").FinishLineRow[]} rows
 */
export function computeSignalWeights(rows) {
  const candidates = rows.filter(
    (row) =>
      Number.isFinite(row.confidence) &&
      Number.isFinite(row.top3_mass) &&
      Number.isFinite(row.gap_1_2) &&
      Number.isFinite(row.gap_2_3) &&
      Number.isFinite(toROI(row))
  );

  if (candidates.length < 8) {
    return null;
  }

  const { X, y, featureOrder } = buildSignalDataset(candidates);
  if (!X.length || !y.length) return null;

  let fit;
  try {
    fit = fitLinearWeights(X, y);
  } catch (error) {
    console.warn("[signalModel] Failed to fit regression weights", error);
    return null;
  }

  return {
    version: "v1",
    generated_at: new Date().toISOString(),
    feature_order: featureOrder,
    intercept: fit.intercept,
    weights: fit.weights,
    fallback: Boolean(fit.fallback),
    sample_size: X.length,
  };
}


