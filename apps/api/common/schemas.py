"""
Shared request/response schemas for FinishLine API.
All endpoints MUST use these to ensure consistent JSON envelopes.
"""
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional, Literal
from uuid import uuid4
from fastapi.responses import JSONResponse


class ApiOk(BaseModel):
    """Success response envelope - ALWAYS use this for 2xx responses."""
    ok: Literal[True] = True
    data: Any
    requestId: str


class ApiErr(BaseModel):
    """Error response envelope - ALWAYS use this for 4xx/5xx responses."""
    ok: Literal[False] = False
    error: Dict[str, Any] = Field(..., description="Error details: {code, message, details?}")
    requestId: str


def make_request_id() -> str:
    """Generate a unique request ID (UUID4 hex, 32 chars)."""
    return uuid4().hex


def json_ok(data: Any, request_id: str, status: int = 200) -> JSONResponse:
    """
    Return a success JSON response with ApiOk envelope.
    
    Args:
        data: Response payload (any JSON-serializable data)
        request_id: Unique request identifier
        status: HTTP status code (default 200)
    
    Returns:
        JSONResponse with ApiOk structure
    """
    payload = ApiOk(data=data, requestId=request_id)
    return JSONResponse(
        content=payload.dict(),
        status_code=status,
        media_type="application/json",
        headers={"X-Request-Id": request_id}
    )


def json_err(
    code: str,
    message: str,
    request_id: str,
    status: int = 400,
    details: Any = None
) -> JSONResponse:
    """
    Return an error JSON response with ApiErr envelope.
    
    Args:
        code: Machine-readable error code (e.g., "payload_too_large")
        message: Human-readable error message
        request_id: Unique request identifier
        status: HTTP status code (default 400)
        details: Optional additional error details
    
    Returns:
        JSONResponse with ApiErr structure
    """
    error_obj = {
        "code": code,
        "message": message
    }
    if details is not None:
        error_obj["details"] = details
    
    payload = ApiErr(error=error_obj, requestId=request_id)
    return JSONResponse(
        content=payload.dict(),
        status_code=status,
        media_type="application/json",
        headers={"X-Request-Id": request_id}
    )

