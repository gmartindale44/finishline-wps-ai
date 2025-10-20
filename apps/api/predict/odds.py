"""
ML Odds parsing and normalization for ticket-only predictions.
Handles fractional, decimal, moneyline, and integer odds formats.
"""
import re
from typing import Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class Odds:
    """Parsed and normalized odds representation."""
    kind: str  # "fractional", "decimal", "moneyline", "even"
    raw: str
    frac_num: Optional[int]
    frac_den: Optional[int]
    decimal: float
    implied_win: float  # 1/decimal


def parse_odds(raw: str) -> Optional[Odds]:
    """
    Parse ML odds from various formats.
    
    Formats supported:
    - Fractional: "7/2", "5-2", "7-2", "6/1"
    - Integer: "15" (means 15/1)
    - Decimal: "3.50", "4.5"
    - Moneyline: "+350", "-200"
    - Even: "EVEN", "1-1", "1/1"
    - Scratch/Missing: "SCR", "—", "", None
    
    Examples:
    >>> parse_odds("7/2").decimal
    4.5
    >>> parse_odds("5-2").decimal
    3.5
    >>> parse_odds("6").decimal
    7.0
    >>> parse_odds("3.50").decimal
    3.5
    >>> parse_odds("EVEN").decimal
    2.0
    >>> parse_odds("SCR")
    None
    """
    if not raw:
        return None
    
    s = str(raw).strip().upper()
    
    # Scratched/missing
    if s in ("", "—", "SCR", "SCRATCHED", "WD", "WITHDRAWN"):
        return None
    
    # Even money
    if s in ("EVEN", "EVN", "1-1", "1/1"):
        return Odds(
            kind="even",
            raw=raw,
            frac_num=1,
            frac_den=1,
            decimal=2.0,
            implied_win=0.5
        )
    
    # Fractional: "7/2", "7-2", "7 2"
    frac_pattern = re.compile(r'^(\d+)[\s/\-:]+(\d+)$')
    m = frac_pattern.match(s)
    if m:
        num, den = int(m.group(1)), int(m.group(2))
        if den == 0:
            return None
        decimal = (num / den) + 1.0  # profit/stake + 1
        return Odds(
            kind="fractional",
            raw=raw,
            frac_num=num,
            frac_den=den,
            decimal=decimal,
            implied_win=1.0 / decimal
        )
    
    # Decimal: "3.50", "4.5"
    try:
        dec = float(s)
        if dec >= 1.0:
            return Odds(
                kind="decimal",
                raw=raw,
                frac_num=None,
                frac_den=None,
                decimal=dec,
                implied_win=1.0 / dec
            )
    except ValueError:
        pass
    
    # Moneyline: "+350", "-200"
    if s.startswith(('+', '-')):
        try:
            ml = int(s)
            if ml > 0:
                # Positive: profit on $100 bet
                decimal = (ml / 100.0) + 1.0
            else:
                # Negative: need to bet |ml| to win $100
                decimal = (100.0 / abs(ml)) + 1.0
            return Odds(
                kind="moneyline",
                raw=raw,
                frac_num=None,
                frac_den=None,
                decimal=decimal,
                implied_win=1.0 / decimal
            )
        except ValueError:
            pass
    
    # Integer shorthand: "15" means 15/1
    try:
        num = int(s)
        if num > 0:
            decimal = num + 1.0
            return Odds(
                kind="fractional",
                raw=raw,
                frac_num=num,
                frac_den=1,
                decimal=decimal,
                implied_win=1.0 / decimal
            )
    except ValueError:
        pass
    
    # Could not parse
    return None


def field_size_adjust(win_probs: list[float], n_horses: int, alpha: float = 0.6) -> list[float]:
    """
    Normalize win probabilities with field-size smoothing.
    
    Formula: p_i = (p_i + α/n) / Σ(p_j + α/n)
    
    This adds a small uniform prior to prevent extreme probabilities
    and accounts for field size uncertainty.
    
    Args:
        win_probs: Raw win probabilities
        n_horses: Number of horses in field
        alpha: Smoothing parameter (default 0.6)
    
    Returns:
        Normalized probability vector (sums to 1.0)
    """
    if not win_probs or n_horses <= 0:
        return []
    
    # Add smoothing
    smoothed = [(p + alpha / n_horses) for p in win_probs]
    
    # Normalize
    total = sum(smoothed)
    if total <= 0:
        # All zero - return uniform
        return [1.0 / n_horses] * len(win_probs)
    
    return [p / total for p in smoothed]


def detect_coupled_entries(horses: list[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Detect coupled entries (1A/1B or duplicate names).
    
    Returns:
        {
          "has_coupled": bool,
          "entries": [{entry_id, horse_indices, combined_odds}],
          "index_to_entry": {horse_idx: entry_id}
        }
    """
    # For ticket-only mode, we'll keep this simple for now
    # Advanced: detect "1A", "1B" patterns or exact name duplicates
    # For MVP, return no coupling
    return {
        "has_coupled": False,
        "entries": [],
        "index_to_entry": {}
    }

