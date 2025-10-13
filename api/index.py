# FinishLine WPS AI — OCR using existing FINISHLINE_* env vars; tolerant uploads; structured JSON.

from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any
import base64, re, os, json

def _env_any(names, default=None):
    for n in names:
        v = os.getenv(n)
        if v not in (None, ""):
            return v
    return default

def _is_enabled():
    v = _env_any(["FINISHLINE_OCR_ENABLED"], "1")
    return str(v).strip().lower() not in ("0", "false", "off", "no")

OPENAI_API_KEY = _env_any(["FINISHLINE_OPENAI_API_KEY", "FINISHLINE_OPENAI_APT_KEY", "OPENAI_API_KEY"])
OPENAI_MODEL   = _env_any(["FINISHLINE_OPENAI_MODEL", "OPENAI_VISION_MODEL", "FINISHLINE_MODEL"], "gpt-4o-mini")

# OpenAI client (created only if enabled & key present)
_client = None
if _is_enabled() and OPENAI_API_KEY:
    try:
        from openai import OpenAI
        _client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        _client = None

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

def _prompt_json_schema() -> str:
    return (
        "Extract data from the attached racetrack program images. Return ONLY valid JSON matching this schema:\n"
        "{\n"
        '  "race": {\n'
        '    "date": "mm/dd/yyyy or ISO",\n'
        '    "track": "string",\n'
        '    "surface": "Dirt|Turf|Synthetic|All-Weather|Other",\n'
        '    "distance": "e.g., 1 1/4 miles"\n'
        "  },\n"
        '  "horses": [\n'
        '    { "name": "string", "ml_odds": "e.g., 5-2", "jockey": "string", "trainer": "string" }\n'
        "  ]\n"
        "}\n"
        "If something is missing, use null. Output ONLY the JSON object — no markdown."
    )

def _run_vision(payload: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not _is_enabled():
        return {"error": "OCR_DISABLED via FINISHLINE_OCR_ENABLED"}
    if not OPENAI_API_KEY:
        return {"error": "OPENAI_KEY_MISSING (FINISHLINE_OPENAI_API_KEY/FINISHLINE_OPENAI_APT_KEY/OPENAI_API_KEY)"}
    if _client is None:
        return {"error": "OPENAI_SDK_UNAVAILABLE"}

    content: List[Dict[str, Any]] = [{"type": "text", "text": _prompt_json_schema()}]
    for item in payload[:6]:
        mime = item.get("content_type") or "image/png"
        data_url = f"data:{mime};base64,{item['b64']}"
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    try:
        resp = _client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": content}],
            temperature=0
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.DOTALL)
        data = json.loads(raw)
        # Normalize to horses[]
        if not isinstance(data.get("horses"), list):
            if data.get("horse"): data["horses"] = [data["horse"]]
            else: data["horses"] = []
            data.pop("horse", None)
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
        ocr = _run_vision(payload)
        data = { "received": [ { "filename": p["filename"], "content_type": p["content_type"], "bytes": p["bytes"] } for p in payload ] }
        if "extracted" in ocr: data["extracted"] = ocr["extracted"]
        if "error" in ocr:     data["ocr_error"] = ocr["error"]
        return JSONResponse({"ok": True, "data": data}, status_code=200)
    except HTTPException as he:
        detail = he.detail if isinstance(he.detail, dict) else {"code":"HTTP_ERROR","message":str(he.detail)}
        return JSONResponse({"ok": False, "error": detail}, status_code=he.status_code)
    except Exception as e:
        return JSONResponse({"ok": False, "error": {"code":"SERVER_ERROR","message":str(e)}}, status_code=500)

@router.get("/api/health")
def health():
    return {"ok": True, "ocr_enabled": _is_enabled(), "model": OPENAI_MODEL, "has_key": bool(OPENAI_API_KEY)}

app.include_router(router)
