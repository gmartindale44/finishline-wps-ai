"""
Global middleware for FinishLine API.
Ensures ALL responses are JSON, even on unhandled exceptions.
"""
import logging
import traceback
from fastapi import Request
from .schemas import make_request_id, json_err

logger = logging.getLogger(__name__)


def install_error_middleware(app):
    """
    Install global error handling middleware.
    This ensures NO HTML error pages ever leak through.
    
    Usage:
        from apps.api.common.middleware import install_error_middleware
        app = FastAPI()
        install_error_middleware(app)
    """
    
    @app.middleware("http")
    async def error_wrapper_middleware(request: Request, call_next):
        """
        Wraps all requests with:
        1. Request ID generation
        2. Exception catching
        3. JSON-only error responses
        """
        # Generate unique request ID
        request_id = make_request_id()
        request.state.request_id = request_id
        
        try:
            # Process request
            response = await call_next(request)
            
            # Add request ID to all responses
            response.headers["X-Request-Id"] = request_id
            
            return response
            
        except Exception as e:
            # Log full stack trace
            logger.exception(f"[{request_id}] Unhandled exception in {request.method} {request.url.path}")
            
            # Return structured JSON error (NEVER HTML)
            return json_err(
                code="internal_error",
                message="Internal server error",
                request_id=request_id,
                status=500,
                details=str(e)[:200]  # Truncate for safety
            )
    
    # Add health endpoint that uses the new schema
    @app.get("/api/health")
    async def health_check(request: Request):
        """Health check - always returns JSON with ApiOk envelope."""
        from .schemas import json_ok
        request_id = getattr(request.state, "request_id", make_request_id())
        return json_ok(
            data={"status": "ok", "service": "FinishLine WPS AI"},
            request_id=request_id
        )

