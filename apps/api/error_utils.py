"""
Error handling utilities for FinishLine API.
Provides structured error responses and validation helpers.
"""
import os
import logging
from typing import Optional, Dict, Any
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)


class ApiError(Exception):
    """Structured API error with status code and error code."""
    
    def __init__(
        self,
        status: int,
        message: str,
        code: str = "internal",
        extra: Optional[Dict[str, Any]] = None
    ):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.extra = extra or {}


def json_error(
    status: int,
    message: str,
    code: str = "internal",
    req_id: Optional[str] = None,
    elapsed_ms: Optional[int] = None,
    **extra
) -> JSONResponse:
    """Return structured JSON error response."""
    payload = {
        "ok": False,
        "error": message,
        "code": code,
        **extra
    }
    if req_id:
        payload["reqId"] = req_id
    if elapsed_ms is not None:
        payload["elapsed_ms"] = elapsed_ms
    
    return JSONResponse(payload, status_code=status)


def require_env(name: str) -> str:
    """
    Require an environment variable to be set.
    Raises ApiError if missing.
    """
    value = os.getenv(name)
    if not value:
        raise ApiError(
            500,
            f"Missing required environment variable: {name}",
            "env_missing"
        )
    return value


def validate_base64_size(base64_data: str, max_mb: float = 6.0) -> None:
    """
    Validate base64 payload size.
    Raises ApiError if too large.
    """
    # Estimate decoded size (base64 is ~33% larger than binary)
    estimated_bytes = (len(base64_data) * 3) // 4
    estimated_mb = estimated_bytes / (1024 * 1024)
    
    if estimated_mb > max_mb:
        raise ApiError(
            413,
            f"File too large ({estimated_mb:.2f}MB). Maximum allowed is {max_mb}MB.",
            "payload_too_large",
            {"size_mb": round(estimated_mb, 2), "limit_mb": max_mb}
        )


def validate_request_method(method: str, allowed: list) -> None:
    """Validate HTTP method is allowed."""
    if method not in allowed:
        raise ApiError(
            405,
            f"Method {method} not allowed. Allowed: {', '.join(allowed)}",
            "method_not_allowed"
        )


def safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert value to float."""
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    """Safely convert value to int."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return default

