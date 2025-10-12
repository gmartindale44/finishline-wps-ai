"""
Shared types for FinishLine API.
Enforces consistent response structures across all endpoints.
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict


class ApiError(BaseModel):
    """Standard error response structure."""
    ok: bool = False
    code: str
    message: str
    detail: Optional[Any] = None
    hint: Optional[str] = None
    reqId: Optional[str] = None
    elapsed_ms: Optional[int] = None


class ApiOk(BaseModel):
    """Standard success response structure."""
    ok: bool = True
    data: Any
    reqId: Optional[str] = None
    elapsed_ms: Optional[int] = None


class OcrHorse(BaseModel):
    """Single horse extracted from OCR."""
    name: str = Field(..., min_length=1, description="Horse name as shown")
    ml: Optional[str] = Field(None, description="Morning line odds like '7/2', '12/1'")
    trainer: Optional[str] = None
    jockey: Optional[str] = None
    odds: Optional[str] = None  # Alias for ml
    bankroll: Optional[float] = 1000
    kelly_fraction: Optional[float] = 0.25


class OcrTable(BaseModel):
    """Complete OCR extraction result."""
    horses: List[OcrHorse]
    track: Optional[str] = None
    distance: Optional[str] = None
    surface: Optional[str] = None
    race_date: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class PredictionHorse(BaseModel):
    """Horse with prediction metrics."""
    name: str
    prob: float = Field(..., ge=0.0, le=1.0)
    ev: Optional[float] = None
    kelly: Optional[float] = Field(None, ge=0.0, le=0.5)
    odds: Optional[str] = None


class Predictions(BaseModel):
    """W/P/S prediction output."""
    win: Optional[PredictionHorse]
    place: Optional[PredictionHorse]
    show: Optional[PredictionHorse]

