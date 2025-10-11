from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from typing import List, Dict, Any, Optional
import json
import os
from .odds import ml_to_fraction, ml_to_prob
from .scoring import calculate_predictions
from .ocr_stub import analyze_photos
from .provider_base import get_provider
from .research_scoring import calculate_research_predictions
from .openai_ocr import extract_rows_with_openai

app = FastAPI(
    title="FinishLine WPS AI",
    description="Win/Place/Show horse race prediction API",
    version="1.0.0"
)

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

@app.get("/api/finishline/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok"}

@app.get("/api/finishline/version")
async def get_version():
    """Version endpoint"""
    return {"version": "1.0.0"}

@app.get("/api/finishline/debug_info")
async def debug_info():
    """
    Debug info endpoint - returns safe runtime configuration (no secrets)
    """
    return {
        "allowed_origins": allow_origins,
        "provider": os.getenv("FINISHLINE_DATA_PROVIDER", "stub"),
        "ocr_enabled": os.getenv("FINISHLINE_OCR_ENABLED", "true"),
        "openai_model": os.getenv("FINISHLINE_OPENAI_MODEL", "unset"),
        "tavily_present": bool(os.getenv("FINISHLINE_TAVILY_API_KEY")),
        "openai_present": bool(os.getenv("FINISHLINE_OPENAI_API_KEY"))
    }

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

@app.post("/api/finishline/photo_extract_openai_b64")
async def photo_extract_openai_b64(body: Dict[str, Any]):
    """
    Extract horses from base64-encoded image (bypasses multipart upload issues)
    Input: {"filename": "race.png", "mime": "image/png", "data_b64": "base64..."}
    Returns: {"horses": [...]}
    Server-side timeout: 25s (configurable via FINISHLINE_PROVIDER_TIMEOUT_MS)
    """
    import asyncio
    import logging
    from .openai_ocr import run_openai_ocr_on_bytes, decode_data_url_or_b64
    
    logger = logging.getLogger("finishline")
    logger.setLevel(logging.INFO)
    
    # Fail fast if OCR disabled or API key missing
    ocr_enabled = os.getenv("FINISHLINE_OCR_ENABLED", "true").lower() not in ("false", "0", "no", "off")
    if not ocr_enabled:
        logger.warning("[photo_extract_openai_b64] OCR disabled")
        return JSONResponse({"error": "OCR disabled", "horses": []}, status_code=400)
    
    if not (os.getenv("FINISHLINE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")):
        logger.error("[photo_extract_openai_b64] Missing OpenAI API key")
        return JSONResponse({"error": "Missing OpenAI API key env", "horses": []}, status_code=500)
    
    try:
        filename = body.get("filename", "image.jpg")
        mime = body.get("mime", "image/jpeg")
        data_b64 = body.get("data_b64", "")
        
        if not data_b64:
            logger.warning("[photo_extract_openai_b64] missing data_b64 in payload")
            return JSONResponse(
                {"error": "missing data_b64", "horses": []},
                status_code=400
            )
        
        content = decode_data_url_or_b64(data_b64)
        kb = round(len(content) / 1024, 1)
        logger.info(f"[photo_extract_openai_b64] file={filename} mime={mime} size={kb}KB")
        
        # Timeout from env var (default 25s to align with client)
        timeout_ms = int(os.getenv("FINISHLINE_PROVIDER_TIMEOUT_MS", "25000"))
        logger.info(f"[photo_extract_openai_b64] timeout={timeout_ms}ms")
        
        async def _run():
            return await run_openai_ocr_on_bytes(content, filename=filename)
        
        result = await asyncio.wait_for(_run(), timeout=timeout_ms / 1000.0)
        
        if not isinstance(result, dict) or "horses" not in result:
            logger.warning(f"[photo_extract_openai_b64] bad OCR shape: {type(result)}")
            return JSONResponse({"error": "Bad OCR shape", "horses": []}, status_code=502)
        
        horses = result.get("horses") or []
        if not horses:
            logger.warning("[photo_extract_openai_b64] OCR returned 0 horses")
        
        logger.info(f"[photo_extract_openai_b64] success: {len(horses)} horses")
        return JSONResponse({"horses": horses}, status_code=200)
    
    except asyncio.TimeoutError:
        logger.error(f"[photo_extract_openai_b64] timeout after {timeout_ms}ms")
        return JSONResponse({"error": "OCR timed out", "horses": []}, status_code=504)
    except Exception as e:
        logger.exception("[photo_extract_openai_b64] exception")
        return JSONResponse({"error": str(e), "horses": []}, status_code=500)

@app.post("/api/finishline/research_predict")
async def research_predict(payload: Dict[str, Any]):
    """
    Research-enhanced Win/Place/Show predictions using custom data provider.
    Strictly limited to horses provided in the request (no off-list suggestions).
    """
    import logging
    logger = logging.getLogger("finishline")
    
    try:
        horses = payload.get("horses", [])
        race_context = payload.get("race_context", {})
        use_research = bool(payload.get("useResearch", True))
        
        if not horses:
            return JSONResponse(
                {"error": "No horses provided"},
                status_code=400
            )
        
        # Whitelist of allowed names (exact form names)
        allowed = {(h.get("name") or "").strip(): h for h in horses if (h.get("name") or "").strip()}
        if not allowed:
            return JSONResponse(
                {"error": "No valid horses provided"},
                status_code=400
            )
        
        # Extract race context
        date = race_context.get("raceDate", race_context.get("date", ""))
        track = race_context.get("track", "")
        surface = race_context.get("surface", "dirt")
        distance = race_context.get("distance", "")
        
        logger.info(f"[research_predict] horses={list(allowed.keys())} track={track} useResearch={use_research}")
        
        # Get configured provider
        provider = get_provider()
        
        # Enrich horses with research data
        enriched_horses = provider.enrich_horses(
            horses,
            date=date,
            track=track
        )
        
        # Calculate research-enhanced predictions
        predictions = calculate_research_predictions(enriched_horses)
        
        # CRITICAL: Ensure predictions only reference horses from the allowed list
        # Filter any off-list suggestions
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
        
        return {
            "win": predictions["win"],
            "place": predictions["place"],
            "show": predictions["show"],
            "enrichment_source": predictions.get("enrichment_source", "unknown"),
            "candidate_pool": list(allowed.keys()),
            "race_context": {
                "date": date,
                "track": track,
                "surface": surface,
                "distance": distance
            }
        }
    
    except Exception as e:
        logger.exception("[research_predict] exception")
        return JSONResponse(
            status_code=500, 
            content={"error": "research_predict_failed", "detail": str(e)}
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
