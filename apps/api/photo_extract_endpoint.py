"""
OCR endpoint with production safety and proper JSON error handling.
Never allows stub in production. Always returns structured JSON.
"""
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse
from typing import List, Any, Dict
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/api/finishline/photo_extract_openai_b64")
async def photo_extract_openai_b64(files: List[UploadFile] = File(default=[])) -> JSONResponse:
    """
    OCR endpoint - always returns JSON.
    
    Returns:
        {"ok": true, "horses": [...], "result": "..."}
        or
        {"ok": false, "error": {"code": "...", "message": "...", "detail": {...}}}
    """
    try:
        from .config import settings
        
        # 1) Forbid stub in production
        if settings.is_prod and (settings.OCR_PROVIDER == "stub" or settings.OCR_DEBUG):
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "error": {
                        "code": "PROD_STUB_FORBIDDEN",
                        "message": "OCR stub is not allowed in production.",
                        "detail": {"provider": settings.OCR_PROVIDER, "debug": settings.OCR_DEBUG}
                    }
                }
            )
        
        # 2) Validate files
        if not files or len(files) == 0:
            logger.warning("[OCR] No files provided in multipart upload")
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "error": {"code": "NO_FILES", "message": "No images were uploaded.", "detail": {}}
                }
            )
        
        logger.info(f"[OCR] Received {len(files)} files: {[f.filename for f in files]}")
        
        # 3) Check file count
        if len(files) > settings.MAX_IMAGES:
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "error": {
                        "code": "TOO_MANY_FILES",
                        "message": f"Max {settings.MAX_IMAGES} images allowed.",
                        "detail": {"count": len(files)}
                    }
                }
            )
        
        # 4) Branch by provider
        if settings.OCR_PROVIDER == "stub":
            # Dev-only simulated response
            logger.info(f"[OCR] Using stub provider (dev only)")
            return JSONResponse({
                "ok": True,
                "horses": [
                    {"name": "Demo Horse 1", "odds": "5/2", "trainer": "T1", "jockey": "J1"},
                    {"name": "Demo Horse 2", "odds": "3/1", "trainer": "T2", "jockey": "J2"}
                ],
                "result": "Simulated OCR (dev only)"
            })
        
        # 5) Real providers
        horses = []
        
        if settings.OCR_PROVIDER == "openai":
            # Import and call real OpenAI OCR
            try:
                from .openai_ocr import run_openai_ocr_on_bytes
                import asyncio
                
                all_horses = []
                for file in files:
                    content = await file.read()
                    result = await asyncio.wait_for(
                        run_openai_ocr_on_bytes(content, filename=file.filename),
                        timeout=25.0
                    )
                    if isinstance(result, dict) and "horses" in result:
                        all_horses.extend(result["horses"])
                
                horses = all_horses
                logger.info(f"[OCR] OpenAI extracted {len(horses)} horses from {len(files)} files")
                
            except asyncio.TimeoutError:
                return JSONResponse(
                    status_code=504,
                    content={
                        "ok": False,
                        "error": {"code": "OCR_TIMEOUT", "message": "OCR request timed out", "detail": {"timeout": 25}}
                    }
                )
            except ImportError as e:
                return JSONResponse(
                    status_code=503,
                    content={
                        "ok": False,
                        "error": {"code": "OCR_UNAVAILABLE", "message": "OCR service not available", "detail": str(e)}
                    }
                )
            except Exception as e:
                logger.exception("[OCR] OpenAI OCR failed")
                return JSONResponse(
                    status_code=502,
                    content={
                        "ok": False,
                        "error": {"code": "OCR_PROVIDER_ERROR", "message": "OCR provider failed", "detail": str(e)[:200]}
                    }
                )
        
        elif settings.OCR_PROVIDER in ("web", "tesseract"):
            # TODO: Wire up tesseract or web-based OCR
            logger.warning(f"[OCR] Provider '{settings.OCR_PROVIDER}' not yet implemented, returning empty")
            horses = []
        
        else:
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "error": {
                        "code": "BAD_PROVIDER",
                        "message": f"Unknown provider: {settings.OCR_PROVIDER}",
                        "detail": {}
                    }
                }
            )
        
        # 6) Success
        return JSONResponse({"ok": True, "horses": horses})
    
    except HTTPException as e:
        return JSONResponse(
            status_code=e.status_code,
            content={"ok": False, "error": {"code": "HTTP_EXCEPTION", "message": e.detail}}
        )
    except Exception as e:
        # Never return non-JSON. Give structured error:
        logger.exception("[OCR] Unhandled exception")
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": {"code": "OCR_FAILURE", "message": "OCR failed", "detail": str(e)[:200]}
            }
        )

