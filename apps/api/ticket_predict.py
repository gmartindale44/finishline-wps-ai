"""
Ticket-Only Prediction Endpoint
Pure mathematical model using only fields visible on a race ticket.
No external API calls - completes in <2s.
"""
import logging
import time
from typing import Dict, Any, List
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Import ticket-only prediction modules
try:
    from .predict.odds import parse_odds, field_size_adjust, detect_coupled_entries
    from .predict.calibration import get_calibrated_win_probs
    from .predict.harville import harville_place_show
    from .predict.ev import compute_value_metrics
    from .config import TICKET_ONLY_MODE
    from .retry_utils import generate_request_id
except ImportError:
    # Fallback imports (if running standalone)
    from predict.odds import parse_odds, field_size_adjust, detect_coupled_entries
    from predict.calibration import get_calibrated_win_probs
    from predict.harville import harville_place_show
    from predict.ev import compute_value_metrics
    from config import TICKET_ONLY_MODE
    from retry_utils import generate_request_id

log = logging.getLogger(__name__)

router = APIRouter()


class HorseInput(BaseModel):
    """Horse data from ticket."""
    name: str
    ml_odds_raw: str = Field(default="", description="ML odds (any format)")
    trainer: str = Field(default="")
    jockey: str = Field(default="")


class RaceContext(BaseModel):
    """Race metadata from ticket."""
    date: str = Field(default="")
    track: str = Field(default="")
    surface: str = Field(default="dirt")
    distance: str = Field(default="")


class TicketPredictRequest(BaseModel):
    """Request for ticket-only prediction."""
    race: RaceContext
    horses: List[HorseInput]


@router.post("/api/finishline/ticket/predict")
async def ticket_predict(request: Request, body: TicketPredictRequest):
    """
    Ticket-Only prediction endpoint.
    
    Uses only fields visible on a race ticket:
    - Horse name
    - ML odds
    - Trainer
    - Jockey
    - Race date, track, surface, distance
    
    NO external API calls - pure mathematical model.
    Execution time: <2s
    """
    rid = generate_request_id()
    t0 = time.perf_counter()
    
    try:
        log.info(f"[{rid}] ticket_predict: {len(body.horses)} horses, track={body.race.track}")
        
        if not body.horses:
            return JSONResponse({
                "ok": False,
                "code": "no_horses",
                "message": "No horses provided",
                "rid": rid
            }, status_code=200)
        
        # Parse ML odds
        horses_data = []
        decimal_odds = []
        
        for i, h in enumerate(body.horses):
            parsed = parse_odds(h.ml_odds_raw)
            if parsed:
                horses_data.append({
                    "index": i,
                    "name": h.name,
                    "ml_odds_raw": h.ml_odds_raw,
                    "ml_decimal": parsed.decimal,
                    "trainer": h.trainer,
                    "jockey": h.jockey,
                    "parsed": True
                })
                decimal_odds.append(parsed.decimal)
            else:
                # Missing/invalid odds - use field average as placeholder
                log.warning(f"[{rid}] Could not parse odds for {h.name}: '{h.ml_odds_raw}'")
                horses_data.append({
                    "index": i,
                    "name": h.name,
                    "ml_odds_raw": h.ml_odds_raw,
                    "ml_decimal": None,
                    "trainer": h.trainer,
                    "jockey": h.jockey,
                    "parsed": False
                })
                decimal_odds.append(None)
        
        # Fill in missing odds with field average
        valid_odds = [o for o in decimal_odds if o is not None]
        if valid_odds:
            avg_decimal = sum(valid_odds) / len(valid_odds)
        else:
            avg_decimal = 6.0  # Default if all odds missing
        
        decimal_odds = [o if o is not None else avg_decimal for o in decimal_odds]
        
        # Update horses_data with filled odds
        for i, h in enumerate(horses_data):
            if h["ml_decimal"] is None:
                h["ml_decimal"] = decimal_odds[i]
        
        n_horses = len(horses_data)
        
        # Step 1: Get calibrated win probabilities
        win_probs_with_ci = get_calibrated_win_probs(decimal_odds, n_horses)
        p_win = [p[0] for p in win_probs_with_ci]
        
        # Step 2: Compute place/show with Harville
        harville_results = harville_place_show(p_win, use_stern=True)
        
        # Step 3: Compute value metrics
        for i, h in enumerate(horses_data):
            probs = harville_results[i]
            p_w, ci_low, ci_high = win_probs_with_ci[i]
            
            # Compute EV and Kelly
            metrics = compute_value_metrics(
                p_win=probs["p_win"],
                p_place=probs["p_place"],
                p_show=probs["p_show"],
                win_odds=h["ml_decimal"]
            )
            
            h.update({
                "p_win": round(probs["p_win"], 4),
                "p_place": round(probs["p_place"], 4),
                "p_show": round(probs["p_show"], 4),
                "p_win_ci": [round(ci_low, 4), round(ci_high, 4)],
                **metrics
            })
        
        # Rank horses
        sorted_by_win = sorted(horses_data, key=lambda x: x["p_win"], reverse=True)
        sorted_by_ev = sorted([h for h in horses_data if h.get("ev_win", -999) > 0], 
                             key=lambda x: x["ev_win"], reverse=True)
        sorted_by_kelly = sorted([h for h in horses_data if h.get("kelly_win", 0) > 0], 
                                key=lambda x: x["kelly_win"], reverse=True)
        
        # Assign ranks
        for rank, h in enumerate(sorted_by_win, 1):
            h["rank_win"] = rank
        for rank, h in enumerate(sorted_by_ev, 1):
            h["rank_value"] = rank
        for rank, h in enumerate(sorted_by_kelly, 1):
            h["rank_kelly"] = rank
        
        # Build response
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        log.info(f"[{rid}] ticket_predict success: {elapsed_ms}ms")
        
        return JSONResponse({
            "ok": True,
            "mode": "ticket-only",
            "meta": {
                "track": body.race.track,
                "date": body.race.date,
                "surface": body.race.surface,
                "distance": body.race.distance,
                "n_horses": n_horses
            },
            "horses": horses_data,
            "summary": {
                "top_win": [h["name"] for h in sorted_by_win[:3]],
                "top_value": [h["name"] for h in sorted_by_ev[:3]],
                "top_kelly": [h["name"] for h in sorted_by_kelly[:3]]
            },
            "predictions": {
                "win": {
                    "name": sorted_by_win[0]["name"],
                    "prob": sorted_by_win[0]["p_win"],
                    "ev": sorted_by_win[0]["ev_win"],
                    "kelly": sorted_by_win[0]["kelly_win"]
                } if sorted_by_win else None,
                "place": {
                    "name": sorted_by_win[1]["name"],
                    "prob": sorted_by_win[1]["p_place"],
                    "ev": sorted_by_win[1].get("ev_place"),
                    "kelly": sorted_by_win[1].get("kelly_place")
                } if len(sorted_by_win) > 1 else None,
                "show": {
                    "name": sorted_by_win[2]["name"],
                    "prob": sorted_by_win[2]["p_show"],
                    "ev": sorted_by_win[2].get("ev_show"),
                    "kelly": sorted_by_win[2].get("kelly_show")
                } if len(sorted_by_win) > 2 else None
            },
            "rid": rid,
            "elapsed_ms": elapsed_ms
        }, status_code=200)
    
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        log.exception(f"[{rid}] ticket_predict failed")
        return JSONResponse({
            "ok": False,
            "code": "predict_failed",
            "message": f"Prediction failed: {str(e)[:200]}",
            "rid": rid,
            "elapsed_ms": elapsed_ms
        }, status_code=200)  # Status 200 with ok:false

