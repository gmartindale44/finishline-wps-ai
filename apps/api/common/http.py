"""
HTTP response helpers for consistent API responses.
All endpoints should use ok() or fail() to ensure JSON-only responses.
"""
import json
import traceback
import uuid
import re
from fastapi.responses import JSONResponse
from .types import ApiError, ApiOk


def ok(data: any, req_id: str = None, elapsed_ms: int = None, status: int = 200) -> JSONResponse:
    """
    Return success response with consistent structure.
    
    Args:
        data: Response data (will be validated against schema if Pydantic model)
        req_id: Request ID for tracking
        elapsed_ms: Request duration in milliseconds
        status: HTTP status code (default 200)
    
    Returns:
        JSONResponse with {ok: true, data: ..., reqId: ..., elapsed_ms: ...}
    """
    payload = {
        "ok": True,
        "data": data
    }
    
    if req_id:
        payload["reqId"] = req_id
    if elapsed_ms is not None:
        payload["elapsed_ms"] = elapsed_ms
    
    return JSONResponse(
        payload,
        status_code=status,
        media_type="application/json"
    )


def fail(
    code: str,
    message: str,
    detail: any = None,
    hint: str = None,
    req_id: str = None,
    elapsed_ms: int = None,
    status: int = 400
) -> JSONResponse:
    """
    Return error response with consistent structure.
    
    Args:
        code: Machine-readable error code
        message: Human-readable error message
        detail: Additional error details
        hint: Actionable hint for user
        req_id: Request ID for tracking
        elapsed_ms: Request duration in milliseconds
        status: HTTP status code (default 400)
    
    Returns:
        JSONResponse with {ok: false, code: ..., message: ..., hint: ...}
    """
    if not req_id:
        req_id = str(uuid.uuid4())[:8]
    
    payload = ApiError(
        ok=False,
        code=code,
        message=message,
        detail=detail,
        hint=hint,
        reqId=req_id,
        elapsed_ms=elapsed_ms
    ).dict()
    
    return JSONResponse(
        payload,
        status_code=status,
        media_type="application/json"
    )


def try_json(text: str) -> any:
    """
    Attempt to parse JSON from text, with fallback extraction.
    
    Tries:
    1. Standard JSON parse
    2. Extract first {...} block and parse
    3. Return None if both fail
    
    Args:
        text: Raw text that might contain JSON
    
    Returns:
        Parsed JSON object or None
    """
    # Try standard parse
    try:
        return json.loads(text)
    except Exception:
        pass
    
    # Try to extract first JSON object
    try:
        m = re.search(r'\{[\s\S]*\}', text)
        if m:
            return json.loads(m.group(0))
    except Exception:
        pass
    
    return None


def generate_request_id() -> str:
    """Generate a short unique request ID."""
    return str(uuid.uuid4())[:12]

