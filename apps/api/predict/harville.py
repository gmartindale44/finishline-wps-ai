"""
Harville and Stern formulas for place and show probabilities.
Based solely on win probabilities (ticket-only safe).
"""
from typing import List, Dict


def harville_place_show(p_win: List[float], use_stern: bool = True) -> List[Dict[str, float]]:
    """
    Compute place and show probabilities using Harville formulas.
    
    Harville formulas:
    - P(place_i) = Σ_{j≠i} [p_i * p_j / (1 - p_i)]
    - P(show_i) = Σ_{j≠i,k≠i,k≠j} [p_i * p_j * p_k / ((1-p_i)(1-p_i-p_j))]
    
    Stern adjustment: Mild flattening for dense favorites (optional).
    
    Args:
        p_win: List of win probabilities (must sum to ~1.0)
        use_stern: Apply Stern adjustment (default True)
    
    Returns:
        List of {p_win, p_place, p_show} dicts
    
    Examples:
    >>> probs = [0.40, 0.30, 0.20, 0.10]
    >>> results = harville_place_show(probs)
    >>> results[0]['p_place'] > results[0]['p_win']  # Place > Win
    True
    """
    n = len(p_win)
    if n < 2:
        # Edge case: only 1 horse
        return [{"p_win": 1.0, "p_place": 1.0, "p_show": 1.0}] if n == 1 else []
    
    # Stern adjustment (optional mild flattening)
    if use_stern:
        # Stern factor: slightly reduce extreme probabilities
        # Formula: p' = p^0.95 (gentle exponent)
        p_adjusted = [p ** 0.95 for p in p_win]
        # Renormalize
        total = sum(p_adjusted)
        if total > 0:
            p_win = [p / total for p in p_adjusted]
    
    results = []
    
    for i in range(n):
        p_i = p_win[i]
        
        # Place probability
        p_place = 0.0
        for j in range(n):
            if j != i:
                denom = 1.0 - p_i
                if denom < 1e-9:
                    denom = 1e-9  # Numerical stability
                p_place += (p_i * p_win[j]) / denom
        
        # Show probability
        p_show = 0.0
        for j in range(n):
            if j == i:
                continue
            for k in range(n):
                if k == i or k == j:
                    continue
                
                denom1 = 1.0 - p_i
                denom2 = 1.0 - p_i - p_win[j]
                
                # Numerical stability
                if denom1 < 1e-9:
                    denom1 = 1e-9
                if denom2 < 1e-9:
                    denom2 = 1e-9
                
                p_show += (p_i * p_win[j] * p_win[k]) / (denom1 * denom2)
        
        # Clamp to valid probability range
        p_place = max(0.0, min(1.0, p_place))
        p_show = max(0.0, min(1.0, p_show))
        
        results.append({
            "p_win": p_i,
            "p_place": p_place,
            "p_show": p_show
        })
    
    return results


def compute_exacta_prob(p_win: List[float], i: int, j: int) -> float:
    """
    Probability of exacta (i first, j second).
    P(i-j) = p_i * p_j / (1 - p_i)
    """
    if i == j or i >= len(p_win) or j >= len(p_win):
        return 0.0
    
    p_i = p_win[i]
    p_j = p_win[j]
    denom = 1.0 - p_i
    
    if denom < 1e-9:
        return 0.0
    
    return (p_i * p_j) / denom

