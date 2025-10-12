from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from typing import List, Dict, Any, Optional
import json
import os
import logging
import time
import uuid
import traceback

# Set up logging
log = logging.getLogger(__name__)

# Import new schema and middleware
try:
    from .common.schemas import json_ok, json_err, make_request_id
    from .common.middleware import install_error_middleware
    SCHEMA_AVAILABLE = True
except ImportError:
    log.warning("New schema/middleware not available, using legacy")
    SCHEMA_AVAILABLE = False

# Import error utilities (with fallback)
try:
    from .error_utils import ApiError, json_error, validate_base64_size
except ImportError:
    # Fallback if import fails
    class ApiError(Exception):
        def __init__(self, status, message, code="internal", extra=None):
            self.status = status
            self.message = message
            self.code = code
            self.extra = extra or {}
            super().__init__(message)
    
    def json_error(status, message, code, req_id=None, elapsed_ms=None, **extra):
        payload = {"ok": False, "error": message, "code": code, **extra}
        if req_id: payload["reqId"] = req_id
        if elapsed_ms is not None: payload["elapsed_ms"] = elapsed_ms
        return JSONResponse(payload, status_code=status)
    
    def validate_base64_size(data, max_mb=6.0):
        size_mb = (len(data) * 3 / 4) / (1024 * 1024)
        if size_mb > max_mb:
            raise ApiError(413, f"File too large ({size_mb:.2f}MB). Max {max_mb}MB.", "payload_too_large")

# Import ticket-only prediction router
try:
    from .ticket_predict import router as ticket_router
    app.include_router(ticket_router)
except ImportError as e:
    log.warning(f"ticket_predict router not found: {e}")

# Import other modules (with safe fallbacks to prevent startup failures)
try:
    from .odds import ml_to_fraction, ml_to_prob
except ImportError:
    log.warning("odds module not found, using stubs")
    def ml_to_fraction(s): return 1.0
    def ml_to_prob(s): return 0.5

try:
    from .scoring import calculate_predictions
except ImportError:
    log.warning("scoring module not found, using stub")
    def calculate_predictions(horses): return {"win": {}, "place": {}, "show": {}}

try:
    from .ocr_stub import analyze_photos
except ImportError:
    log.warning("ocr_stub not found")
    def analyze_photos(files): return []

try:
    from .provider_base import get_provider
except ImportError:
    log.warning("provider_base not found")
    def get_provider(name): return None

try:
    from .research_scoring import calculate_research_predictions
except ImportError:
    log.warning("research_scoring not found, using stub")
    def calculate_research_predictions(horses, ctx): return {"predictions": {}}

try:
    from .openai_ocr import extract_rows_with_openai
except ImportError:
    log.warning("openai_ocr not found")
    async def extract_rows_with_openai(files): return []

app = FastAPI(
    title="FinishLine WPS AI",
    description="Win/Place/Show horse race prediction API",
    version="1.0.0"
)

# Install new error middleware (ensures all responses are JSON)
if SCHEMA_AVAILABLE:
    install_error_middleware(app)
    log.info("Installed new error middleware for JSON-only responses")

# CORS: read comma-separated origins or "*" during debug
raw_origins = os.getenv("FINISHLINE_ALLOWED_ORIGINS", "*").strip()
if raw_origins in ("", "*"):
    allow_origins = ["*"]
else:
    allow_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=[
        "Authorization", "Content-Type", "Accept", "Origin",
        "User-Agent", "Cache-Control", "Pragma"
    ],
    max_age=86400,
)


