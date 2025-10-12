# FastAPI entrypoint on Vercel (Python). This patch:
# - Accepts files via either "files" or "photos"
# - Returns consistent JSON { ok, data | error }
# - Handles 0-file cases with clear 400 and message
# - Leaves your OCR pipeline hookable where marked

from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter
from fastapi.responses import JSONResponse
from typing import List, Optional
import base64

try:
    app  # type: ignore[name-defined]
except NameError:
    app = FastAPI()

router = APIRouter()

def _merge_uploads(
    files: Optional[List[UploadFile]],
    photos: Optional[List[UploadFile]],
) -> List[UploadFile]:
    out: List[UploadFile] = []
    if files:
        out.extend([f for f in files if f is not None])
    if photos:
        out.extend([p for p in photos if p is not None])
    # Deduplicate by filename/content-type pair (best-effort)
    seen = set()
    uniq = []
    for f in out:
        key = (getattr(f, "filename", None), getattr(f, "content_type", None))
        if key not in seen:
            seen.add(key)
            uniq.append(f)
    return uniq

@router.post("/photo_extract_openai_b64")
async def photo_extract_openai_b64(
    files: Optional[List[UploadFile]] = File(default=None),
    photos: Optional[List[UploadFile]] = File(default=None),
):
    try:
        uploads: List[UploadFile] = _merge_uploads(files, photos)
        if not uploads:
            # Match your prior error shape but with HTTP 400
            raise HTTPException(
                status_code=400,
                detail={"code": "NO_FILES", "message": "No images were uploaded."},
            )

        # Read and base64-encode all files for your OCR pipeline
        payload = []
        for uf in uploads:
            raw = await uf.read()
            b64 = base64.b64encode(raw).decode("utf-8")
            payload.append(
                {
                    "filename": uf.filename,
                    "content_type": uf.content_type,
                    "bytes": len(raw),
                    "b64": b64,  # keep if your OCR uses base64
                }
            )

        # TODO: Plug into your existing OCR pipeline here:
        # result = await your_ocr_runner(payload)
        # For safety, we return a minimal echo confirming receipt.
        # Replace 'data' below with your OCR output object.
        data = {
            "received": [
                {
                    "filename": item["filename"],
                    "content_type": item["content_type"],
                    "bytes": item["bytes"],
                }
                for item in payload
            ]
        }

        return JSONResponse(content={"ok": True, "data": data}, status_code=200)

    except HTTPException as http_err:
        # Preserve shape with always-JSON response
        detail = http_err.detail
        if isinstance(detail, dict):
            return JSONResponse(
                content={"ok": False, "error": detail},
                status_code=http_err.status_code,
            )
        # Fallback if detail is str
        return JSONResponse(
            content={"ok": False, "error": {"code": "HTTP_ERROR", "message": str(detail)}},
            status_code=http_err.status_code,
        )
    except Exception as e:
        # Never leak internals; return clean JSON
        return JSONResponse(
            content={"ok": False, "error": {"code": "SERVER_ERROR", "message": str(e)}},
            status_code=500,
        )

# Mount the router (avoid double-includes)
if not any(getattr(r, "path", "") == "/photo_extract_openai_b64" for r in getattr(app, "routes", [])):
    app.include_router(router, prefix="/api")

