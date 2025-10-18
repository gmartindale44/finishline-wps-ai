# FinishLine WPS AI — OCR using existing FINISHLINE_* env vars; tolerant uploads; structured JSON.

from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import base64, re, os, json

# ---------- Models ----------
class HorseIn(BaseModel):
    name: str
    odds: Optional[str] = None
    jockey: Optional[str] = None
    trainer: Optional[str] = None

class RaceIn(BaseModel):
    date: Optional[str] = None
    track: Optional[str] = None
    surface: Optional[str] = None
    distance: Optional[str] = None

class AnalyzePredictIn(BaseModel):
    race: RaceIn
    horses: List[HorseIn]

# Always reply in this envelope
def ok(data: Any):
    return JSONResponse({"ok": True, "data": data})

def err(code: str, message: str, status: int = 400):
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}, "detail": []}, status_code=status)

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

# Photo extract router is included below

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
        "You are an expert at reading horseracing programs, entries, DRF sheets, tote boards, and race-day PDFs.\n\n"
        "Extract race entries from the provided images. The images may be tables or text lists with columns like:\n"
        "- Horse Name (may appear as \"Horse\", \"Name\", \"Entry\", or with program number)\n"
        "- Morning Line Odds (e.g., \"5-2\", \"3/1\", \"10/1\")\n"
        "- Jockey\n"
        "- Trainer\n\n"
        "Output only JSON with this exact schema:\n"
        "{\n"
        '  "entries": [\n'
        '    { "name": string, "mlOdds": string | null, "jockey": string | null, "trainer": string | null }\n'
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Do not include program numbers or post position in the name (if clearly separated)\n"
        "- Keep odds as the original format (e.g., \"5-2\", \"3/1\", \"10/1\", \"9/5\")\n"
        "- If a field is missing on the sheet, set it to null\n"
        "- Ignore headings, footers, scratches, logos, graphics, or decorative text\n"
        "- This is NOT a photo of animals; it is text/table extraction\n"
        "- Output ONLY the JSON object — no markdown"
    )

def _run_vision(payload: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not _is_enabled():
        return {"error": "OCR_DISABLED via FINISHLINE_OCR_ENABLED"}
    if not OPENAI_API_KEY:
        return {"error": "OPENAI_KEY_MISSING (FINISHLINE_OPENAI_API_KEY/FINISHLINE_OPENAI_APT_KEY/OPENAI_API_KEY)"}
    if _client is None:
        return {"error": "OPENAI_SDK_UNAVAILABLE"}

    # Table-first approach
    content: List[Dict[str, Any]] = [{"type": "text", "text": _prompt_json_schema() + "\n\nLook for a table or structured list with columns similar to:\nHorse | ML Odds | Jockey | Trainer\nReturn entries from top to bottom."}]
    for item in payload[:6]:
        mime = item.get("content_type") or "image/png"
        data_url = f"data:{mime};base64,{item['b64']}"
        content.append({"type": "image_url", "image_url": {"url": data_url}})

    try:
        resp = _client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": content}],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        data = json.loads(raw)
        
        # Normalize entries
        entries = data.get("entries", [])
        if not entries:
            # Try fallback approach
            fallback_content = [{"type": "text", "text": _prompt_json_schema() + "\n\nIf no clean table is detected, parse freeform lines.\nCommon patterns:\n- <Horse Name>  <ML Odds>  <Jockey>  <Trainer>\n- <#> <Horse Name> <odds> (Jockey) [Trainer]\n- \"Horse: <Name>\" \"Odds: <odds>\" \"Jockey: <name>\" \"Trainer: <name>\"\n\nReturn what you can; use null for unknown fields."}]
            for item in payload[:6]:
                mime = item.get("content_type") or "image/png"
                data_url = f"data:{mime};base64,{item['b64']}"
                fallback_content.append({"type": "image_url", "image_url": {"url": data_url}})
            
            fallback_resp = _client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "user", "content": fallback_content}],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            fallback_raw = (fallback_resp.choices[0].message.content or "{}").strip()
            fallback_data = json.loads(fallback_raw)
            entries = fallback_data.get("entries", [])
        
        if not entries:
            return {"error": "NO_ENTRIES: No race entries detected in the provided images. Try a sharper crop or a page that shows Horse / Odds / Jockey / Trainer."}
        
        # Normalize and clean entries
        normalized_entries = []
        for entry in entries:
            normalized_entry = {
                "name": (entry.get('name') or '').strip(),
                "mlOdds": entry.get('mlOdds', '').strip() if entry.get('mlOdds') else None,
                "jockey": entry.get('jockey', '').strip() if entry.get('jockey') else None,
                "trainer": entry.get('trainer', '').strip() if entry.get('trainer') else None,
            }
            if normalized_entry['name']:
                normalized_entries.append(normalized_entry)
        
        if not normalized_entries:
            return {"error": "NO_ENTRIES: No valid race entries found after processing"}
        
        return {"entries": normalized_entries}
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
        
        if "error" in ocr:
            return err("OCR_FAILED", ocr["error"])
        
        if "entries" not in ocr:
            return err("NO_ENTRIES", "No race entries found in the provided images")
        
        data = {
            "received": [{"filename": p["filename"], "content_type": p["content_type"], "bytes": p["bytes"]} for p in payload],
            "entries": ocr["entries"]
        }
        
        return ok(data)
    except HTTPException as he:
        detail = he.detail if isinstance(he.detail, dict) else {"code":"HTTP_ERROR","message":str(he.detail)}
        return err("HTTP_ERROR", str(he.detail), he.status_code)
    except Exception as e:
        return err("SERVER_ERROR", str(e), 500)

# ---------- New tolerant endpoints ----------
@router.post("/api/research_predict")
async def research_predict(payload: AnalyzePredictIn):
    # plug into your existing analyzer; this stub returns passthrough
    # data = await run_research(payload)
    data = {"status": "analyzed", "horses": [h.dict() for h in payload.horses]}
    return ok(data)

@router.post("/api/predict_wps")
async def predict_wps(payload: AnalyzePredictIn):
    # plug into your existing predictor; this stub returns an example ranking
    ranking = [{"name": h.name, "score": 1.0} for h in payload.horses[:3]]
    return ok({"ranking": ranking})

@router.get("/api/health")
def health():
    return {"ok": True, "ocr_enabled": _is_enabled(), "model": OPENAI_MODEL, "has_key": bool(OPENAI_API_KEY)}

app.include_router(router)
