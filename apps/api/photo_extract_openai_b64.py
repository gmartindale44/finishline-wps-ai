# apps/api/photo_extract_openai_b64.py
import json, os, sys, traceback, base64, time
from typing import Dict, Any
from apps.lib.config import FINISHLINE_OPENAI_API_KEY, FINISHLINE_OPENAI_MODEL, boot_banner
from fastapi import APIRouter, Request, Response
import httpx

router = APIRouter()

boot_banner()

OPENAI_URL = "https://api.openai.com/v1/chat/completions"

def _err(msg: str, **kw) -> Dict[str, Any]:
    return {"ok": False, "error": {"message": msg, **kw}}

def _ok(data: Any) -> Dict[str, Any]:
    return {"ok": True, "data": data}

def _model_fallback_needed(err_text: str) -> bool:
    err_text_l = err_text.lower()
    needles = ["invalid model", "model", "not found", "unsupported", "does not exist"]
    return any(k in err_text_l for k in needles)

async def _call_openai(image_b64: str, model: str, timeout=60) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {FINISHLINE_OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    # Keep the prompt terse and structured; we only need Horse/Jockey/Trainer/ML
    system = (
        "You are an OCR+extractor. Return JSON array of objects with "
        "keys: horse, jockey, trainer, ml. Only the list, nothing else."
    )
    user = (
        "Extract entries from this racing list image. If odds like '10/1' appear, map to ml."
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                ],
            },
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }

    t0 = time.time()
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(OPENAI_URL, headers=headers, json=payload)
    dt = time.time() - t0

    meta = {
        "status": r.status_code,
        "elapsed_sec": round(dt, 3),
        "request_id": r.headers.get("x-request-id"),
        "vercel_id": r.headers.get("x-vercel-id"),
        "model": model,
    }
    print(f"[FinishLine OCR] OpenAI call meta: {meta}", flush=True)

    if r.status_code >= 400:
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text[:400]}
        print("🚨 [FinishLine OCR ERROR] HTTP", r.status_code, json.dumps(body, indent=2), flush=True)
        return _err("openai_http_error", meta=meta, body=body)

    try:
        body = r.json()
    except Exception:
        print("🚨 [FinishLine OCR ERROR] Non-JSON response", r.text[:400], flush=True)
        return _err("openai_non_json", meta=meta)

    try:
        content = body["choices"][0]["message"]["content"]
        # response_format=json_object guarantees JSON object; extract array under some key
        parsed = json.loads(content)
        # accept either {"items": [...]} or {"data":[...]} or just {"list":[...]} or {"horses":[...]}
        arr = None
        for k in ["items", "data", "list", "horses"]:
            if isinstance(parsed.get(k), list):
                arr = parsed[k]
                break
        if arr is None and isinstance(parsed, list):
            arr = parsed
        if arr is None:
            # last-ditch: flatten any list in values
            for v in parsed.values():
                if isinstance(v, list):
                    arr = v
                    break
        if not arr:
            return _err("empty_parse", meta=meta, raw=parsed)
        return _ok({"entries": arr, "meta": meta})
    except Exception as ex:
        print("🚨 [FinishLine OCR ERROR] parse failure", repr(ex), flush=True)
        print(traceback.format_exc(), flush=True)
        return _err("parse_failure", meta=meta, raw=body)

@router.post("/api/photo_extract_openai_b64")
async def photo_extract_openai_b64(request: Request):
    if not FINISHLINE_OPENAI_API_KEY:
        return Response(content=json.dumps(_err("missing_api_key")), media_type="application/json", status_code=500)

    try:
        payload = await request.json()
    except Exception:
        return Response(content=json.dumps(_err("invalid_json")), media_type="application/json", status_code=400)

    image_b64 = payload.get("b64")
    if not image_b64:
        return Response(content=json.dumps(_err("missing_image")), media_type="application/json", status_code=400)

    print(f"[FinishLine OCR] ▶ request received size(b64)={len(image_b64)}", flush=True)

    # primary call
    primary_model = FINISHLINE_OPENAI_MODEL or "gpt-4o-mini"
    res = await _call_openai(image_b64, primary_model)

    if not res["ok"]:
        body = res.get("error", {})
        body_text = json.dumps(body)
        if _model_fallback_needed(body_text):
            print(f"[FinishLine OCR] Retrying with model=gpt-4o because: {body_text[:160]}", flush=True)
            res2 = await _call_openai(image_b64, "gpt-4o")
            if res2["ok"]:
                print("[FinishLine OCR] ✅ Fallback succeeded", flush=True)
                return Response(content=json.dumps(res2), media_type="application/json")
            else:
                print("[FinishLine OCR] ❌ Fallback also failed", flush=True)

    return Response(content=json.dumps(res), media_type="application/json")