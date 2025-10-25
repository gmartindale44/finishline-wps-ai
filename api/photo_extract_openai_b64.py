# api/photo_extract_openai_b64.py
import os, io, base64, json, traceback
from typing import Dict, Any, List, Optional, Tuple
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Router
from PIL import Image, ImageFilter, ImageOps
from openai import AsyncOpenAI

router = Router()

OPENAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")
OPENAI_KEY = os.getenv("FINISHLINE_OPENAI_API_KEY")

if not OPENAI_KEY:
    raise RuntimeError("Missing FINISHLINE_OPENAI_API_KEY environment variable. Set it in Vercel > Settings > Environment Variables.")

client = AsyncOpenAI(api_key=OPENAI_KEY)
print(f"[FinishLine] OCR using model={OPENAI_MODEL}, key_prefix={OPENAI_KEY[:7]}…")

def _strip_data_uri(s: str) -> str:
    if not s:
        return s
    if s.lower().startswith(("data:", "data:image", "data:application")) and ";base64," in s:
        return s.split(";base64,", 1)[1]
    return s

def _b64_to_bytes(s: str) -> bytes:
    return base64.b64decode(_strip_data_uri(s))

def _as_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

def _preprocess_for_ocr(raw: bytes) -> Tuple[bytes, Dict[str, Any]]:
    meta: Dict[str, Any] = {}
    try:
        im = Image.open(io.BytesIO(raw))
        meta["orig_mode"] = im.mode
        meta["orig_size"] = im.size

        im = ImageOps.grayscale(im)
        im = ImageOps.autocontrast(im, cutoff=1)
        w, h = im.size
        if w < 900:
            scale = min(2.0, 900 / max(1, w))
            im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
            meta["upscaled_to"] = im.size
        im = im.filter(ImageFilter.SHARPEN)

        pre_bytes = _as_png_bytes(im)
        meta["pre_size_bytes"] = len(pre_bytes)
        return pre_bytes, meta
    except Exception as e:
        meta["pre_error"] = f"{type(e).__name__}: {e}"
        return raw, meta

def _horse_schema() -> str:
    return json.dumps({
        "type":"object",
        "properties":{
            "horses":{
                "type":"array",
                "items":{
                    "type":"object",
                    "properties":{
                        "name":{"type":"string"},
                        "ml_odds":{"type":"string"},
                        "jockey":{"type":"string"},
                        "trainer":{"type":"string"}
                    },
                    "required":["name"]
                }
            }
        },
        "required":["horses"]
    })

async def _ocr_structured(img_bytes: bytes) -> Dict[str, Any]:
    try:
        img_b64 = base64.b64encode(img_bytes).decode()
        sys = (
            "You are an expert OCR parser for US horse racing entries. "
            "Return ONLY valid JSON matching the provided JSON-Schema. "
            "Extract ALL rows; do not infer missing ones."
        )
        user = (
            "Extract horses from this image. DO NOT include race date, track, surface, or distance. "
            "Only return horses with name, morning-line odds (ml_odds), jockey, and trainer."
        )
        schema = _horse_schema()
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0,
            max_tokens=900,
            response_format={"type":"json_schema","json_schema":{"name":"HorseList","schema":json.loads(schema)}},
            messages=[
                {"role":"system","content":sys},
                {"role":"user","content":[
                    {"type":"text","text":user},
                    {"type":"input_image","image_url":{"url":f"data:image/png;base64,{img_b64}","detail":"high"}}
                ]}
            ]
        )
        try:
            return json.loads(resp.choices[0].message.content or "{}")
        except Exception as e:
            print(f"[FinishLine OCR ERROR] JSON parsing failed in structured OCR: {e}")
            return {"horses":[]}
    except Exception as e:
        print(f"[FinishLine OCR ERROR] Structured OCR failed: {e}")
        traceback.print_exc()
        return {"horses":[]}

