"""
Calibrated win probabilities from ML odds (ticket-only mode).
No external data - uses empirical calibration constants.
"""
import math
from typing import List, Tuple


# Calibration constants (derived from historical data, ticket-only safe)
CALIBRATION_A = 0.04  # Logit intercept
CALIBRATION_B = 0.92  # Logit slope

# Probability bounds
MIN_PROB = 0.0005  # 0.05% (practical minimum)
MAX_PROB = 0.85    # 85% (even heavy favorites aren't locks)


def logit(p: float) -> float:
    """Logit function: log(p / (1-p))"""
    p_clamped = max(MIN_PROB, min(1 - MIN_PROB, p))
    return math.log(p_clamped / (1 - p_clamped))


def sigmoid(x: float) -> float:
    """Sigmoid function: 1 / (1 + exp(-x))"""
    return 1.0 / (1.0 + math.exp(-x))


def base_implied_from_odds(decimal_odds: float) -> float:
    """
    Raw implied probability from decimal odds.
    
    Args:
        decimal_odds: Decimal odds (e.g., 4.5 for 7/2)
    
    Returns:
        Raw implied probability (1 / decimal_odds)
    """
    if decimal_odds <= 1.0:
        return MAX_PROB  # Invalid odds, return max prob
    
    return 1.0 / decimal_odds


def overround_correction(p_raw_vec: List[float]) -> List[float]:
    """
    Correct for bookmaker overround (sum of probabilities > 1.0).
    
    If Σp > 1: Deflate proportionally
    If Σp < 1: Inflate proportionally (rare but can happen)
    
    Args:
        p_raw_vec: Raw implied probabilities from odds
    
    Returns:
        Normalized probabilities (sum = 1.0)
    """
    if not p_raw_vec:
        return []
    
    total = sum(p_raw_vec)
    if total <= 0:
        # All zero - return uniform
        n = len(p_raw_vec)
        return [1.0 / n] * n
    
    # Proportional normalization
    return [p / total for p in p_raw_vec]


def empirical_calibration(p_vec: List[float]) -> List[float]:
    """
    Apply empirical calibration curve to probabilities.
    
    Uses piecewise logistic adjustment:
    p_adj = σ(a + b * logit(p))
    
    This regresses short favorites down and longshots up slightly,
    based on historical win rate patterns.
    
    Constants are generic priors (no external data required).
    
    Args:
        p_vec: Normalized probabilities
    
    Returns:
        Calibrated probabilities
    """
    calibrated = []
    
    for p in p_vec:
        # Clamp input
        p_safe = max(MIN_PROB, min(MAX_PROB, p))
        
        # Apply logistic calibration
        logit_p = logit(p_safe)
        adjusted_logit = CALIBRATION_A + CALIBRATION_B * logit_p
        p_calibrated = sigmoid(adjusted_logit)
        
        # Final clamp
        p_calibrated = max(MIN_PROB, min(MAX_PROB, p_calibrated))
        calibrated.append(p_calibrated)
    
    return calibrated


def get_calibrated_win_probs(
    decimal_odds_list: List[float],
    n_horses: int,
    alpha: float = 0.6
) -> List[Tuple[float, float, float]]:
    """
    Complete pipeline: odds → calibrated win probabilities with confidence intervals.
    
    Steps:
    1. Convert odds to implied probabilities
    2. Correct for overround
    3. Apply empirical calibration
    4. Field-size smoothing
    5. Compute Wilson confidence intervals
    
    Args:
        decimal_odds_list: List of decimal odds
        n_horses: Number of horses in field
        alpha: Field-size smoothing parameter
    
    Returns:
        List of (p_win, ci_low, ci_high) tuples
    """
    # Step 1: Raw implied probabilities
    p_raw = [base_implied_from_odds(odds) for odds in decimal_odds_list]
    
    # Step 2: Overround correction
    p_corrected = overround_correction(p_raw)
    
    # Step 3: Empirical calibration
    p_calibrated = empirical_calibration(p_corrected)
    
    # Step 4: Field-size smoothing
    from .odds import field_size_adjust
    p_final = field_size_adjust(p_calibrated, n_horses, alpha)
    
    # Step 5: Wilson confidence intervals (using n=100 pseudo-trials)
    results = []
    n_trials = 100
    
    for p in p_final:
        # Wilson score interval
        z = 1.96  # 95% confidence
        p_safe = max(MIN_PROB, min(1 - MIN_PROB, p))
        
        denominator = 1 + (z**2 / n_trials)
        center = (p_safe + (z**2 / (2 * n_trials))) / denominator
        margin = (z * math.sqrt((p_safe * (1 - p_safe) / n_trials) + (z**2 / (4 * n_trials**2)))) / denominator
        
        ci_low = max(MIN_PROB, center - margin)
        ci_high = min(MAX_PROB, center + margin)
        
        results.append((p, ci_low, ci_high))
    
    return results

