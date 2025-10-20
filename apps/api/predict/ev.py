"""
Expected Value and Kelly Criterion calculations.
Ticket-only safe (uses ML odds from the program).
"""
from typing import Optional


def kelly_fraction(
    p_win: float,
    decimal_odds: float,
    max_kelly: float = 0.25,
    min_edge: float = 0.01
) -> float:
    """
    Calculate Kelly Criterion bet fraction.
    
    Formula: f* = (bp - q) / b
    where:
    - b = decimal_odds - 1 (net profit per $1)
    - p = true win probability (model)
    - q = 1 - p
    
    Args:
        p_win: Model win probability
        decimal_odds: Decimal odds from ticket
        max_kelly: Maximum fraction (default 0.25 for quarter-Kelly)
        min_edge: Minimum edge required to bet (default 1%)
    
    Returns:
        Kelly fraction [0.0, max_kelly]
    
    Examples:
    >>> kelly_fraction(0.40, 3.0)  # 40% prob, 2/1 odds
    0.1
    >>> kelly_fraction(0.10, 3.0)  # 10% prob, 2/1 odds (no edge)
    0.0
    """
    if decimal_odds <= 1.0:
        return 0.0
    
    b = decimal_odds - 1.0  # Net profit per $1
    q = 1.0 - p_win
    
    # Kelly formula
    kelly = (b * p_win - q) / b
    
    # Only bet if edge > min_edge
    edge = p_win - (1.0 / decimal_odds)  # Model prob - implied prob
    if edge < min_edge:
        return 0.0
    
    # Clamp to [0, max_kelly]
    return max(0.0, min(max_kelly, kelly))


def expected_value(p_win: float, decimal_odds: float) -> float:
    """
    Expected value per $1 bet.
    
    Formula: EV = (p * payout) - (1 - p) * 1
              = p * decimal_odds - (1 - p)
    
    Args:
        p_win: Model win probability
        decimal_odds: Decimal odds from ticket
    
    Returns:
        Expected value per $1 (positive = +EV, negative = -EV)
    
    Examples:
    >>> expected_value(0.40, 3.0)  # 40% prob, 2/1 odds
    0.2
    >>> expected_value(0.20, 3.0)  # 20% prob, 2/1 odds
    -0.4
    """
    if decimal_odds <= 0:
        return -1.0
    
    payout = decimal_odds  # Includes stake
    ev = (p_win * payout) - 1.0
    
    return round(ev, 4)


def compute_value_metrics(
    p_win: float,
    p_place: float,
    p_show: float,
    win_odds: float,
    place_odds: Optional[float] = None,
    show_odds: Optional[float] = None,
    max_kelly: float = 0.25
) -> Dict[str, Any]:
    """
    Compute all value metrics for a horse.
    
    Args:
        p_win, p_place, p_show: Model probabilities
        win_odds: Decimal odds for win bet
        place_odds: Decimal odds for place (if available)
        show_odds: Decimal odds for show (if available)
        max_kelly: Maximum Kelly fraction
    
    Returns:
        {
          ev_win, ev_place, ev_show,
          kelly_win, kelly_place, kelly_show,
          best_bet: 'win'|'place'|'show'|None
        }
    """
    # Win metrics
    ev_win = expected_value(p_win, win_odds)
    kelly_win = kelly_fraction(p_win, win_odds, max_kelly)
    
    # Place metrics (if odds available)
    if place_odds and place_odds > 1.0:
        ev_place = expected_value(p_place, place_odds)
        kelly_place = kelly_fraction(p_place, place_odds, max_kelly)
    else:
        ev_place = None
        kelly_place = None
    
    # Show metrics (if odds available)
    if show_odds and show_odds > 1.0:
        ev_show = expected_value(p_show, show_odds)
        kelly_show = kelly_fraction(p_show, show_odds, max_kelly)
    else:
        ev_show = None
        kelly_show = None
    
    # Determine best bet (highest EV with positive edge)
    bets = []
    if ev_win > 0 and kelly_win > 0:
        bets.append(('win', ev_win))
    if ev_place and ev_place > 0 and kelly_place and kelly_place > 0:
        bets.append(('place', ev_place))
    if ev_show and ev_show > 0 and kelly_show and kelly_show > 0:
        bets.append(('show', ev_show))
    
    best_bet = max(bets, key=lambda x: x[1])[0] if bets else None
    
    return {
        "ev_win": ev_win,
        "ev_place": ev_place,
        "ev_show": ev_show,
        "kelly_win": round(kelly_win, 4),
        "kelly_place": round(kelly_place, 4) if kelly_place else None,
        "kelly_show": round(kelly_show, 4) if kelly_show else None,
        "best_bet": best_bet
    }

