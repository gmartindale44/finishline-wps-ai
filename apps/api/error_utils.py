"""
Enhanced error handling utilities for FinishLine API.
Ensures all responses are valid JSON with consistent structure.
"""
import uuid
import logging
from typing import Any, Dict, Optional
from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """
    Structured API error with consistent fields.
    Always results in JSON response, never HTML.
    """
    def __init__(
        self,
        status: int,
        message: str,
        code: str = "api_error",
        detail: Any = None,
        hint: str = None,
        extra: Dict[str, Any] = None
    ):
        self.status = status
        self.message = message
        self.code = code
        self.detail = detail
        self.hint = hint
        self.extra = extra or {}
        super().__init__(message)


def json_error(
    status: int,
    message: str,
    code: str,
    req_id: str = None,
    elapsed_ms: int = None,
    detail: Any = None,
    hint: str = None,
    **extra
) -> JSONResponse:
    """
    Return a properly formatted JSON error response.
    
    Args:
        status: HTTP status code
        message: Human-readable error message
        code: Machine-readable error code
        req_id: Request ID for tracking
        elapsed_ms: Request duration
        detail: Additional error details
        hint: Actionable hint for user
        **extra: Additional fields
    
    Returns:
        JSONResponse with standardized error structure
    """
    if not req_id:
        req_id = str(uuid.uuid4())[:8]
    
    payload = {
        "ok": False,
        "error": message,
        "code": code,
        "request_id": req_id
    }
    
    if detail is not None:
        payload["detail"] = detail
    if hint:
        payload["hint"] = hint
    if elapsed_ms is not None:
        payload["elapsed_ms"] = elapsed_ms
    
    # Add any extra fields
    payload.update(extra)
    
    return JSONResponse(payload, status_code=status, media_type="application/json")


def json_success(
    data: Any,
    req_id: str = None,
    elapsed_ms: int = None,
    **extra
) -> JSONResponse:
    """
    Return a properly formatted JSON success response.
    
    Args:
        data: Response data
        req_id: Request ID for tracking
        elapsed_ms: Request duration
        **extra: Additional fields
    
    Returns:
        JSONResponse with standardized success structure
    """
    payload = {
        "ok": True,
        **data
    }
    
    if req_id:
        payload["request_id"] = req_id
    if elapsed_ms is not None:
        payload["elapsed_ms"] = elapsed_ms
    
    # Add any extra fields
    payload.update(extra)
    
    return JSONResponse(payload, status_code=200, media_type="application/json")


def validate_base64_size(data: str, max_mb: float = 6.0) -> None:
    """
    Validate base64 data size to prevent FUNCTION_INVOCATION_FAILED.
    
    Args:
        data: Base64 encoded string (may include data URL prefix)
        max_mb: Maximum size in megabytes
    
    Raises:
        ApiError: If data exceeds size limit
    """
    # Remove data URL prefix if present
    if "," in data:
        data = data.split(",", 1)[1]
    
    # Calculate decoded size (base64 is ~4/3 of original)
    size_mb = (len(data) * 3 / 4) / (1024 * 1024)
    
    if size_mb > max_mb:
        raise ApiError(
            413,
            f"File too large ({size_mb:.2f}MB). Maximum is {max_mb}MB.",
            "payload_too_large",
            hint="Reduce image size/quality or use fewer images"
        )


def install_exception_handlers(app):
    """
    Install global exception handlers to ensure all responses are JSON.
    Prevents any HTML error pages from leaking through.
    
    Args:
        app: FastAPI application instance
    """
    from fastapi import Request
    from fastapi.exceptions import RequestValidationError
    from pydantic import ValidationError
    
    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError):
        """Handle structured ApiError exceptions."""
        req_id = getattr(request.state, "req_id", str(uuid.uuid4())[:8])
        logger.error(f"[{req_id}] ApiError: {exc.status} {exc.code} - {exc.message}")
        
        return json_error(
            exc.status,
            exc.message,
            exc.code,
            req_id=req_id,
            detail=exc.detail,
            hint=exc.hint,
            **exc.extra
        )
    
    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        """Handle Pydantic validation errors."""
        req_id = getattr(request.state, "req_id", str(uuid.uuid4())[:8])
        logger.warning(f"[{req_id}] Validation error: {exc}")
        
        return json_error(
            422,
            "Request validation failed",
            "validation_error",
            req_id=req_id,
            detail=exc.errors()[:3],  # Limit to first 3 errors
            hint="Check request body format"
        )
    
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """Catch-all handler for unexpected exceptions."""
        req_id = getattr(request.state, "req_id", str(uuid.uuid4())[:8])
        logger.exception(f"[{req_id}] Unhandled exception: {exc}")
        
        # Never leak internal details in production
        return json_error(
            500,
            "Internal server error. Please try again.",
            "internal_error",
            req_id=req_id,
            detail=str(exc)[:200]  # Truncate for safety
        )


def generate_request_id() -> str:
    """Generate a short, unique request ID."""
    return str(uuid.uuid4())[:12]
