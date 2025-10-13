# FinishLine WPS AI — OCR pipeline + tolerant uploads + JSON-only responses

from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any
import base64, re, os

# --- OpenAI SDK (>=1.0) ---
try:
    from openai import OpenAI
    _openai_client = OpenAI()
except Exception:
    _openai_client = None  # still return clean JSON if SDK/env not present

app = FastAPI()
router = APIRouter()

def _strip_data_url(s: str) -> str:
    if isinstance(s, str) and s.startswith('data:'):
        m = re.match(r'^data:.*;base64,(.*)$', s, re.IGNORECASE | re.DOTALL)
        if m: return m.group(1)
    return s

async def _collect_payload(request: Request,
                           files: Optional[List[UploadFile]],
                           photos: Optional[List[UploadFile]]) -> List[Dict[str, Any]]:
    got: List[UploadFile] = []
    if files:  got.extend([f for f in files if f is not None])
    if photos: got.extend([p for p in photos if p is not None])

    if not got:
        try:
            form = await request.form()
            for _, v in form.multi_items():
                if isinstance(v, UploadFile):
                    got.append(v)
        except Exception:
            pass

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

    payload: List[Dict[str, Any]] = []
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
    return payload

def _vision_prompt_json() -> str:
    # Ask the model for **only** strict JSON covering the fields we have on the form.
    return (
        "You are an OCR+information extractor for U.S. horse-racing programs.\n"
        "Parse the provided race sheet(s) and return ONLY valid JSON with no commentary.\n"
        "Target schema:\n"
        "{\n"
        '  "race": { "date": "mm/dd/yyyy | ISO ok", "track": "string", "surface": "Dirt|Turf|All-Weather|synthetic|other", "distance": "e.g., 1 1/4 miles" },\n'
        '  "horse": { "name": "string", "ml_odds": "like 5-2", "jockey": "string", "trainer": "string" }\n'
        "}\n"
        "Fill unknowns with null.\n"
        "There are never photos of actual horses, only printed sheets.\n"
        "Output ONLY the JSON object. No markdown."
    )

def _run_openai_vision(payload: List[Dict[str, Any]]) -> Dict[str, Any]:
    if _openai_client is None:
        # SDK not available; return echo so frontend still renders
        return {"error": "OPENAI_SDK_UNAVAILABLE"}

    model = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    content: List[Dict[str, Any]] = [{"type": "text", "text": _vision_prompt_json()}]
    # include up to 6 images
    for item in payload[:6]:
        mime = item.get("content_type") or "image/png"
        data_url = f"data:{mime};base64,{item['b64']}"
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    try:
        chat = _openai_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": content}],
            temperature=0
        )
        raw = chat.choices[0].message.content or "{}"
        # The API returns a string; attempt to parse JSON safely.
        import json
        # Trim possible code fences if the model added them
        raw = raw.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.DOTALL)
        data = json.loads(raw)
        return {"extracted": data}
    except Exception as e:
        return {"error": f"OCR_FAILED: {e}"}

@router.post("/api/photo_extract_openai_b64")
async def photo_extract_openai_b64(
    request: Request,
    files: Optional[List[UploadFile]] = File(default=None),
    photos: Optional[List[UploadFile]] = File(default=None),
):
    try:
        payload = await _collect_payload(request, files, photos)

        # Run OCR/IE
        ocr = _run_openai_vision(payload)

        resp = {
            "received": [
                {"filename": p["filename"], "content_type": p["content_type"], "bytes": p["bytes"]}
                for p in payload
            ],
            **({"extracted": ocr.get("extracted")} if "extracted" in ocr else {}),
            **({"ocr_error": ocr.get("error")} if "error" in ocr else {}),
        }
        return JSONResponse({"ok": True, "data": resp}, status_code=200)

    except HTTPException as he:
        detail = he.detail if isinstance(he.detail, dict) else {"code":"HTTP_ERROR","message":str(he.detail)}
        return JSONResponse({"ok": False, "error": detail}, status_code=he.status_code)
    except Exception as e:
        return JSONResponse({"ok": False, "error": {"code":"SERVER_ERROR","message":str(e)}}, status_code=500)

@router.get("/api/health")
def health():
    return JSONResponse({"ok": True, "msg": "FastAPI connected on Vercel"})

# IMPORTANT: On Vercel, routes include /api prefix (Vercel passes full path)
app.include_router(router)
