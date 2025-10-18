import os
import base64
import json
from typing import List, Dict, Any, Optional

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from pydantic import BaseModel
from openai import OpenAI
from PIL import Image
from io import BytesIO

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set.")

client = OpenAI(api_key=OPENAI_API_KEY)

class ExtractResponse(BaseModel):
    ok: bool
    horses: List[Dict[str, Any]] = []
    meta: Dict[str, Any] = {}
    error: Optional[str] = None

def _bad_request(msg: str) -> JSONResponse:
    return JSONResponse(ExtractResponse(ok=False, error=msg).model_dump(), status_code=400)

def _server_error(msg: str) -> JSONResponse:
    return JSONResponse(ExtractResponse(ok=False, error=msg).model_dump(), status_code=500)

def _read_image_from_upload(form: dict) -> Optional[bytes]:
    file = form.get("file")
    if file and hasattr(file, "read"):
        return file.read()
    return None

def _read_image_from_base64(form: dict) -> Optional[bytes]:
    b64 = form.get("b64")
    if not b64:
        return None
    try:
        if "," in b64 and b64.strip().startswith("data:"):
            b64 = b64.split(",", 1)[1]
        return base64.b64decode(b64)
    except Exception:
        return None

def _validate_image_bytes(data: bytes) -> bytes:
    try:
        Image.open(BytesIO(data)).verify()
        return data
    except Exception:
        # Still attempt OCR; image could be valid enough for the model.
        return data

async def photo_extract(request: Request) -> Response:
    try:
        if request.method != "POST":
            return _bad_request("POST required")

        content_type = request.headers.get("content-type", "")
        form_data = {}

        if "multipart/form-data" in content_type:
            form = await request.form()
            form_data = dict(form)
        else:
            try:
                form_data = await request.json()
            except Exception:
                form_data = {}

        img_bytes = _read_image_from_upload(form_data) or _read_image_from_base64(form_data)
        if not img_bytes:
            return _bad_request("No image provided. Send multipart 'file' or JSON 'b64'.")

        img_bytes = _validate_image_bytes(img_bytes)

        system = (
            "You are an OCR specialist for horse-race program sheets. "
            "Extract a structured list of horses with fields: "
            "name, odds (string, e.g., '5/2' or '10/1'), jockey (full name), trainer (full name). "
            "Return JSON only with key 'horses'."
        )
        user_instructions = (
            "Read the attached race sheet image. If some fields are missing, leave them as empty strings. "
            "Do not invent entries. Preserve odds formatting exactly."
        )

        img_b64 = base64.b64encode(img_bytes).decode("utf-8")
        img_part = {
            "type": "input_image",
            "image": {
                "data": img_b64,
                "mime_type": "image/png"
            }
        }

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": [{"type": "text", "text": user_instructions}, img_part]}
        ]

        completion = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=1200,
        )

        text = completion.choices[0].message.content.strip()

        horses: List[Dict[str, Any]] = []
        try:
            if text.startswith("```"):
                # strip possible code fences
                text = text.strip("`")
                text = text[text.find("\n")+1:] if "\n" in text else text
            parsed = json.loads(text)
            horses = parsed.get("horses", []) if isinstance(parsed, dict) else []
        except Exception:
            horses = []

        return JSONResponse(
            ExtractResponse(ok=True, horses=horses, meta={"model": MODEL}).model_dump(),
            status_code=200,
        )

    except Exception as e:
        print("photo_extract_openai_b64 error:", repr(e))
        return _server_error(f"OCR server error: {e.__class__.__name__}")

routes = [
    Route("/api/photo_extract_openai_b64", endpoint=photo_extract, methods=["POST"])
]
app = Starlette(routes=routes)