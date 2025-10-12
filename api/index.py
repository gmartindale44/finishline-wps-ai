# FastAPI endpoint accepts:
# - multipart form ("files" and/or "photos")
# - OR JSON body: { images: ["data:<mime>;base64,...", "..."] } or { images_b64: ["<base64>", ...] }
from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from typing import List, Optional
import base64
import re

try:
    app  # type: ignore[name-defined]
except NameError:
    app = FastAPI()

router = APIRouter()

def _merge_uploads(files: Optional[List[UploadFile]], photos: Optional[List[UploadFile]]) -> List[UploadFile]:
    out: List[UploadFile] = []
    if files: out.extend([f for f in files if f is not None])
    if photos: out.extend([p for p in photos if p is not None])
    # dedupe by (filename, content_type)
    seen = set()
    uniq = []
    for f in out:
        key = (getattr(f, "filename", None), getattr(f, "content_type", None))
        if key not in seen:
            seen.add(key)
            uniq.append(f)
    return uniq

def _strip_data_url(data_url: str) -> str:
    # Accept "data:image/png;base64,AAAA..." or raw base64
    if data_url.startswith('data:'):
        # remove "data:...;base64," prefix
        m = re.match(r'^data:.*;base64,(.*)$', data_url, re.IGNORECASE | re.DOTALL)
        if m: return m.group(1)
    return data_url

@router.post("/photo_extract_openai_b64")
async def photo_extract_openai_b64(
    request: Request,
    files: Optional[List[UploadFile]] = File(default=None),
    photos: Optional[List[UploadFile]] = File(default=None),
):
    try:
        uploads: List[UploadFile] = _merge_uploads(files, photos)

        # If no multipart files, try JSON body fallback
        json_images = []
        if not uploads:
            # Only attempt to parse JSON if content-type indicates JSON
            if 'application/json' in (request.headers.get('content-type') or ''):
                body = await request.json()
                candidates = body.get('images') or body.get('images_b64') or []
                if isinstance(candidates, list):
                    for item in candidates:
                        if not isinstance(item, str): continue
                        b64 = _strip_data_url(item).strip()
                        if b64:
                            json_images.append(b64)

        if not uploads and not json_images:
            raise HTTPException(
                status_code=400,
                detail={"code": "NO_FILES", "message": "No images were uploaded."},
            )

        payload = []
        if uploads:
            for uf in uploads:
                raw = await uf.read()
                b64 = base64.b64encode(raw).decode("utf-8")
                payload.append({"filename": uf.filename, "content_type": uf.content_type, "bytes": len(raw), "b64": b64})
        else:
            # JSON path doesn't have filenames; synthesize
            for idx, b64 in enumerate(json_images, start=1):
                payload.append({"filename": f"json_image_{idx}", "content_type": "application/octet-stream", "bytes": len(b64) * 3 // 4, "b64": b64})

        # === TODO: call your OCR pipeline here using `payload` ===
        data = {
            "received": [{"filename": p["filename"], "content_type": p["content_type"], "bytes": p["bytes"]} for p in payload]
        }
        return JSONResponse(content={"ok": True, "data": data}, status_code=200)

    except HTTPException as http_err:
        detail = http_err.detail
        if isinstance(detail, dict):
            return JSONResponse(content={"ok": False, "error": detail}, status_code=http_err.status_code)
        return JSONResponse(content={"ok": False, "error": {"code": "HTTP_ERROR", "message": str(detail)}}, status_code=http_err.status_code)
    except Exception as e:
        return JSONResponse(content={"ok": False, "error": {"code": "SERVER_ERROR", "message": str(e)}}, status_code=500)

# Avoid double-mounting in dev hot-reload
if not any(getattr(r, "path", "") == "/photo_extract_openai_b64" for r in getattr(app, "routes", [])):
    app.include_router(router, prefix="/api")
