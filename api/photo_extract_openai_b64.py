import os, base64, json
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

app = FastAPI()

PROVIDER = os.getenv("FINISHLINE_DATA_PROVIDER", "stub").strip().lower()

def stub_extract():
    horses = [
        {"name": "Clarita", "odds": "10/1", "jockey": "Luis Saez", "trainer": "Philip A. Bauer"},
        {"name": "Absolute Honor", "odds": "5/2", "jockey": "Tyler Gaffalione", "trainer": "Saffie A. Joseph, Jr."},
        {"name": "Indict", "odds": "8/1", "jockey": "Cristian A. Torres", "trainer": "Thomas Drury, Jr."},
        {"name": "Jewel Box", "odds": "15/1", "jockey": "Luan Machado", "trainer": "Ian R. Wilkes"}
    ]
    raw_text = """1. Clarita
10/1
Luis Saez
Philip A. Bauer

2. Absolute Honor
5/2
Tyler Gaffalione
Saffie A. Joseph, Jr.

3. Indict
8/1
Cristian A. Torres
Thomas Drury, Jr.

4. Jewel Box
15/1
Luan Machado
Ian R. Wilkes"""
    return {
        "ok": True,
        "horses": horses,
        "meta": {
            "raw_text": raw_text,
            "notes": "Stub data for testing"
        }
    }

@app.post("/api/photo_extract_openai_b64")
async def photo_extract_openai_b64(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        if not contents:
            return JSONResponse({"ok": False, "error": "Empty file"})
        
        # Get stub data
        result = stub_extract()
        horses_list = result["horses"]
        
        # Log the full array to confirm we're returning all horses
        print(f"[API] Returning {len(horses_list)} horses: {[h['name'] for h in horses_list]}")
        
        return JSONResponse({
            "ok": True,
            "horses": horses_list,   # list of dicts with all parsed horses
            "meta": {
                "raw_text": result["meta"]["raw_text"],
                "notes": f"Stub data: {len(horses_list)} horses returned"
            }
        })
    except Exception as e:
        print(f"[API] Error: {str(e)}")
        return JSONResponse({"ok": False, "error": str(e)})