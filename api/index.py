# FinishLine WPS AI — tolerant OCR endpoint (files/photos/any multipart field + JSON b64)
from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from typing import List, Optional
import base64, re

try:
    app  # type: ignore[name-defined]
except NameError:
    app = FastAPI()

router = APIRouter()

def _strip_data_url(s: str) -> str:
    if isinstance(s, str) and s.startswith('data:'):
        m = re.match(r'^data:.*;base64,(.*)$', s, re.IGNORECASE | re.DOTALL)
        if m: return m.group(1)
    return s

@router.post("/photo_extract_openai_b64")
async def photo_extract_openai_b64(
    request: Request,
    files: Optional[List[UploadFile]] = File(default=None),
    photos: Optional[List[UploadFile]] = File(default=None),
):
    try:
        got: List[UploadFile] = []
        if files:  got.extend([f for f in files if f is not None])
        if photos: got.extend([p for p in photos if p is not None])

        # Sweep *any* multipart field names for files
        if not got:
            try:
                form = await request.form()
                for _, v in form.multi_items():
                    if isinstance(v, UploadFile):
                        got.append(v)
            except Exception:
                pass

        # JSON b64 fallback
        b64s: List[str] = []
        if not got and 'application/json' in (request.headers.get('content-type') or ''):
            try:
                body = await request.json()
                items = body.get('images') or body.get('images_b64') or []
                if isinstance(items, list):
                    for it in items:
                        if isinstance(it, str):
                            b = _strip_data_url(it).strip()
                            if b: b64s.append(b)
            except Exception:
                pass

        if not got and not b64s:
            raise HTTPException(status_code=400, detail={"code":"NO_FILES","message":"No images were uploaded."})

        payload = []
        if got:
            for uf in got:
                raw = await uf.read()
                payload.append({
                    "filename": uf.filename,
                    "content_type": uf.content_type,
                    "bytes": len(raw),
                    "b64": base64.b64encode(raw).decode("utf-8"),
                })
        else:
            for i, b in enumerate(b64s, 1):
                payload.append({
                    "filename": f"json_image_{i}",
                    "content_type": "application/octet-stream",
                    "bytes": len(b) * 3 // 4,
                    "b64": b,
                })

        # TODO: call OCR using `payload`
        data = {"received": [{"filename": p["filename"], "content_type": p["content_type"], "bytes": p["bytes"]} for p in payload]}
        return JSONResponse({"ok": True, "data": data}, status_code=200)

    except HTTPException as he:
        detail = he.detail if isinstance(he.detail, dict) else {"code":"HTTP_ERROR","message":str(he.detail)}
        return JSONResponse({"ok": False, "error": detail}, status_code=he.status_code)
    except Exception as e:
        return JSONResponse({"ok": False, "error": {"code":"SERVER_ERROR","message":str(e)}}, status_code=500)

# avoid double-mount during hot reload
if not any(getattr(r, "path", "") == "/photo_extract_openai_b64" for r in getattr(app, "routes", [])):
    app.include_router(router, prefix="/api")
