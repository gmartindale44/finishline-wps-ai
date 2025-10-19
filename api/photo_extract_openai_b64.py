import os
import json
import base64
import traceback
from io import BytesIO
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from PIL import Image
from openai import OpenAI

# Try both possible env var names
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or os.getenv("finishline_openai_api_key")
MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

app = FastAPI(title="FinishLine WPS AI")

def _error(status: int, msg: str, extra: Optional[dict] = None):
    body = {"ok": False, "error": msg}
    if extra:
        body.update(extra)
    return JSONResponse(body, status_code=status)

@app.get("/api/healthz")
def healthz():
    return {
        "ok": True,
        "runtime": "python-3.11",
        "has_key": bool(OPENAI_API_KEY),
        "model": MODEL,
        "key_prefix": OPENAI_API_KEY[:6] + "..." if OPENAI_API_KEY else None,
    }

class OCRResponse(BaseModel):
    ok: bool
    horses: List[Dict[str, Any]] = []
    error: str = ""

@app.post("/api/photo_extract_openai_b64")
async def photo_extract(file: UploadFile = File(None), b64: str = Form(None)):
    try:
        if not OPENAI_API_KEY:
            return _error(500, "OpenAI API key not configured", {"debug": "No API key found"})

        client = OpenAI(api_key=OPENAI_API_KEY)

        img_bytes = None
        if file:
            img_bytes = await file.read()
        elif b64:
            if "," in b64:
                b64 = b64.split(",", 1)[-1]
            img_bytes = base64.b64decode(b64)

        if not img_bytes:
            return _error(400, "No image received")

        try:
            Image.open(BytesIO(img_bytes)).verify()
        except Exception as e:
            print(f"[warn] file validation failed: {e}")

        prompt = (
            "Extract all horses from this race sheet as JSON with fields "
            "name, odds, jockey, trainer. Return JSON only."
        )

        img_b64 = base64.b64encode(img_bytes).decode("utf-8")
        completion = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are an OCR parser for race sheets."},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": f"data:image/png;base64,{img_b64}",
                        },
                    ],
                },
            ],
            temperature=0.2,
            max_tokens=900,
        )

        raw = completion.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            raw = raw[raw.find("\n") + 1 :]

        try:
            horses = json.loads(raw).get("horses", [])
        except Exception as e:
            return _error(500, "Bad OCR parse", {"raw": raw, "parse_error": str(e)})

        return JSONResponse({"ok": True, "horses": horses}, 200)

    except Exception as e:
        print(f"photo_extract_openai_b64.py crashed: {e}")
        print(traceback.format_exc())
        return _error(500, f"OCR server error: {str(e)}")