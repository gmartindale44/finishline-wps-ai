"""
OpenAI Vision OCR for Horse Racing Photos
Extracts structured horse data from DRF-like race tables using GPT-4 Vision
"""
from __future__ import annotations
import base64, io, re
from typing import List, Dict, Any
from fastapi import UploadFile
import os, httpx
from PIL import Image

OPENAI_API_KEY = os.getenv("FINISHLINE_OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")
FALLBACK_BANKROLL = 1000
FALLBACK_KELLY = 0.25

def parse_fractional_odds(raw: str) -> str:
    """
    Normalize to 'A/B' (e.g., '9/2', '3/1').
    Accept '9/2', '9 / 2', '3-1', '3 – 1', '3 to 1', '3:1'.
    """
    if not raw:
        return ""
    s = raw.strip().upper()
    s = s.replace("–", "-").replace("—", "-").replace(":", "/")
    s = s.replace(" TO ", "/").replace("TO", "/")
    s = re.sub(r"\s+", "", s)
    m = re.match(r"^(\d+)[\/\-](\d+)$", s)
    if m:
        a, b = m.groups()
        return f"{int(a)}/{int(b)}"
    m2 = re.match(r"^(\d+)\/(\d+)$", s)
    if m2:
        a, b = m2.groups()
        return f"{int(a)}/{int(b)}"
    return ""

def ocr_system_prompt():
    return (
        "You are an expert at extracting structured data from horse-racing program tables. "
        "Output ONLY valid JSON matching the schema. Rules:\n"
        "- 'name' MUST be the horse name (often bold/blue). Do NOT use sire.\n"
        "- If a stacked 'Trainer / Jockey' exists: top line = trainer, bottom line = jockey.\n"
        "- 'odds' MUST be the morning line (ML) fractional odds if present.\n"
        "- Ignore weight and sire. Missing values should be empty strings.\n"
    )

def ocr_user_prompt():
    return (
        "Extract horses from the image(s). Return JSON: {\"horses\": Horse[]}. "
        "Use bankroll=1000 and kelly_fraction=0.25 if not present."
    )

def post_process_horses(items: List[Dict]) -> List[Dict]:
    out = []
    for h in items or []:
        name = (h.get("name") or "").strip()
        if not name:
            continue
        trainer = (h.get("trainer") or "").strip()
        jockey = (h.get("jockey") or "").strip()
        odds = parse_fractional_odds((h.get("odds") or h.get("ml_odds") or "").strip())
        out.append({
            "name": name,
            "trainer": trainer,
            "jockey": jockey,
            "ml_odds": odds,
            "bankroll": h.get("bankroll", FALLBACK_BANKROLL),
            "kelly_fraction": h.get("kelly_fraction", FALLBACK_KELLY),
        })
    return out

def _img_to_data_url(data: bytes, mime: str) -> str:
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:{mime};base64,{b64}"

def _first_page_pdf_to_png(pdf_bytes: bytes) -> bytes:
    # Light fallback: if PIL can't read PDF (likely), we just return empty.
    # In real deployments, use "pdf2image". For now, skip PDFs quietly.
    return b""

async def extract_rows_with_openai(files: List[UploadFile]) -> Dict[str, Any]:
    if not OPENAI_API_KEY:
        return {"parsed_horses": []}

    images: List[Dict[str, str]] = []
    for f in files[:6]:
        data = await f.read()
        mime = f.content_type or "application/octet-stream"
        if mime == "application/pdf":
            png = _first_page_pdf_to_png(data)
            if png:
                images.append({"type": "image_url", "image_url": {"url": _img_to_data_url(png, "image/png")}})
        else:
            # compress overly large images a bit to help OCR
            try:
                im = Image.open(io.BytesIO(data))
                im = im.convert("RGB")
                im.thumbnail((2000, 2000))
                buf = io.BytesIO()
                im.save(buf, format="JPEG", quality=88)
                data = buf.getvalue()
                mime = "image/jpeg"
            except Exception:
                pass
            images.append({"type": "image_url", "image_url": {"url": _img_to_data_url(data, mime)}})

    if not images:
        return {"parsed_horses": []}

    # System instruction: extract table rows into strict JSON using new prompts
    system = ocr_system_prompt()

    user_content = []
    for img in images:
        user_content.append(img)

    body = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [{"type": "text", "text": ocr_user_prompt()}] + user_content},
        ],
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }

    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post("https://api.openai.com/v1/chat/completions", json=body, headers=headers)
        r.raise_for_status()
        data = r.json()
        raw = data["choices"][0]["message"]["content"]
        try:
            import json
            parsed = json.loads(raw)
            rows = parsed.get("parsed_horses", parsed.get("horses", []))
            # Post-process: normalize odds, ignore sire, add defaults
            cleaned = post_process_horses(rows)
            return {"parsed_horses": cleaned}
        except Exception as e:
            print(f"[OpenAI OCR] Parse error: {e}")
            return {"parsed_horses": []}

