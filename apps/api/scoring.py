"""
Enhanced handicapping scoring module for FinishLine WPS AI.
Combines multiple factors: odds baseline, trainer/jockey combo, track/surface bias,
post-position bias, pace projection, and Kelly criterion.
"""
from __future__ import annotations
import math
import re
from typing import Dict, Any, List, Optional

FRACT_RE = re.compile(r'^\s*(\d+)\s*[/\-:\s]\s*(\d+)\s*$')  # 7/2, 7-2, 7:2, '7 2'

def parse_fractional(frac: str | None) -> Optional[float]:
    """Parse fractional odds like '7/2' into decimal ratio."""
    if not frac:
        return None
    m = FRACT_RE.match(str(frac))
    if not m:
        return None
    num, den = int(m.group(1)), int(m.group(2))
    if den == 0:
        return None
    return num / den

def implied_prob_from_fractional(frac: str | None) -> Optional[float]:
    """Convert fractional odds to implied probability."""
    r = parse_fractional(frac)
    if r is None:
        return None
    # fractional r = profit/1 → decimal = r+1 => p = 1/decimal
    return 1.0 / (r + 1.0)

def z(x: float, m: float, s: float) -> float:
    """Safe z-score calculation."""
    if s <= 1e-9:
        return 0.0
    return (x - m) / s

def pct_clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Clip value to percentage range."""
    return max(lo, min(hi, x))

def score_horses(
    horses: List[Dict[str, Any]],
    ctx: Dict[str, Any],
    research: Optional[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Score horses using multiple handicapping factors.
    Returns list with model_prob and kelly stake, using only horses provided.
    """
    if not horses:
        return []
    
    # Baselines from odds
    base_probs = []
    for h in horses:
        p = implied_prob_from_fractional(h.get('odds')) or 0.12  # fallback 12%
        base_probs.append(p)

    # Normalize baseline so sum ~ 1.0
    s = sum(base_probs) or 1.0
    base_probs = [p / s for p in base_probs]

    # Research-derived modifiers
    # Expected research features if provider=websearch (but handle missing gracefully)
    jtw = []  # jockey/trainer win%
    pace = []  # early/press/closer [E,P,C] → numeric bias
    post = []  # post position if any
    track = (ctx.get('track') or '').lower()
    surface = (ctx.get('surface') or '').lower()
    distance = (ctx.get('distance') or '').lower()

    for i, h in enumerate(horses):
        research_horses = (research or {}).get('horses', {})
        info = research_horses.get(h.get('name', ''), {})
        
        jt = float(info.get('jt_win_pct') or info.get('trainer_jockey_win_pct') or 12.0)  # default 12%
        jtw.append(jt)

        ps = (info.get('style') or info.get('pace') or '').upper()
        if ps.startswith('E'):
            pace.append(+0.02)
        elif ps.startswith('P'):
            pace.append(+0.01)
        elif ps.startswith('C'):
            pace.append(0.0)
        else:
            pace.append(0.0)

        pp = int(info.get('post') or 0)
        post.append(pp)

    # Compute aggregate weights
    jt_mean = (sum(jtw) / len(jtw)) if jtw else 12.0
    jt_std = (sum((x - jt_mean) ** 2 for x in jtw) / len(jtw)) ** 0.5 if jtw else 5.0

    # Track/Surface bias table (very light-touch)
    bias = 0.0
    if 'dirt' in surface:
        bias += 0.01
    if 'turf' in surface:
        bias += 0.0
    
    sprint = any(x in distance for x in ['5f', '5 1/2', '6f'])

    # Build final raw score
    raw = []
    for i, h in enumerate(horses):
        p0 = base_probs[i]
        jt_boost = 1.0 + 0.05 * z(jtw[i], jt_mean, max(jt_std, 1.0))
        pace_boost = 1.0 + pace[i]  # +2% early, +1% press
        
        # Post penalty: sprints penalize far outside, routes penalize extremes
        pp = post[i]
        post_boost = 1.0
        if pp > 0:
            if sprint:
                if pp >= 10:
                    post_boost -= 0.03
                elif pp >= 8:
                    post_boost -= 0.02
            else:
                if pp == 1 or pp >= 12:
                    post_boost -= 0.02

        track_boost = 1.0 + bias
        r = p0 * jt_boost * pace_boost * post_boost * track_boost
        raw.append(max(1e-6, r))

    # Normalize to probabilities
    s = sum(raw) or 1.0
    probs = [r / s for r in raw]

    # Kelly vs implied odds
    out = []
    for i, h in enumerate(horses):
        p = probs[i]
        frac = parse_fractional(h.get('odds'))
        if frac is None:
            kelly = 0.0
        else:
            # Kelly: f* = (bp - q)/b ; where b = frac, p=model prob, q=1-p
            b = frac
            k = (b * p - (1.0 - p)) / max(b, 1e-6)
            kelly = pct_clip(k, 0.0, 0.5)
        
        out.append({
            **h,
            'model_prob': round(p, 4),
            'kelly': round(kelly, 4)
        })
    
    return out

def wps_from_probs(scored: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Extract W/P/S predictions from scored horses."""
    ranked = sorted(scored, key=lambda x: x.get('model_prob', 0), reverse=True)
    return {
        'win': ranked[0] if len(ranked) > 0 else None,
        'place': ranked[1] if len(ranked) > 1 else None,
        'show': ranked[2] if len(ranked) > 2 else None,
        'ranked': ranked
    }
