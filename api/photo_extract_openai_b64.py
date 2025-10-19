import os, json, base64, traceback, inspect
from typing import Optional, Tuple
from io import BytesIO

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.datastructures import UploadFile
from starlette.applications import Starlette
from starlette.routing import Route
from openai import AsyncOpenAI
from PIL import Image


def _data_url_strip(s: str) -> str:
    # Allow data URLs or plain b64
    if "," in s and s.lstrip().lower().startswith(("data:", "data:image")):
        return s.split(",", 1)[1]
    return s


def _b64_to_bytes(b64s: str) -> bytes:
    return base64.b64decode(_data_url_strip(b64s))


def _bytes_to_b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


async def _read_any_image_bytes(req: Request) -> Tuple[Optional[bytes], Optional[str], dict]:
    """
    Tries to read image bytes from:
      1) multipart/form-data with field 'file'
      2) application/json {"image_b64": "<base64 or data URL>"}
      3) raw body bytes (fallback)
    Returns (bytes_or_none, error_or_none, debug_info)
    """
    dbg = {"content_type": req.headers.get("content-type", "")}

    try:
        ct = (dbg["content_type"] or "").lower()

        if "multipart/form-data" in ct:
            form = await req.form()  # MUST await
            dbg["form_type"] = type(form).__name__
            file: UploadFile = form.get("file")
            dbg["file_present"] = bool(file)
            dbg["file_type"] = type(file).__name__ if file else None
            if not file:
                return None, "No 'file' field in multipart form.", dbg
            data = await file.read()  # MUST await
            dbg["file_read_type"] = type(data).__name__
            if not isinstance(data, (bytes, bytearray)):
                return None, f"UploadFile.read() returned {type(data).__name__}, expected bytes.", dbg
            return bytes(data), None, dbg

        # JSON path
        if "application/json" in ct:
            payload = await req.json()  # MUST await
            dbg["json_type"] = type(payload).__name__
            if inspect.iscoroutine(payload):
                return None, "Internal: request.json() was a coroutine (not awaited).", dbg

            b64 = payload.get("image_b64") if isinstance(payload, dict) else None
            dbg["has_image_b64"] = bool(b64)
            if not b64:
                return None, "JSON body must include 'image_b64'.", dbg

            if inspect.iscoroutine(b64):
                return None, "Internal: image_b64 is coroutine (not awaited).", dbg

            if not isinstance(b64, str):
                return None, f"image_b64 must be a string, got {type(b64).__name__}.", dbg

            try:
                data = _b64_to_bytes(b64)
            except Exception as e:
                return None, f"Could not decode image_b64: {e}", dbg

            dbg["decoded_len"] = len(data)
            return data, None, dbg

        # Fallback: raw body (could be base64 or binary)
        raw = await req.body()  # MUST await
        dbg["raw_body_type"] = type(raw).__name__
        if inspect.iscoroutine(raw):
            return None, "Internal: request.body() was coroutine (not awaited).", dbg

        if not raw:
            return None, "Empty request body.", dbg

        # Heuristic: JSON or b64 string?
        if isinstance(raw, (bytes, bytearray)):
            # Try to parse JSON; if it fails we treat as raw bytes
            try:
                as_text = raw.decode("utf-8")
                if as_text.strip().startswith("{"):
                    payload = json.loads(as_text)
                    b64 = payload.get("image_b64")
                    dbg["fallback_json"] = True
                    if not isinstance(b64, str):
                        return None, "JSON fallback missing 'image_b64' string.", dbg
                    data = _b64_to_bytes(b64)
                    dbg["decoded_len"] = len(data)
                    return data, None, dbg
                # else: treat as raw bytes image
                dbg["fallback_raw_bytes"] = True
                return bytes(raw), None, dbg
            except Exception:
                dbg["fallback_raw_bytes"] = True
                return bytes(raw), None, dbg

        return None, f"Unsupported body type {type(raw).__name__}.", dbg

    except Exception as e:
        dbg["exception"] = f"{type(e).__name__}: {e}"
        dbg["trace"] = traceback.format_exc()
        return None, f"Failed to read image: {e}", dbg


async def handler(request: Request):
    # If you run on Vercel's Python/ASGI adapter, export this 'handler'
    try:
        img_bytes, err, dbg = await _read_any_image_bytes(request)
        if err:
            return JSONResponse({"ok": False, "error": err, "debug": dbg}, status_code=400)

        # Final guard: never pass non-bytes down the pipeline
        if not isinstance(img_bytes, (bytes, bytearray)):
            return JSONResponse(
                {"ok": False, "error": f"Internal: expected bytes, got {type(img_bytes).__name__}", "debug": dbg},
                status_code=500,
            )

        # ----- OCR / Vision call goes here -----
        # Get OpenAI API key
        api_key = os.getenv("FINISHLINE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        if not api_key:
            return JSONResponse({"ok": False, "error": "OpenAI API key not configured", "debug": dbg}, status_code=500)

        # Initialize async OpenAI client
        client = AsyncOpenAI(api_key=api_key)
        model = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

        # Validate image with PIL
        try:
            Image.open(BytesIO(img_bytes)).verify()
            dbg["image_validated"] = True
        except Exception as e:
            dbg["image_validation_warning"] = str(e)
            print(f"[warn] file validation failed: {e}")

        # Convert to base64 for OpenAI
        image_b64 = _bytes_to_b64(img_bytes)

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
            dbg["horses_extracted"] = len(horses)
        except Exception as e:
            return JSONResponse({
                "ok": False,
                "error": "Bad OCR parse",
                "raw": raw,
                "parse_error": str(e),
                "debug": dbg
            }, status_code=500)

        return JSONResponse({"ok": True, "horses": horses, "debug": dbg}, status_code=200)
    except Exception as e:
        return JSONResponse(
            {"ok": False, "error": str(e), "trace": traceback.format_exc()},
            status_code=500,
        )

# Create Starlette app for Vercel
app = Starlette(routes=[
    Route("/api/photo_extract_openai_b64", handler, methods=["POST"])
])