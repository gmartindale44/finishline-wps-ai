// Test Harville formulas
const p = [0.3495881969752934, 0.37476223762145866, 0.19163882479553995, 0.08401074060770787];
const n = p.length;
const eps = 1e-9;

// Apply Stern adjustment (same as lib/harville.js)
let probs = p.map(x => Math.max(eps, Math.min(1 - eps, x || 0)));
probs = probs.map(x => Math.pow(x, 0.95));
const total = probs.reduce((a, b) => a + b, 0);
if (total > eps) {
  probs = probs.map(x => x / total);
}

console.log('Normalized probs:', probs);

// Test horse 0
const i = 0;
const p_i = probs[i];

// Place calculation
let p_place = 0;
for (let j = 0; j < n; j++) {
  if (j !== i) {
    const denom = 1.0 - p_i;
    if (denom > eps) {
      p_place += (p_i * probs[j]) / denom;
    }
  }
}

// Show calculation (FIXED: account for i finishing 1st, 2nd, or 3rd)
let p_show = 0;
// P(i finishes 1st) = p_i
p_show += p_i;
// P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
for (let j = 0; j < n; j++) {
  if (j === i) continue;
  const denom = 1.0 - probs[j];
  if (denom > eps) {
    p_show += (probs[j] * p_i) / denom;
  }
}
// P(i finishes 3rd) = Σ_{j≠i,k≠i,k≠j} [p_j * p_k * p_i / ((1-p_j)(1-p_j-p_k))]
for (let j = 0; j < n; j++) {
  if (j === i) continue;
  for (let k = 0; k < n; k++) {
    if (k === i || k === j) continue;
    const denom1 = 1.0 - probs[j];
    const denom2 = 1.0 - probs[j] - probs[k];
    if (denom1 > eps && denom2 > eps) {
      p_show += (probs[j] * probs[k] * p_i) / (denom1 * denom2);
    }
  }
}

console.log('Place[0]:', p_place);
console.log('Show[0]:', p_show);
console.log('Difference:', Math.abs(p_place - p_show));

