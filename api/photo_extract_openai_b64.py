import os, base64, json
from io import BytesIO
from typing import List, Dict, Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from pydantic import BaseModel

# Try to import OpenAI and PIL with fallback
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError as e:
    print(f"OpenAI import failed: {e}")
    OPENAI_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError as e:
    print(f"PIL import failed: {e}")
    PIL_AVAILABLE = False

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

if OPENAI_AVAILABLE and OPENAI_API_KEY:
    client = OpenAI(api_key=OPENAI_API_KEY)
else:
    client = None

class OCRResponse(BaseModel):
    ok: bool
    horses: List[Dict[str, Any]] = []
    error: str = ""

async def photo_extract(req: Request):
    try:
        if req.method != "POST":
            return JSONResponse({"ok": False, "error": "POST required"}, 405)

        # Check if dependencies are available
        if not OPENAI_AVAILABLE:
            return JSONResponse({"ok": False, "error": "OpenAI library not available"}, 500)
        
        if not PIL_AVAILABLE:
            return JSONResponse({"ok": False, "error": "PIL library not available"}, 500)
            
        if not client:
            return JSONResponse({"ok": False, "error": "OpenAI client not initialized"}, 500)

        content_type = req.headers.get("content-type", "")
        data = {}

        if "multipart/form-data" in content_type:
            form = await req.form()
            data = dict(form)
        else:
            try:
                data = await req.json()
            except Exception:
                pass

        img_bytes = None
        if "file" in data and hasattr(data["file"], "read"):
            img_bytes = data["file"].read()
        elif "b64" in data:
            b64 = data["b64"].split(",", 1)[-1]
            img_bytes = base64.b64decode(b64)

        if not img_bytes:
            return JSONResponse({"ok": False, "error": "No image received"}, 400)

        try:
            Image.open(BytesIO(img_bytes)).verify()
        except Exception:
            print("[warn] file validation failed — continuing anyway")

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
        except Exception:
            return JSONResponse({"ok": False, "error": "Bad OCR parse", "raw": raw}, 500)

        return JSONResponse({"ok": True, "horses": horses}, 200)

    except Exception as e:
        print("photo_extract_openai_b64.py crashed:", e)
        return JSONResponse({"ok": False, "error": str(e)}, 500)

routes = [Route("/api/photo_extract_openai_b64", photo_extract, methods=["POST"])]
app = Starlette(routes=routes)