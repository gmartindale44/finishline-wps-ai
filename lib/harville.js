// lib/harville.js
// ADDITIVE: Harville formulas for place/show probabilities from win probabilities

/**
 * Compute place and show probabilities using Harville formulas.
 * 
 * Harville formulas:
 * - P(place_i) = Σ_{j≠i} [p_i * p_j / (1 - p_i)]
 * - P(show_i) = Σ_{j≠i,k≠i,k≠j} [p_i * p_j * p_k / ((1-p_i)(1-p_i-p_j))]
 * 
 * Args:
 *   winProbs: Array of win probabilities (must sum to ~1.0)
 *   useStern: Apply Stern adjustment (default true)
 * 
 * Returns:
 *   { placeProbs: number[], showProbs: number[] }
 */
export function harvilleFromWinProbs(winProbs, useStern = true) {
  const eps = 1e-9;
  const n = winProbs.length;
  
  if (n < 2) {
    // Edge case: 1 or 0 horses
    if (n === 1) {
      return { placeProbs: [1.0], showProbs: [1.0], winProbs: [1.0] };
    }
    return { placeProbs: [], showProbs: [], winProbs: [] };
  }
  
  // Clamp win probs to [eps, 1-eps] for numerical stability
  let probs = winProbs.map(p => Math.max(eps, Math.min(1 - eps, p || 0)));
  
  // Store original normalized win probs (before Stern adjustment)
  const originalWinProbs = probs.slice();
  
  // Optional Stern adjustment (mild flattening) - only for place/show calculations
  if (useStern) {
    // Stern factor: p' = p^0.95 (gentle exponent)
    probs = probs.map(p => Math.pow(p, 0.95));
    // Renormalize
    const total = probs.reduce((a, b) => a + b, 0);
    if (total > eps) {
      probs = probs.map(p => p / total);
    }
  }
  
  // Compute place probabilities
  // Harville place formula: P(place_i) = P(i finishes 1st) + P(i finishes 2nd)
  // Where:
  // - P(i finishes 1st) = p_i
  // - P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
  const placeProbs = [];
  for (let i = 0; i < n; i++) {
    const p_i = probs[i];
    let p_place = 0.0;
    
    // P(i finishes 1st) = p_i
    p_place += p_i;
    
    // P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
    for (let j = 0; j < n; j++) {
      if (j !== i) {
        const denom = 1.0 - probs[j];
        if (denom > eps) {
          p_place += (probs[j] * p_i) / denom;
        }
      }
    }
    
    // Clamp to valid range
    placeProbs.push(Math.max(0.0, Math.min(1.0, p_place)));
  }
  
  // Compute show probabilities
  // Harville show formula: P(show_i) = P(i finishes 1st) + P(i finishes 2nd) + P(i finishes 3rd)
  // Where:
  // - P(i finishes 1st) = p_i
  // - P(i finishes 2nd) = Σ_{j≠i} [p_j * p_i / (1 - p_j)]
  // - P(i finishes 3rd) = Σ_{j≠i,k≠i,k≠j} [p_j * p_k * p_i / ((1-p_j)(1-p_j-p_k))]
  const showProbs = [];
  for (let i = 0; i < n; i++) {
    const p_i = probs[i];
    let p_show = 0.0;
    
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
    
    // Clamp to valid range
    showProbs.push(Math.max(0.0, Math.min(1.0, p_show)));
  }
  
  return { 
    winProbs: originalWinProbs,  // Return original normalized win probs (not Stern-adjusted)
    placeProbs, 
    showProbs 
  };
}

