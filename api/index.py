# FinishLine WPS AI — OCR using existing FINISHLINE_* env vars; tolerant uploads; structured JSON.

from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import base64, re, os, json

# ---------- Models ----------
class RaceMeta(BaseModel):
    date: Optional[str] = None
    track: Optional[str] = None
    surface: Optional[str] = None
    distance: Optional[str] = None

class RaceEntry(BaseModel):
    name: str
    mlOdds: Optional[str] = None
    jockey: Optional[str] = None
    trainer: Optional[str] = None

class AnalyzeRequest(BaseModel):
    meta: Optional[RaceMeta] = None
    entries: List[RaceEntry]

class AnalyzeResult(BaseModel):
    name: str
    notes: str
    strengths: Optional[List[str]] = None
    risks: Optional[List[str]] = None
    formScore: Optional[int] = None

class AnalyzeResponse(BaseModel):
    ok: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None

class PredictRequest(BaseModel):
    meta: Optional[RaceMeta] = None
    entries: List[RaceEntry]
    analyzed: Optional[List[AnalyzeResult]] = None

class Prediction(BaseModel):
    finishOrder: List[str]
    winPlaceShow: Dict[str, str]
    confidence: float
    rationale: str

class PredictResponse(BaseModel):
    ok: bool
    data: Optional[Prediction] = None
    error: Optional[Dict[str, Any]] = None

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

# ---------- AI Helper Functions ----------
async def call_openai_json(system: str, user: str, model: str = None, temperature: float = 0.2):
    """Generic call to OpenAI Chat Completions API with strong error reporting"""
    if not OPENAI_API_KEY:
        raise Exception("Missing OpenAI API key")
    
    model = model or OPENAI_MODEL
    
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "response_format": {"type": "json_object"},
                "temperature": temperature,
            }
        )
        
        data = response.json()
        
        if not response.is_success:
            msg = data.get('error', {}).get('message', 'OpenAI request failed')
            error = Exception(msg)
            error.detail = data
            error.status = response.status_code
            raise error
        
        content = data.get('choices', [{}])[0].get('message', {}).get('content')
        if not content:
            error = Exception("Empty content from OpenAI")
            error.detail = data
            raise error
        
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as e:
            error = Exception("Failed to parse OpenAI JSON output")
            error.detail = content
            raise error
        
        return parsed

# ---------- Analyze and Predict Endpoints ----------
@router.post("/api/research_predict")
async def research_predict(payload: AnalyzeRequest):
    """Analyze race entries with LLM for handicapping insights"""
    try:
        if not OPENAI_API_KEY:
            return err("NO_API_KEY", "Missing OpenAI API key")
        
        entries = payload.entries
        if not entries:
            return err("NO_ENTRIES", "No race entries provided", 422)
        
        meta = payload.meta or {}
        
        system_prompt = """
        You are an assistant that analyzes horse race ENTRY SHEETS (images were already OCR'd).
        Input (from user) is a JSON with "meta" and "entries".
        Each entry has: name, odds (string like "5/2" or "10/1"), jockey, trainer.
        Return strictly JSON:
        {
          "analyzed": [
            {
              "name": string,
              "notes": string,
              "strengths": string[],
              "risks": string[],
              "formScore": number  // 0-100 confidence
            }
          ],
          "summary": string
        }
        """
        
        user_data = {
            "meta": meta,
            "entries": [entry.dict() for entry in entries]
        }
        
        out = await call_openai_json(system_prompt, json.dumps(user_data))
        
        analyzed = out.get("analyzed", [])
        if not analyzed:
            return err("NO_ANALYSIS", "AI returned no analysis", 500)
        
        return ok({
            "analyzed": analyzed,
            "summary": out.get("summary", "")
        })
    
    except Exception as e:
        print(f"[research_predict] error: {e}")
        return err(
            getattr(e, 'code', 'SERVER_ERROR'),
            getattr(e, 'message', 'Unexpected failure'),
            500
        )

@router.post("/api/predict_wps")
async def predict_wps(payload: PredictRequest):
    """Compute W/P/S picks using heuristic-based ranking with optional LLM rationale"""
    try:
        entries = payload.entries
        analyzed = payload.analyzed or []
        
        if not entries:
            return err("NO_ENTRIES", "No entries to predict", 422)
        if not analyzed:
            return err("NO_ANALYZED", "No analyzed data provided", 422)
        
        # Convert fractional odds to implied probability
        def frac_to_prob(odds: str = None):
            if not odds:
                return 0.10
            import re
            match = re.match(r'^(\d+)\s*/\s*(\d+)$', str(odds).strip())
            if not match:
                return 0.10
            a, b = float(match.group(1)), float(match.group(2))
            if not (a > 0 and b > 0):
                return 0.10
            return b / (a + b)  # implied probability approximation
        
        # Merge entries with analyzed data and calculate scores
        merged = []
        for entry in entries:
            analysis = next((a for a in analyzed if a.name.lower() == entry.name.lower()), None)
            form_score = max(0, min(100, analysis.formScore if analysis else 50))
            odds_prob = frac_to_prob(entry.mlOdds)
            
            # Weight odds probability and normalized form score
            score = 0.55 * odds_prob + 0.45 * (form_score / 100)
            
            merged.append({
                "name": entry.name,
                "odds": entry.mlOdds,
                "jockey": entry.jockey,
                "trainer": entry.trainer,
                "formScore": form_score,
                "oddsProb": odds_prob,
                "score": score,
                "strengths": analysis.strengths if analysis else [],
                "risks": analysis.risks if analysis else [],
                "notes": analysis.notes if analysis else "",
            })
        
        # Sort by score (highest first)
        merged.sort(key=lambda x: x["score"], reverse=True)
        
        win = merged[0] if merged else None
        place = merged[1] if len(merged) > 1 else None
        show = merged[2] if len(merged) > 2 else None
        
        if not win:
            return err("NO_PICKS", "Unable to generate picks", 500)
        
        # Optional: Generate LLM rationale for top 3
        rationale = ""
        try:
            if OPENAI_API_KEY and win and place and show:
                system = "You are a handicapping explainer. Return plain text under 120 words."
                user = f"Top contenders (sorted): {json.dumps([win, place, show])}.\nExplain succinctly why #1 is the win pick, and how #2/#3 compare."
                
                out = await call_openai_json(system, user)
                rationale = out.get("text", "") or out.get("summary", "") or ""
                if isinstance(out, str):
                    rationale = out
        except Exception:
            # Non-fatal - rationale can be empty
            pass
        
        return ok({
            "ranking": merged,
            "picks": {"win": win, "place": place, "show": show},
            "rationale": rationale,
        })
    
    except Exception as e:
        print(f"[predict_wps] error: {e}")
        return err(
            getattr(e, 'code', 'SERVER_ERROR'),
            getattr(e, 'message', 'Unexpected failure'),
            500
        )

@router.get("/api/health")
def health():
    return {"ok": True, "ocr_enabled": _is_enabled(), "model": OPENAI_MODEL, "has_key": bool(OPENAI_API_KEY)}

app.include_router(router)