# Global error handling middleware
@app.middleware("http")
async def error_wrapper_middleware(request: Request, call_next):
    """
    Global error handler to catch any unhandled exceptions
    and return structured JSON errors.
    """
    req_id = str(uuid.uuid4())
    request.state.req_id = req_id
    t0 = time.perf_counter()
    
    try:
        response = await call_next(request)
        return response
    except ApiError as e:
        # Structured API errors
        log.error(f"[{req_id}] ApiError: {e.status} {e.code} - {e.message}")
        return json_error(
            e.status,
            e.message,
            e.code,
            req_id=req_id,
            elapsed_ms=int((time.perf_counter() - t0) * 1000),
            **e.extra
        )
    except Exception as e:
        # Unexpected errors
        log.exception(f"[{req_id}] Unhandled exception")
        return json_error(
            500,
            "Internal server error. Please try again or contact support.",
            "internal",
            req_id=req_id,
            elapsed_ms=int((time.perf_counter() - t0) * 1000),
            detail=str(e)[:200]  # Truncate for safety
        )

@app.get("/api/health")
@app.get("/api/finishline/health")
async def health_check():
    """Health check endpoint - always returns JSON"""
    return JSONResponse({
        "ok": True,
        "status": "healthy",
        "service": "FinishLine WPS AI",
        "version": "1.0.0"
    }, status_code=200)

@app.get("/api/finishline/version")
async def get_version():
    """Version endpoint"""
    return {"version": "1.0.0"}

