import os, base64, json
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

app = FastAPI()

PROVIDER = os.getenv("FINISHLINE_DATA_PROVIDER", "stub").strip().lower()

def stub_extract():
    race = {
        "date": "10/21/2025",
        "track": "Churchill Downs",
        "surface": "Dirt",
        "distance": "1 1/4 miles"
    }
    horses = [
        {"name": "Clarita", "odds": "10/1", "jockey": "Luis Saez", "trainer": "Philip A. Bauer"},
        {"name": "Absolute Honor", "odds": "5/2", "jockey": "Tyler Gaffalione", "trainer": "Saffie A. Joseph, Jr."},
        {"name": "Indict", "odds": "8/1", "jockey": "Cristian A. Torres", "trainer": "Thomas Drury, Jr."},
        {"name": "Jewel Box", "odds": "15/1", "jockey": "Luan Machado", "trainer": "Ian R. Wilkes"}
    ]
    return {
        "ok": True,
        "race": race,
        "horses": horses,
        "debug": {"provider": "stub"}
    }

@app.post("/api/photo_extract_openai_b64")
async def photo_extract_openai_b64(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty file")
        # Stub response for now (replace with OCR later)
        return JSONResponse(stub_extract())
    except HTTPException as he:
        return JSONResponse({"ok": False, "error": he.detail}, status_code=he.status_code)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)