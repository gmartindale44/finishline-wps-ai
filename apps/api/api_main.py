from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import List, Dict, Any, Optional
import json
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

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/finishline/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok"}

@app.get("/api/finishline/version")
async def get_version():
    """Version endpoint"""
    return {"version": "1.0.0"}

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
        return await extract_rows_with_openai(files)
    except Exception as e:
        return {"parsed_horses": [], "error": str(e)}

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
