"""
Research-Enhanced Scoring System
Combines research data (speed figures, trainer/jockey stats, pace) with odds analysis
"""
from typing import List, Dict, Any
from .odds import ml_to_fraction, ml_to_prob
import math
import os

def research_score(horse: Dict[str, Any]) -> float:
    """
    Calculate research-enhanced composite score for a horse.
    
    Uses:
    - Speed figures (last_speed_fig)
    - Trainer/Jockey win percentages
    - Pace style adjustments
    - Form delta (improvement/decline)
    - Days since last race
    
    Args:
        horse: Dictionary with enriched research data
    
    Returns:
        Composite score (0.0 to 1.0+)
    """
    # Base odds probability
    odds_str = horse.get("odds", "5-2")
    base_prob = ml_to_prob(odds_str)
    
    # Speed figure adjustment (normalized around 80)
    speed_fig = horse.get("last_speed_fig", 80)
    speed_factor = min(max(speed_fig / 100.0, 0.5), 1.5)  # 0.5 to 1.5 range
    
    # Trainer/Jockey win percentage (combined)
    trainer_pct = horse.get("trainer_win_pct", 0.12)
    jockey_pct = horse.get("jockey_win_pct", 0.12)
    people_factor = (trainer_pct + jockey_pct) / 0.24  # normalized around 0.24 combined
    
    # Pace style (E=Early, P=Presser, S=Stalker, C=Closer)
    pace = horse.get("early_pace", "P").upper()[:1]
    pace_bonus = {"E": 1.05, "P": 1.0, "S": 0.95, "C": 0.90}.get(pace, 1.0)
    
    # Form delta (+positive is improving, -negative is declining)
    form_delta = horse.get("form_delta", 0.0)
    form_factor = 1.0 + (form_delta * 0.1)  # ±10% per point
    form_factor = min(max(form_factor, 0.7), 1.3)
    
    # Days since race (prefer 14-35 days)
    days_off = horse.get("days_since_race", 21)
    if 14 <= days_off <= 35:
        rest_factor = 1.1
    elif days_off < 7:
        rest_factor = 0.9  # Too fresh
    elif days_off > 60:
        rest_factor = 0.85  # Layoff concern
    else:
        rest_factor = 1.0
    
    # Composite calculation
    composite = (
        base_prob * 0.3 +           # 30% odds-implied probability
        speed_factor * 0.25 +       # 25% speed figure
        people_factor * 0.20 +      # 20% trainer/jockey
        pace_bonus * 0.10 +         # 10% pace style
        form_factor * 0.10 +        # 10% form trend
        rest_factor * 0.05          # 5% rest pattern
    )
    
    return round(composite, 4)

def calculate_research_predictions(horses: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Calculate Win/Place/Show predictions using research-enhanced scoring.
    
    Args:
        horses: List of enriched horse dictionaries
    
    Returns:
        Dictionary with win, place, show predictions
    """
    if not horses:
        return {
            "win": {"name": "No Data", "odds": "1-1", "prob": 0.5, "research_score": 0.0, "rationale": "No horses provided"},
            "place": {"name": "No Data", "odds": "1-1", "prob": 0.5, "research_score": 0.0, "rationale": "No horses provided"},
            "show": {"name": "No Data", "odds": "1-1", "prob": 0.5, "research_score": 0.0, "rationale": "No horses provided"}
        }
    
    # Score all horses using research algorithm
    scored = []
    for h in horses:
        score = research_score(h)
        scored.append({
            "name": h.get("name", "Unknown"),
            "odds": h.get("odds", "1-1"),
            "research_score": score,
            "speed_fig": h.get("last_speed_fig", 80),
            "trainer_pct": h.get("trainer_win_pct", 0.12),
            "jockey_pct": h.get("jockey_win_pct", 0.12),
            "pace": h.get("early_pace", "P"),
            "form": h.get("form_delta", 0.0),
            "days_off": h.get("days_since_race", 21)
        })
    
    # Sort by research score (highest first)
    scored.sort(key=lambda x: x["research_score"], reverse=True)
    
    # Normalize probabilities across top contenders
    total_score = sum(h["research_score"] for h in scored[:3]) or 1.0
    for h in scored[:3]:
        h["prob"] = h["research_score"] / total_score
    
    # Select Win/Place/Show
    win_horse = scored[0] if len(scored) > 0 else scored[0]
    place_horse = scored[1] if len(scored) > 1 else scored[0]
    show_horse = scored[2] if len(scored) > 2 else scored[0]
    
    def format_pick(h: Dict[str, Any], position: str) -> Dict[str, Any]:
        return {
            "name": h["name"],
            "odds": h["odds"],
            "prob": h.get("prob", h["research_score"]),
            "research_score": h["research_score"],
            "rationale": (
                f"{position} selection - Research score: {h['research_score']:.3f} | "
                f"Speed: {h['speed_fig']} | Trainer: {h['trainer_pct']:.1%} | "
                f"Jockey: {h['jockey_pct']:.1%} | Pace: {h['pace']}"
            )
        }
    
    return {
        "win": format_pick(win_horse, "Win"),
        "place": format_pick(place_horse, "Place"),
        "show": format_pick(show_horse, "Show"),
        "enrichment_source": "custom" if os.getenv("FINISHLINE_DATA_PROVIDER") == "custom" else "stub"
    }

