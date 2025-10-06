from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any
import json
from .odds import ml_to_fraction, ml_to_prob
from .scoring import calculate_predictions
from .ocr_stub import analyze_photos
from vercel_asgi import VercelASGI

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
                "bankroll": 1000,
                "kelly_fraction": 0.25
            }
        ]
    }
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
    """
    try:
        if len(files) > 6:
            raise HTTPException(status_code=400, detail="Maximum 6 images allowed")
        
        # Use OCR stub to extract horse data from images
        horses = analyze_photos(files)
        
        if not horses:
            # Fallback predictions if OCR fails
            horses = [
                {"name": "Thunderstride", "odds": "5-2", "bankroll": 1000, "kelly_fraction": 0.25},
                {"name": "Silver Blaze", "odds": "3-1", "bankroll": 1000, "kelly_fraction": 0.25},
                {"name": "Midnight Arrow", "odds": "6-1", "bankroll": 1000, "kelly_fraction": 0.25},
            ]
        
        # Calculate predictions
        predictions = calculate_predictions(horses)
        
        return {
            "win": predictions["win"],
            "place": predictions["place"],
            "show": predictions["show"],
            "extracted_horses": horses
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Photo analysis error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# Vercel ASGI handler
handler = VercelASGI(app)
