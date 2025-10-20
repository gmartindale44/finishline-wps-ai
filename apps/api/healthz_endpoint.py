"""
Health check endpoint with provider and environment information.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pathlib import Path
import os

router = APIRouter()

@router.get("/api/healthz")
@router.get("/api/finishline/healthz")
def healthz():
    """
    Rich health endpoint showing provider, environment, and configuration.
    """
    try:
        from .config import settings
        
        # Check for public directory
        public_dir = Path("public")
        index_html = public_dir / "index.html"
        
        return JSONResponse({
            "ok": True,
            "env": settings.VERCEL_ENV or "unknown",
            "provider": settings.OCR_PROVIDER,
            "debug": settings.OCR_DEBUG,
            "prod_stub_forbidden": settings.is_prod,
            "openai_key_present": bool(settings.OPENAI_API_KEY),
            "max_images": settings.MAX_IMAGES,
            "public_exists": public_dir.exists(),
            "index_exists": index_html.exists(),
            "timeouts": {
                "analyze": settings.ANALYZE_TIMEOUT_SEC,
                "predict": settings.PREDICT_TIMEOUT_SEC
            }
        })
    except Exception as e:
        # Fallback if config import fails
        return JSONResponse({
            "ok": True,
            "status": "healthy",
            "error": f"Config not available: {e}"
        })