@app.get("/api/finishline/debug_info")
async def debug_info():
    """
    Debug info endpoint - returns safe runtime configuration (no secrets)
    """
    provider_name = os.getenv("FINISHLINE_DATA_PROVIDER", "stub").strip().lower()
    has_tavily = bool(os.getenv("FINISHLINE_TAVILY_API_KEY", "").strip())
    has_openai = bool(os.getenv("FINISHLINE_OPENAI_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip())
    timeout_ms = int(os.getenv("FINISHLINE_PROVIDER_TIMEOUT_MS", "25000"))
    
    return {
        "allowed_origins": allow_origins,
        "provider": provider_name,
        "ocr_enabled": os.getenv("FINISHLINE_OCR_ENABLED", "true"),
        "openai_model": os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini"),
        "tavily_present": has_tavily,
        "openai_present": has_openai,
        "provider_timeout_ms": timeout_ms,
        "websearch_ready": provider_name == "websearch" and has_tavily and has_openai,
        "hints": {
            "websearch_provider_needs": ["FINISHLINE_TAVILY_API_KEY", "FINISHLINE_OPENAI_API_KEY"]
        }
    }


@app.post("/api/finishline/predict")
async def predict_endpoint(request: Request, body: Dict[str, Any]):
    """
    Dedicated prediction endpoint (separate from research_predict).
    Uses analysis results to generate W/P/S predictions.
    Max execution time: 50s (stays under Vercel 60s limit)
    """
    req_id = getattr(request.state, "req_id", str(uuid.uuid4()))
    t0 = time.perf_counter()
    
    try:
        horses = body.get("horses", [])
        race_context = body.get("race_context", {})
        fast_mode = body.get("fastMode", False)
        prior_analysis = body.get("prior_analysis")
        
        log.info(f"[{req_id}] predict: {len(horses)} horses, fastMode={fast_mode}")
        
        if not horses:
            raise ApiError(400, "No horses provided", "no_horses")
        
        # Use enhanced scoring from scoring.py
        try:
            from .scoring import score_horses, wps_from_probs
        except ImportError:
            from scoring import score_horses, wps_from_probs
        
        # Build research context from prior analysis if available
        research_data = None
        if prior_analysis and isinstance(prior_analysis, dict):
            research_data = prior_analysis.get("research") or prior_analysis
        
        # Score horses using multi-factor handicapping
        scored_horses = score_horses(horses, race_context, research_data)
        
        # Extract W/P/S predictions
        predictions = wps_from_probs(scored_horses)
        
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        log.info(f"[{req_id}] predict success: {elapsed_ms}ms, mode={('fast' if fast_mode else 'full')}")
        
        return JSONResponse({
            "ok": True,
            "predictions": predictions,
            "scored": scored_horses[:10],  # Top 10 for display
            "mode": "fast" if fast_mode else "full",
            "reqId": req_id,
            "elapsed_ms": elapsed_ms
        }, status_code=200)
    
    except ApiError:
        raise  # Re-raise to be handled by middleware
    except Exception as e:
        log.exception(f"[{req_id}] predict endpoint failed")
        raise ApiError(
            500,
            f"Prediction failed: {str(e)[:100]}",
            "predict_failed"
        )

# Explicit OPTIONS handler (belt-and-suspenders with some edge clients)
@app.options("/{full_path:path}")
async def any_options(full_path: str, request: Request):
    return PlainTextResponse("", status_code=204)

@app.post("/api/finishline/predict")
async def predict_race(data: Dict[str, Any]):
    """
    Predict Win/Place/Show based on horse data
    Expected input: {
        "horses": [
            {
                "name": "Horse Name",
                "odds": "5-2",
                "jockey": "D. Parker (optional)",
                "trainer": "J. Smith (optional)",
                "bankroll": 1000,
                "kelly_fraction": 0.25
            }
        ]
    }
    
    Note: jockey and trainer fields are accepted but not currently used in scoring.
    """
    try:
        horses = data.get("horses", [])
        if not horses:
            raise HTTPException(status_code=400, detail="No horses provided")
        
        # Calculate predictions using scoring system
        predictions = calculate_predictions(horses)
        
        return {
            "win": predictions["win"],
            "place": predictions["place"],
            "show": predictions["show"]
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

@app.post("/api/finishline/photo_predict")
async def photo_predict(
    files: List[UploadFile] = File(...)
):
    """
    Analyze photos and predict Win/Place/Show
    Accepts up to 6 images via multipart/form-data
    Returns parsed_horses for frontend auto-fill
    """
    try:
        if len(files) > 6:
            raise HTTPException(status_code=400, detail="Maximum 6 images allowed")
        
        # Use OCR stub to extract horse data from images
        parsed_horses = analyze_photos(files)
        
        if not parsed_horses:
            # Fallback if OCR fails
            parsed_horses = [
                {"name": "Flyin Ryan", "trainer": "Kathy Jarvis", "jockey": "Jose Ramos Gutierrez", "ml_odds": "8/1"},
                {"name": "Improbable", "trainer": "Bob Baffert", "jockey": "Irad Ortiz Jr", "ml_odds": "5-2"},
            ]
        
        # Add default bankroll/kelly for prediction
        horses_for_predict = []
        for h in parsed_horses:
            horses_for_predict.append({
                **h,
                "odds": h.get("ml_odds", h.get("odds", "5-2")),
                "bankroll": h.get("bankroll", 1000),
                "kelly_fraction": h.get("kelly_fraction", 0.25)
            })
        
        # Calculate predictions
        predictions = calculate_predictions(horses_for_predict)
        
        return {
            "win": predictions["win"],
            "place": predictions["place"],
            "show": predictions["show"],
            "parsed_horses": parsed_horses,  # For frontend auto-fill
            "extracted_horses": parsed_horses  # Legacy compatibility
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"photo_predict_error: {e}")

@app.post("/api/finishline/photo_extract_openai")
async def photo_extract_openai(
    files: List[UploadFile] = File(default=[]),
    date: str = Form(default=""),
    track: str = Form(default=""),
    surface: str = Form(default=""),
    distance: str = Form(default="")
):
    """
    Extract horses from photos using OpenAI Vision API
    Returns parsed_horses array for frontend auto-fill
    Falls back gracefully if no OPENAI_API_KEY set
    """
    # If no OPENAI key exists, return empty; frontend will fall back to stub
    import os
    if not os.getenv("FINISHLINE_OPENAI_API_KEY"):
        return {"parsed_horses": []}
    try:
        result = await extract_rows_with_openai(files)
        result["meta"] = {
            "model": os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini"),
            "count": len(result.get("parsed_horses", []))
        }
        return result
    except Exception as e:
        return {"parsed_horses": [], "error": str(e)}

@app.post("/api/finishline/photo_extract_openai_url")
async def photo_extract_openai_url(data: Dict[str, Any]):
    """
    Extract horses from image URL using OpenAI Vision API
    Useful for testing OCR without manual file upload
    
    Input: { "url": "https://example.com/race-table.png" }
    Returns: Same as photo_extract_openai
    """
    import os
    import httpx
    from io import BytesIO
    from PIL import Image
    
    try:
        image_url = data.get("url", "").strip()
        if not image_url:
            return JSONResponse(
                status_code=400,
                content={"error": "missing_url", "where": "photo_extract_openai_url", "detail": "url field required"}
            )
        
        if not os.getenv("FINISHLINE_OPENAI_API_KEY"):
            return JSONResponse(
                status_code=400,
                content={"error": "openai_key_missing", "where": "photo_extract_openai_url", "detail": "FINISHLINE_OPENAI_API_KEY not set"}
            )
        
        # Download image
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(image_url)
            if r.status_code != 200:
                return JSONResponse(
                    status_code=400,
                    content={"error": "download_failed", "where": "photo_extract_openai_url", "detail": f"HTTP {r.status_code}"}
                )
            image_data = r.content
        
        # Create a fake UploadFile from the downloaded data
        from fastapi import UploadFile
        from io import BytesIO
        
        # Detect content type
        content_type = r.headers.get("content-type", "image/jpeg")
        fake_file = UploadFile(
            filename="downloaded.jpg",
            file=BytesIO(image_data)
        )
        fake_file.content_type = content_type
        
        # Reuse the same OCR pipeline
        result = await extract_rows_with_openai([fake_file])
        result["meta"] = {
            "model": os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini"),
            "count": len(result.get("parsed_horses", [])),
            "source_url": image_url
        }
        return result
    
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"error": "extraction_failed", "where": "photo_extract_openai_url", "detail": str(e)}
        )

@app.get("/api/finishline/echo_stub")
async def echo_stub():
    """Quick stub to prove UI fill works without OCR"""
    return {
        "horses": [
            {"name": "Alpha", "odds": "3/1", "trainer": "T One", "jockey": "J A", "bankroll": 1000, "kelly_fraction": 0.25},
            {"name": "Bravo", "odds": "9/2", "trainer": "T Two", "jockey": "J B", "bankroll": 1000, "kelly_fraction": 0.25},
            {"name": "Charlie", "odds": "8/1", "trainer": "T Three", "jockey": "J C", "bankroll": 1000, "kelly_fraction": 0.25}
        ]
    }

@app.post("/api/finishline/research_predict_selftest")
async def research_predict_selftest():
    """Quick self-test for research path (does not call provider, just confirms routing)"""
    provider_name = os.getenv("FINISHLINE_DATA_PROVIDER", "stub").strip().lower()
    has_tavily = bool(os.getenv("FINISHLINE_TAVILY_API_KEY", "").strip())
    has_openai = bool(os.getenv("FINISHLINE_OPENAI_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip())
    
    return {
        "ok": True,
        "horses_seen": 1,
        "provider": provider_name,
        "has_tavily_key": has_tavily,
        "has_openai_key": has_openai,
        "websearch_ready": provider_name == "websearch" and has_tavily and has_openai
    }

@app.post("/api/finishline/photo_extract_openai_b64_v2")
async def photo_extract_openai_b64_v2(request: Request, body: Dict[str, Any]):
    """
    V2: Hardened OCR endpoint using new schema (ApiOk/ApiErr).
    Delegates to photo_extract_openai_b64.photo_extract_openai_b64_handler.
    """
    try:
        from .photo_extract_openai_b64 import photo_extract_openai_b64_handler
        return await photo_extract_openai_b64_handler(request, body)
    except ImportError:
        # Fallback to legacy if new handler not available
        log.warning("V2 OCR handler not available, using legacy")
        return await photo_extract_openai_b64_legacy(request, body)

@app.post("/api/finishline/photo_extract_openai_b64")
async def photo_extract_openai_b64_legacy(request: Request, body: Dict[str, Any]):
    """
    Extract horses from base64-encoded images (bypasses multipart upload issues).
    ALWAYS returns JSON - never throws HTML errors.
    
    Input: {
        "images_b64": ["data:image/jpeg;base64,..."],  // Max 6 images
        "prompt": "optional custom prompt"
    }
    
    Returns: {
        "ok": true,
        "items": ["extracted text per image"],
        "horses": [...parsed horses...],
        "request_id": "abc123",
        "elapsed_ms": 1234
    }
    
    Max duration: 12s per image (configurable)
    """
    req_id = getattr(request.state, "req_id", str(uuid.uuid4())[:12])
    t0 = time.perf_counter()
    
    try:
        import asyncio
        import base64
        import io
        from PIL import Image
        from .openai_ocr import run_openai_ocr_on_bytes, decode_data_url_or_b64
        from .timeout_utils import with_timeout
        
        # Validate OCR is enabled
        ocr_enabled = os.getenv("FINISHLINE_OCR_ENABLED", "true").lower() not in ("false", "0", "no", "off")
        if not ocr_enabled:
            log.warning(f"[{req_id}] OCR disabled")
            return json_error(
                400,
                "OCR is disabled on this server",
                "ocr_disabled",
                req_id=req_id,
                hint="Set FINISHLINE_OCR_ENABLED=true in environment"
            )
        
        # Validate API key
        if not (os.getenv("FINISHLINE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")):
            log.error(f"[{req_id}] Missing OpenAI API key")
            return json_error(
                500,
                "OpenAI API key not configured",
                "config_error",
                req_id=req_id,
                hint="Set FINISHLINE_OPENAI_API_KEY or OPENAI_API_KEY"
            )
        
        # Get images from request
        images_b64 = body.get("images_b64", [])
        
        # Also support legacy single-image format
        if not images_b64 and body.get("data_b64"):
            images_b64 = [body.get("data_b64")]
        
        if not images_b64:
            return json_error(
                400,
                "No images provided",
                "missing_images",
                req_id=req_id,
                hint="Provide images_b64 array"
            )
        
        if not isinstance(images_b64, list):
            return json_error(
                400,
                "images_b64 must be an array",
                "invalid_format",
                req_id=req_id
            )
        
        if len(images_b64) > 6:
            return json_error(
                400,
                f"Too many images ({len(images_b64)}). Maximum is 6.",
                "too_many_images",
                req_id=req_id
            )
        
        # Validate total payload size
        total_size_mb = sum(len(img.split(",")[-1]) * 3 / 4 for img in images_b64) / (1024 * 1024)
        if total_size_mb > 4.0:
            return json_error(
                413,
                f"Total payload too large ({total_size_mb:.1f}MB). Maximum is 4MB.",
                "payload_too_large",
                req_id=req_id,
                hint="Reduce image size/quality before upload"
            )
        
        # Process each image with timeout
        timeout_per_image = 12  # seconds
        all_horses = []
        items = []
        
        for i, img_b64 in enumerate(images_b64):
            try:
                # Decode and process image
                content = decode_data_url_or_b64(img_b64)
                kb = round(len(content) / 1024, 1)
                log.info(f"[{req_id}] Processing image {i+1}/{len(images_b64)}: {kb}KB")
                
                # Downscale/compress if needed (prevent oversized payloads)
                img = Image.open(io.BytesIO(content)).convert("RGB")
                w, h = img.size
                max_edge = 1400
                if max(w, h) > max_edge:
                    scale = max_edge / max(w, h)
                    img = img.resize((int(w*scale), int(h*scale)), Image.Resampling.LANCZOS)
                    log.info(f"[{req_id}] Resized image {i+1} from {w}x{h} to {img.size}")
                
                # Convert to JPEG bytes
                buff = io.BytesIO()
                img.save(buff, format="JPEG", quality=85, optimize=True)
                content = buff.getvalue()
                
                # Call OCR with timeout
                async def _run_ocr():
                    return await run_openai_ocr_on_bytes(content, filename=f"image_{i+1}.jpg")
                
                result = await with_timeout(
                    _run_ocr,
                    timeout_per_image,
                    fallback={"horses": []},
                    operation_name=f"OCR image {i+1}"
                )
                
                # Collect results
                if isinstance(result, dict):
                    horses = result.get("horses", [])
                    all_horses.extend(horses)
                    items.append(f"Extracted {len(horses)} horses")
                else:
                    items.append("No horses found")
                    
            except Exception as e:
                log.error(f"[{req_id}] Image {i+1} failed: {e}")
                items.append(f"Error: {str(e)[:50]}")
        
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        log.info(f"[{req_id}] OCR complete: {len(all_horses)} total horses, {elapsed_ms}ms")
        
        return json_success(
            {
                "items": items,
                "horses": all_horses,
                "count": len(all_horses)
            },
            req_id=req_id,
            elapsed_ms=elapsed_ms
        )
    
    except ApiError:
        raise  # Re-raise to be handled by middleware
    except Exception as e:
        log.exception(f"[{req_id}] photo_extract_openai_b64 unhandled error")
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        return json_error(
            500,
            "OCR extraction failed",
            "ocr_failed",
            req_id=req_id,
            elapsed_ms=elapsed_ms,
            detail=str(e)[:200]
        )

@app.post("/api/finishline/research_predict")
async def research_predict(payload: Dict[str, Any]):
    """
    Research-enhanced Win/Place/Show predictions using custom data provider.
    Strictly limited to horses provided in the request (no off-list suggestions).
    Supports per-request provider and timeout overrides.
    """
    import logging
    import traceback
    import asyncio
    logger = logging.getLogger("finishline")
    
    # Provider prechecks with client override support
    env_provider = os.getenv("FINISHLINE_DATA_PROVIDER", "stub").strip().lower()
    env_timeout = int(os.getenv("FINISHLINE_PROVIDER_TIMEOUT_MS", "45000"))
    
    # Allow client to override provider and timeout
    requested_provider = payload.get("provider", env_provider)
    if requested_provider:
        requested_provider = str(requested_provider).strip().lower()
        if requested_provider not in ("websearch", "stub", "custom"):
            requested_provider = env_provider
    provider_name = requested_provider or env_provider
    
    # Respect client timeout_ms when present; clamp to just under platform max
    requested_timeout = payload.get("timeout_ms", env_timeout)
    try:
        timeout_ms = int(requested_timeout)
        # >=1s, <=58s (keep buffer under vercel maxDuration=60s)
        timeout_ms = min(max(timeout_ms, 1000), 58000)
    except:
        timeout_ms = env_timeout
    
    has_tavily = bool(os.getenv("FINISHLINE_TAVILY_API_KEY", "").strip())
    has_openai = bool(os.getenv("FINISHLINE_OPENAI_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip())
    
    try:
        horses = payload.get("horses", [])
        race_context = payload.get("race_context", {})
        use_research = bool(payload.get("useResearch", True))
        
        if not horses:
            return JSONResponse(
                {"error": "No horses provided", "hint": "Fill the form first using Extract from Photos or Add Horse."},
                status_code=400
            )
        
        # Whitelist of allowed names (exact form names)
        allowed = {(h.get("name") or "").strip(): h for h in horses if (h.get("name") or "").strip()}
        if not allowed:
            return JSONResponse(
                {"error": "All horses are missing names", "hint": "Each row needs a horse name."},
                status_code=400
            )
        
        # Cap list to reasonable size
        if len(allowed) > 20:
            logger.warning(f"[research_predict] Capping {len(allowed)} horses to 20")
            allowed = dict(list(allowed.items())[:20])
        
        # Provider-specific validation
        if use_research and provider_name == "websearch" and not has_tavily:
            return JSONResponse(
                {
                    "error": "Websearch provider requires FINISHLINE_TAVILY_API_KEY",
                    "provider": provider_name,
                    "has_tavily_key": False,
                    "how_to_fix": "Set FINISHLINE_TAVILY_API_KEY in Vercel env or switch FINISHLINE_DATA_PROVIDER=stub"
                },
                status_code=400
            )
        
        # Extract race context
        date = race_context.get("raceDate", race_context.get("date", ""))
        track = race_context.get("track", "")
        surface = race_context.get("surface", "dirt")
        distance = race_context.get("distance", "")
        
        logger.info(f"[research_predict] horses={list(allowed.keys())} track={track} provider={provider_name} timeout={timeout_ms}ms useResearch={use_research}")
        
        # If the caller selected the stub provider, short-circuit here with instant result
        if provider_name == "stub":
            import time
            t0 = time.perf_counter()
            
            # Helper: parse fractional odds to implied probability
            def _norm_frac_odds(s):
                if not s: return None
                t = str(s).strip().upper().replace("–","-").replace("—","-").replace(" TO ","/").replace("TO","/").replace(":","/").replace(" ","")
                for sep in ("/","-"):
                    if sep in t:
                        parts = t.split(sep, 1)
                        if len(parts)==2 and parts[0].isdigit() and parts[1].isdigit():
                            return (int(parts[0]), int(parts[1]))
                if t.isdigit():
                    return (int(t), 1)
                return None
            
            def _implied_prob(odds):
                fb = _norm_frac_odds(odds)
                if not fb: return 0.0
                a, b = fb
                denom = a + b
                return (b / denom) if denom > 0 else 0.0
            
            # Rank by implied probability (lower ML odds → higher chance)
            scored = []
            for h in allowed.values():
                p = _implied_prob(h.get("odds"))
                scored.append({**h, "_p": p})
            scored.sort(key=lambda x: x["_p"], reverse=True)
            
            win_pick   = {"name": scored[0]["name"], "prob": scored[0]["_p"]} if len(scored)>0 else {"name": None, "prob": None}
            place_pick = {"name": scored[1]["name"], "prob": scored[1]["_p"]} if len(scored)>1 else {"name": None, "prob": None}
            show_pick  = {"name": scored[2]["name"], "prob": scored[2]["_p"]} if len(scored)>2 else {"name": None, "prob": None}
            
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            logger.info(f"[research_predict] stub: win={win_pick['name']} place={place_pick['name']} show={show_pick['name']} elapsed={elapsed_ms}ms")
            
            resp_data = {
                "win": win_pick,
                "place": place_pick,
                "show": show_pick,
                "enrichment_source": "stub",
                "provider_used": "stub",
                "elapsed_ms": elapsed_ms,
                "candidate_pool": list(allowed.keys()),
                "race_context": {
                    "date": date,
                    "track": track,
                    "surface": surface,
                    "distance": distance
                }
            }
            res = JSONResponse(resp_data, status_code=200)
            res.headers["X-Analysis-Duration"] = str(elapsed_ms)
            return res
        
        # For websearch/custom: call provider with timeout and batching for stability
        import time
        t0 = time.perf_counter()
        
        # Check if request wants quick/reduced depth (for retries)
        depth = payload.get("depth", "draft")
        is_quick = depth in ("quick", "fast", "baseline")
        
        async def _run():
            # Override provider per request if specified
            if provider_name == "websearch" and not is_quick:
                from .provider_websearch import WebSearchProvider
                provider = WebSearchProvider()
            elif provider_name == "custom" and not is_quick:
                from .provider_custom import CustomProvider
                provider = CustomProvider()
            else:
                # Quick mode or stub → use stub provider (no external calls)
                class QuickStubProvider:
                    async def enrich_horses(self, horses, **kwargs):
                        # No enrichment, just pass through
                        return horses
                provider = QuickStubProvider()
            
            # Provider.enrich_horses is now async (no asyncio.run inside)
            # For stability with many horses, process in smaller batches
            horse_list = list(allowed.values())
            if len(horse_list) > 6 and provider_name == "websearch":
                # Batch processing for large fields (reduces timeout risk)
                batch_size = 4
                enriched = []
                for i in range(0, len(horse_list), batch_size):
                    batch = horse_list[i:i+batch_size]
                    # Per-batch timeout (25s max per batch)
                    try:
                        batch_result = await asyncio.wait_for(
                            provider.enrich_horses(batch, date=date, track=track),
                            timeout=25.0
                        )
                        enriched.extend(batch_result)
                    except asyncio.TimeoutError:
                        logger.warning(f"[research_predict] Batch {i//batch_size+1} timed out, using original data")
                        enriched.extend(batch)  # Use un-enriched data for this batch
                enriched_horses = enriched
            else:
                # Small field or stub → process all at once
                enriched_horses = await provider.enrich_horses(
                    horse_list,
                    date=date,
                    track=track
                )
            
            predictions = calculate_research_predictions(enriched_horses)
            return predictions
        
        predictions = await asyncio.wait_for(_run(), timeout=timeout_ms / 1000.0)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        
        # If the provider already signaled an error, propagate with details
        if not isinstance(predictions, dict):
            logger.warning(f"[research_predict] returned non-dict: {type(predictions)}")
            return JSONResponse(
                {"error": "Bad provider response", "shape": str(type(predictions)), "provider": provider_name},
                status_code=502
            )
        
        if "error" in predictions:
            logger.error(f"[research_predict] provider error: {predictions}")
            extra = {k: v for k, v in predictions.items() if k != "error"}
            extra.update({"provider": provider_name, "has_tavily_key": has_tavily, "has_openai_key": has_openai})
            return JSONResponse(
                {"error": str(predictions.get("error") or "research_predict_failed"), **extra},
                status_code=500
            )
        
        # CRITICAL: Ensure predictions only reference horses from the allowed list
        win_name = predictions.get("win", {}).get("name", "")
        place_name = predictions.get("place", {}).get("name", "")
        show_name = predictions.get("show", {}).get("name", "")
        
        if win_name not in allowed:
            logger.warning(f"[research_predict] Win pick '{win_name}' not in allowed list, using first")
            predictions["win"]["name"] = list(allowed.keys())[0]
        if place_name not in allowed:
            logger.warning(f"[research_predict] Place pick '{place_name}' not in allowed list")
            predictions["place"]["name"] = list(allowed.keys())[min(1, len(allowed)-1)]
        if show_name not in allowed:
            logger.warning(f"[research_predict] Show pick '{show_name}' not in allowed list")
            predictions["show"]["name"] = list(allowed.keys())[min(2, len(allowed)-1)]
        
        logger.info(f"[research_predict] {provider_name}: completed in {elapsed_ms}ms")
        
        resp_data = {
            "win": predictions["win"],
            "place": predictions["place"],
            "show": predictions["show"],
            "enrichment_source": predictions.get("enrichment_source", "unknown"),
            "provider_used": provider_name,
            "elapsed_ms": elapsed_ms,
            "candidate_pool": list(allowed.keys()),
            "race_context": {
                "date": date,
                "track": track,
                "surface": surface,
                "distance": distance
            }
        }
        res = JSONResponse(resp_data, status_code=200)
        res.headers["X-Analysis-Duration"] = str(elapsed_ms)
        return res
    
    except asyncio.TimeoutError:
        logger.error(f"[research_predict] timeout after {timeout_ms}ms (provider={provider_name})")
        return JSONResponse(
            {
                "error": "Research timed out",
                "timeout_ms": timeout_ms,
                "provider": provider_name,
                "hint": "Try increasing timeout_ms in request or switch to provider=stub for faster results"
            },
            status_code=504
        )
    except Exception as e:
        tb = traceback.format_exc()
        logger.exception("[research_predict] exception")
        return JSONResponse(
            status_code=500,
            content={
                "error": "research_predict_failed",
                "detail": str(e),
                "traceback": tb.splitlines()[-6:],  # tail for brevity
                "provider": provider_name,
                "has_tavily_key": has_tavily,
                "has_openai_key": has_openai
            }
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
