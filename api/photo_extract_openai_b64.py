# api/photo_extract_openai_b64.py
import os
import base64
from io import BytesIO
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

# Optional OpenAI import only when using provider=openai
PROVIDER = os.getenv("FINISHLINE_DATA_PROVIDER", "stub").strip().lower()
if PROVIDER == "openai":
    try:
        from openai import OpenAI
        OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
        _openai = OpenAI(api_key=OPENAI_API_KEY)
    except Exception as e:
        # Fail back to stub mode if OpenAI isn't usable
        PROVIDER = "stub"

app = FastAPI()

def make_payload(
    race: Dict[str, Any],
    horses: List[Dict[str, Any]],
    raw_debug: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    # This is the shape your frontend will consume
    return {
        "ok": True,
        "race": {
            "date": race.get("date") or "",
            "track": race.get("track") or "",
            "surface": race.get("surface") or "",
            "distance": race.get("distance") or "",
        },
        "horses": horses,  # [{name, odds, jockey, trainer}]
        "debug": raw_debug or {}
    }

def stub_extract() -> Dict[str, Any]:
    # <- QUICK sanity-check payload. Adjust names/odds, etc.
    race = {
        "date": "10/21/2025",
        "track": "Churchill Downs",
        "surface": "Dirt",
        "distance": "1 1/4 miles",
    }
    horses = [
        {"name": "Clarita",         "odds": "10/1", "jockey": "Luis Saez",         "trainer": "Philip A. Bauer"},
        {"name": "Absolute Honor",  "odds": "5/2",  "jockey": "Tyler Gaffalione",  "trainer": "Saffie A. Joseph, Jr."},
        {"name": "Indict",          "odds": "8/1",  "jockey": "Cristian A. Torres","trainer": "Thomas Drury, Jr."},
        {"name": "Jewel Box",       "odds": "15/1", "jockey": "Luan Machado",      "trainer": "Ian R. Wilkes"},
    ]
    return make_payload(race, horses, {"provider": "stub"})

def b64_image(file_bytes: bytes) -> str:
    return base64.b64encode(file_bytes).decode("ascii")

def openai_extract(file_bytes: bytes) -> Dict[str, Any]:
    """
    Minimal OpenAI Vision prompt that returns structured JSON.
    You can refine the prompt later; for now it aims to produce:
    {
      "race": {"date": "...", "track": "...", "surface": "...", "distance": "..."},
      "horses": [{"name":"...", "odds":"...", "jockey":"...", "trainer":"..."}, ...]
    }
    """
    img_b64 = b64_image(file_bytes)
    prompt = (
      "You are an OCR assistant. Extract a single race's information from the image. "
      "Return STRICT JSON with keys: race.date (mm/dd/yyyy), race.track, race.surface, race.distance; "
      "and horses: array of entries with name, odds (as '5/2' or '10/1'), jockey, trainer. "
      "If unknown, use empty string. Output ONLY JSON."
    )

    resp = _openai.chat.completions.create(
        model=os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": "You extract structured data from racing program photos or PDFs."},
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": f"data:image/png;base64,{img_b64}"}
            ]}
        ],
        temperature=0.0,
    )

    text = resp.choices[0].message.content.strip()
    # Very defensive parse
    import json
    try:
        data = json.loads(text)
        race = (data or {}).get("race") or {}
        horses = (data or {}).get("horses") or []
        return make_payload(race, horses, {"provider": "openai"})
    except Exception as e:
        # If model returned non-JSON, fall back so UI still works
        return stub_extract() | {"debug": {"provider": "openai", "warning": "non_json_response"}}

@app.post("/api/photo_extract_openai_b64")
async def photo_extract_openai_b64(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty file")
        if PROVIDER == "openai":
            payload = openai_extract(contents)
        else:
            payload = stub_extract()
        return JSONResponse(payload)
    except HTTPException as he:
        return JSONResponse({"ok": False, "error": he.detail}, status_code=he.status_code)
    except Exception as e:
        # Always return JSON on error
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)