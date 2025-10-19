from typing import Optional, Tuple, Dict, Any
import base64, io, re, os, traceback
from starlette.requests import Request
from starlette.responses import JSONResponse
from PIL import Image

DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<b64>.+)$", re.IGNORECASE)

def _data_url_to_bytes(s: str) -> Tuple[Optional[bytes], Optional[str]]:
    """Accept a data URL or plain base64 string; return (bytes, mime or None)."""
    if not isinstance(s, str):
        return None, None
    m = DATA_URL_RE.match(s.strip())
    if m:
        try:
            return base64.b64decode(m.group("b64")), m.group("mime")
        except Exception:
            return None, None
    # plain base64 (no data: prefix)
    try:
        return base64.b64decode(s), None
    except Exception:
        return None, None

async def _read_any_image_bytes(req: Request) -> Tuple[Optional[bytes], Optional[str], Dict[str, Any]]:
    """
    Read image bytes from:
      1) multipart/form-data (field 'file')
      2) application/json — keys: file_b64 | image_b64 | data_url | image
      3) raw body as bytes
    Returns (bytes, content_type, debug_info)
    """
    dbg: Dict[str, Any] = {
        "method": req.method,
        "headers": dict(req.headers),
        "path": str(req.url.path),
    }
    ctype = req.headers.get("content-type", "") or ""
    dbg["content_type"] = ctype

    # 1) multipart/form-data
    if ctype.startswith("multipart/form-data"):
        try:
            form = await req.form()
            file = form.get("file")
            if file:
                b = await file.read()
                dbg["mode"] = "multipart"
                return b, getattr(file, "content_type", None), dbg
        except Exception as e:
            dbg["multipart_error"] = str(e)

    # 2) JSON body with base64/data URL
    if "application/json" in ctype:
        try:
            payload = await req.json()
            dbg["mode"] = "json"
            for key in ("file_b64", "image_b64", "data_url", "image"):
                if key in payload:
                    b, mime = _data_url_to_bytes(payload[key])
                    if b:
                        return b, mime or "application/octet-stream", dbg
            dbg["json_note"] = "No recognized keys: file_b64/image_b64/data_url/image"
        except Exception as e:
            dbg["json_error"] = str(e)

    # 3) raw body as bytes
    try:
        raw = await req.body()
        if raw:
            dbg["mode"] = "raw"
            return raw, req.headers.get("content-type", None), dbg
    except Exception as e:
        dbg["raw_error"] = str(e)

    return None, None, dbg

def _validate_image(b: bytes) -> Tuple[bool, Optional[str]]:
    """Attempt to open as image with PIL; return (ok, fmt_or_error)."""
    try:
        with Image.open(io.BytesIO(b)) as im:
            im.verify()  # quick integrity check
            return True, getattr(im, "format", "unknown")
    except Exception as e:
        return False, str(e)

async def handler(request: Request):
    try:
        # lightweight debug GET probe
        if request.method == "GET":
            if request.query_params.get("dbg") == "1":
                return JSONResponse({"ok": True, "dbg": True, "message": "photo_extract_openai_b64 live"})
            # If not dbg mode, still respond 200 to show liveness
            return JSONResponse({"ok": True, "message": "photo_extract_openai_b64 ready"})

        # POST/PUT only for data
        if request.method not in ("POST", "PUT"):
            return JSONResponse({"ok": False, "error": "Use POST (multipart/json/raw) or GET?dbg=1 for debug"}, status_code=405)

        img_bytes, content_type, dbg = await _read_any_image_bytes(request)
        if not img_bytes:
            return JSONResponse({"ok": False, "error": "No image received", "debug": dbg})

        ok, fmt_or_err = _validate_image(img_bytes)
        if not ok:
            return JSONResponse({"ok": False, "error": f"Not a valid image: {fmt_or_err}", "debug": dbg})

        # success — we only decode/validate here; the OCR/analysis can run later
        return JSONResponse({
            "ok": True,
            "message": "Image received and validated",
            "bytes": len(img_bytes),
            "format": fmt_or_err,
            "content_type": content_type,
            "debug": {"mode": dbg.get("mode"), "content_type": dbg.get("content_type")}
        })

    except Exception as e:
        # last-resort error, include stack for logs
        return JSONResponse({
            "ok": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }, status_code=500)

# Export name expected by Vercel
app = handler