async def _ocr_raw_text(img_bytes: bytes) -> str:
    try:
        img_b64 = base64.b64encode(img_bytes).decode()
        sys = "You are an OCR transcription engine. Respond with FULL raw text only—no JSON, no commentary."
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0,
            max_tokens=2000,
            messages=[
                {"role":"system","content":sys},
                {"role":"user","content":[
                    {"type":"text","text":"Transcribe every visible character from the image."},
                    {"type":"input_image","image_url":{"url":f"data:image/png;base64,{img_b64}","detail":"high"}}
                ]}
            ]
        )
        result = (resp.choices[0].message.content or "").strip()
        if not result:
            print("[FinishLine OCR ERROR] Empty OCR output received from OpenAI.")
            raise ValueError("Empty OCR output received from OpenAI.")
        return result
    except Exception as e:
        print(f"[FinishLine OCR ERROR] Raw text OCR failed: {e}")
        traceback.print_exc()
        raise

async def _parse_from_raw_text(raw_text: str) -> Dict[str, Any]:
    if not raw_text.strip():
        return {"horses":[]}
    try:
        sys = (
            "Convert the OCR text into horses JSON. "
            "Only include horses (name, ml_odds, jockey, trainer). "
            "Ignore date/track/surface/distance."
        )
        schema = _horse_schema()
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0,
            max_tokens=900,
            response_format={"type":"json_schema","json_schema":{"name":"HorseList","schema":json.loads(schema)}},
            messages=[
                {"role":"system","content":sys},
                {"role":"user","content":f"OCR TEXT:\n{raw_text}\n\nReturn JSON only."}
            ]
        )
        try:
            return json.loads(resp.choices[0].message.content or "{}")
        except Exception as e:
            print(f"[FinishLine OCR ERROR] JSON parsing failed in raw text parsing: {e}")
            return {"horses":[]}
    except Exception as e:
        print(f"[FinishLine OCR ERROR] Raw text parsing failed: {e}")
        traceback.print_exc()
        return {"horses":[]}

@router.route("/api/photo_extract_openai_b64", methods=["POST"])
async def handler(request: Request) -> JSONResponse:
    dbg: Dict[str, Any] = {"ok": False, "stage":"start"}
    try:
        img_bytes = None
        ct = request.headers.get("content-type","")
        dbg["content_type"] = ct

        if "multipart/form-data" in ct:
            form = await request.form()
            file = form.get("file")
            if file:
                img_bytes = await file.read()
                dbg["input"] = {"kind":"multipart","size": len(img_bytes)}
        else:
            body = await request.json()
            b64 = body.get("image_b64") or body.get("b64") or body.get("image")
            if b64:
                img_bytes = _b64_to_bytes(b64)
                dbg["input"] = {"kind":"json-b64","size": len(img_bytes)}

        if not img_bytes:
            dbg["error"] = "No image received"
            return JSONResponse(dbg, status_code=400)

        pre_bytes, pre_meta = _preprocess_for_ocr(img_bytes)
        dbg["preprocess"] = pre_meta

        dbg["stage"] = "structured_ocr"
        first = await _ocr_structured(pre_bytes)
        horses = (first or {}).get("horses") or []
        dbg["first_count"] = len(horses)

        if len(horses) == 0:
            dbg["stage"] = "raw_ocr_fallback"
            raw_txt = await _ocr_raw_text(pre_bytes)
            dbg["raw_text_preview"] = raw_txt[:400]
            parsed = await _parse_from_raw_text(raw_txt)
            horses = (parsed or {}).get("horses") or []
            dbg["fallback_count"] = len(horses)

        def _clean(s: Optional[str]) -> Optional[str]:
            return None if s is None else " ".join(str(s).split())

        for h in horses:
            h["name"]    = _clean(h.get("name"))
            h["ml_odds"] = _clean(h.get("ml_odds"))
            h["jockey"]  = _clean(h.get("jockey"))
            h["trainer"] = _clean(h.get("trainer"))

        if len(horses) == 0:
            return JSONResponse({"ok": False, "error":"OCR returned empty text", "debug": dbg}, status_code=200)

        return JSONResponse({"ok": True, "horses": horses, "debug": dbg}, status_code=200)

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        print(f"[FinishLine OCR ERROR] Main handler failed: {error_msg}")
        traceback.print_exc()
        dbg["error"] = error_msg
        dbg["trace"] = traceback.format_exc()[-2000:]
        return JSONResponse({"ok": False, "error": f"OCR failed: {e}", "debug": dbg}, status_code=500)

app = router