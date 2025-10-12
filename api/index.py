# FastAPI on Vercel: DO NOT prefix routes with "/api" inside the app.
# Vercel already maps this function to "/api/*".
from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from typing import List, Optional
import base64, re

app = FastAPI()
router = APIRouter()

def _strip_data_url(s: str) -> str:
    if isinstance(s, str) and s.startswith('data:'):
        m = re.match(r'^data:.*;base64,(.*)$', s, re.IGNORECASE | re.DOTALL)
        if m: return m.group(1)
    return s

async def _extract_payload(request: Request,
                           files: Optional[List[UploadFile]],
                           photos: Optional[List[UploadFile]]):
    collected: List[UploadFile] = []
    if files:  collected.extend([f for f in files if f is not None])
    if photos: collected.extend([p for p in photos if p is not None])

    # Sweep ANY multipart field for files
    if not collected:
        try:
            form = await request.form()
            for _, v in form.multi_items():
                if isinstance(v, UploadFile):
                    collected.append(v)
        except Exception:
            pass

    # JSON base64 fallback
    json_b64: List[str] = []
    if not collected and 'application/json' in (request.headers.get('content-type') or ''):
        try:
            body = await request.json()
            items = body.get('images') or body.get('images_b64') or []
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, str):
                        b = _strip_data_url(it).strip()
                        if b: json_b64.append(b)
        except Exception:
            pass

    if not collected and not json_b64:
        raise HTTPException(status_code=400, detail={"code":"NO_FILES","message":"No images were uploaded."})

    payload = []
    if collected:
        for uf in collected:
            raw = await uf.read()
            payload.append({
                "filename": uf.filename,
                "content_type": uf.content_type,
                "bytes": len(raw),
                "b64": base64.b64encode(raw).decode("utf-8"),
            })
    else:
        for i, b in enumerate(json_b64, 1):
            payload.append({
                "filename": f"json_image_{i}",
                "content_type": "application/octet-stream",
                "bytes": len(b) * 3 // 4,
                "b64": b,
            })
    return payload

@router.post("/photo_extract_openai_b64")   # <-- NO /api prefix here
async def photo_extract_openai_b64(
    request: Request,
    files: Optional[List[UploadFile]] = File(default=None),
    photos: Optional[List[UploadFile]] = File(default=None),
):
    try:
        payload = await _extract_payload(request, files, photos)

        # TODO: pass `payload` into your actual OCR pipeline and return that result.
        data = {
            "received": [
                {"filename": p["filename"], "content_type": p["content_type"], "bytes": p["bytes"]}
                for p in payload
            ]
        }
        return JSONResponse({"ok": True, "data": data}, status_code=200)
    except HTTPException as he:
        detail = he.detail if isinstance(he.detail, dict) else {"code":"HTTP_ERROR","message":str(he.detail)}
        return JSONResponse({"ok": False, "error": detail}, status_code=he.status_code)
    except Exception as e:
        return JSONResponse({"ok": False, "error": {"code":"SERVER_ERROR","message":str(e)}}, status_code=500)

# Optional health check to confirm function wiring
@router.get("/health")
def health():
    return {"ok": True}

# Mount router with NO prefix. Public URL will be /api/photo_extract_openai_b64 on Vercel.
app.include_router(router)
