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

@app.post("/api/finishline/research_predict")
async def research_predict(data: Dict[str, Any]):
    """
    Research-enhanced Win/Place/Show predictions using custom data provider.
    
    Expected input: {
        "date": "2024-01-15",
        "track": "Churchill Downs",
        "surface": "dirt",
        "distance": "1 1/4 miles",
        "horses": [
            {
                "name": "Horse Name",
                "odds": "5-2",
                "trainer": "Trainer Name (optional)",
                "jockey": "Jockey Name (optional)",
                "bankroll": 1000,
                "kelly_fraction": 0.25
            }
        ]
    }
    
    Returns: Win/Place/Show predictions with research-enhanced scoring
    """
    try:
        horses = data.get("horses", [])
        if not horses:
            raise HTTPException(status_code=400, detail="No horses provided")
        
        # Extract race context
        date = data.get("date", "")
        track = data.get("track", "")
        surface = data.get("surface", "dirt")
        distance = data.get("distance", "")
        
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
        
        return {
            "win": predictions["win"],
            "place": predictions["place"],
            "show": predictions["show"],
            "enrichment_source": predictions.get("enrichment_source", "unknown"),
            "race_context": {
                "date": date,
                "track": track,
                "surface": surface,
                "distance": distance
            }
        }
    
    except Exception as e:
        return JSONResponse(
            status_code=500, 
            content={"error": "research_predict_failed", "detail": str(e)}
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
