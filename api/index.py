# FinishLine WPS AI — Ultra-tolerant OCR upload endpoint
from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from typing import List, Optional
import base64, re

try:
    app  # type: ignore[name-defined]
except NameError:
    app = FastAPI()

router = APIRouter()

def _strip_data_url(data_url: str) -> str:
    if isinstance(data_url, str) and data_url.startswith('data:'):
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
        collected: List[UploadFile] = []
        if files:  collected.extend([f for f in files if f is not None])
        if photos: collected.extend([p for p in photos if p is not None])

        # Pick up ANY file fields present in multipart
        if not collected:
            try:
                form = await request.form()
                # Starlette returns UploadFile for file parts
                for _, v in form.multi_items():
                    if isinstance(v, UploadFile):
                        collected.append(v)
            except Exception:
                pass

        # JSON base64 fallback
        json_images: List[str] = []
        if not collected and 'application/json' in (request.headers.get('content-type') or ''):
            try:
                body = await request.json()
                candidates = body.get('images') or body.get('images_b64') or []
                if isinstance(candidates, list):
                    for item in candidates:
                        if isinstance(item, str):
                            b64 = _strip_data_url(item).strip()
                            if b64: json_images.append(b64)
            except Exception:
                pass

        if not collected and not json_images:
            raise HTTPException(status_code=400, detail={"code":"NO_FILES","message":"No images were uploaded."})

        payload = []
        if collected:
            for uf in collected:
                raw = await uf.read()
                b64 = base64.b64encode(raw).decode("utf-8")
                payload.append({"filename": uf.filename, "content_type": uf.content_type, "bytes": len(raw), "b64": b64})
        else:
            for idx, b64 in enumerate(json_images, start=1):
                payload.append({"filename": f"json_image_{idx}", "content_type": "application/octet-stream", "bytes": len(b64) * 3 // 4, "b64": b64})

        # TODO: call real OCR here with `payload`
        data = { "received": [ { "filename": p["filename"], "content_type": p["content_type"], "bytes": p["bytes"] } for p in payload ] }
        return JSONResponse(content={"ok": True, "data": data}, status_code=200)

    except HTTPException as he:
        detail = he.detail if isinstance(he.detail, dict) else {"code": "HTTP_ERROR", "message": str(he.detail)}
        return JSONResponse(content={"ok": False, "error": detail}, status_code=he.status_code)
    except Exception as e:
        return JSONResponse(content={"ok": False, "error": {"code":"SERVER_ERROR","message":str(e)}}, status_code=500)

# Avoid double-mount during dev
if not any(getattr(r, "path", "") == "/photo_extract_openai_b64" for r in getattr(app, "routes", [])):
    app.include_router(router, prefix="/api")
