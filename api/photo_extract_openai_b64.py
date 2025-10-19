import os, base64, json, traceback
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.datastructures import UploadFile
from typing import Tuple, Optional
from openai import AsyncOpenAI
from PIL import Image
from io import BytesIO

def _to_b64_str(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("ascii")

def _from_b64_str(b64: str) -> bytes:
    # allow data URLs
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)

async def _read_image_bytes(req: Request) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Returns (image_bytes, error_message)
    Accepts either:
      1) multipart/form-data with field 'file'
      2) application/json with {'image_b64': '<base64 or data URL>'}
    """
    ct = req.headers.get("content-type", "")
    try:
        if ct.startswith("multipart/form-data"):
            form = await req.form()  # <-- await!
            file: UploadFile = form.get("file")
            if not file:
                return None, "No file field 'file' found in multipart form."
            data = await file.read()  # <-- await!
            if not isinstance(data, (bytes, bytearray)):
                return None, f"UploadFile.read() did not return bytes (got {type(data).__name__})."
            return bytes(data), None

        # JSON fallback
        payload = await req.json()  # <-- await!
        b64 = payload.get("image_b64") or ""
        if not b64:
            return None, "JSON body must include 'image_b64'."
        data = _from_b64_str(b64)
        return data, None
    except Exception as e:
        return None, f"Failed to read image: {e}"

async def handler(request: Request):
    try:
        image_bytes, err = await _read_image_bytes(request)
        if err:
            return JSONResponse({"ok": False, "error": err}, status_code=400)

        # Sanity check to stop the 'coroutine' error class forever
        if not isinstance(image_bytes, (bytes, bytearray)):
            return JSONResponse({
                "ok": False,
                "error": f"Internal: expected bytes, got {type(image_bytes).__name__}"
            }, status_code=500)

        # Validate image with PIL
        try:
            Image.open(BytesIO(image_bytes)).verify()
        except Exception as e:
            print(f"[warn] file validation failed: {e}")

        # Get OpenAI API key
        api_key = os.environ.get("FINISHLINE_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse({"ok": False, "error": "OpenAI API key not configured"}, status_code=500)

        # Initialize async OpenAI client
        client = AsyncOpenAI(api_key=api_key)
        model = os.environ.get("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

        # Convert to base64 for OpenAI
        image_b64 = _to_b64_str(image_bytes)

        # OCR prompt
        prompt = (
            "Extract all horses from this race sheet as JSON with fields "
            "name, odds, jockey, trainer. Return JSON only."
        )

        # Call OpenAI Vision API
        completion = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are an OCR parser for race sheets."},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": f"data:image/png;base64,{image_b64}",
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
            return JSONResponse({
                "ok": False,
                "error": "Bad OCR parse",
                "raw": raw,
                "parse_error": str(e)
            }, status_code=500)

        return JSONResponse({"ok": True, "horses": horses}, status_code=200)

    except Exception as e:
        return JSONResponse({
            "ok": False,
            "error": str(e),
            "trace": traceback.format_exc()
        }, status_code=500)

# Create Starlette app for Vercel
from starlette.applications import Starlette
from starlette.routing import Route

app = Starlette(routes=[
    Route("/api/photo_extract_openai_b64", handler, methods=["POST"])
])