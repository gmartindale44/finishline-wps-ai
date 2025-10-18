import os, base64, json
from io import BytesIO
from typing import List, Dict, Any, Optional

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from pydantic import BaseModel
from openai import OpenAI
from PIL import Image

# --- Load API Key ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set")

client = OpenAI(api_key=OPENAI_API_KEY)

class ExtractResponse(BaseModel):
    ok: bool
    horses: List[Dict[str, Any]] = []
    error: Optional[str] = None
    meta: Dict[str, Any] = {}

def _error(status: int, msg: str):
    print(f"[photo_extract] ERROR: {msg}")
    return JSONResponse({"ok": False, "error": msg}, status_code=status)

async def handler(req: Request):
    try:
        if req.method != "POST":
            return _error(405, "POST required")

        form_data = {}
        content_type = req.headers.get("content-type", "")

        if "multipart/form-data" in content_type:
            form = await req.form()
            form_data = dict(form)
        else:
            try:
                form_data = await req.json()
            except Exception:
                pass

        # Try both multipart and base64
        img_bytes = None
        if "file" in form_data and hasattr(form_data["file"], "read"):
            img_bytes = form_data["file"].read()
        elif "b64" in form_data:
            b64 = form_data["b64"]
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            img_bytes = base64.b64decode(b64)

        if not img_bytes:
            return _error(400, "No image data received")

        # Validate
        try:
            Image.open(BytesIO(img_bytes)).verify()
        except Exception:
            print("[photo_extract] Warning: non-image bytes provided; continuing anyway")

        # ---- OCR Prompt ----
        prompt = (
            "Extract all horses, odds, jockeys, and trainers from this race program. "
            "Return only JSON: {\"horses\": [{\"name\":\"Clarita\",\"odds\":\"10/1\",\"jockey\":\"Luis Saez\",\"trainer\":\"Philip Bauer\"}]} "
            "Do not include explanations."
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
            max_tokens=1000,
        )

        raw = completion.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            raw = raw[raw.find("\n") + 1 :]

        try:
            parsed = json.loads(raw)
        except Exception:
            print("[photo_extract] Failed JSON parse, returning raw text")
            return _error(500, f"OCR returned unparseable data: {raw[:200]}")

        horses = parsed.get("horses", [])
        if not horses:
            return _error(500, "No horses found in image")

        return JSONResponse(
            ExtractResponse(ok=True, horses=horses, meta={"model": MODEL}).model_dump(),
            status_code=200,
        )

    except Exception as e:
        return _error(500, f"OCR server crash: {e}")

routes = [Route("/api/photo_extract_openai_b64", handler, methods=["POST"])]
app = Starlette(routes=routes)