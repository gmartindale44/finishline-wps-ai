"""
OpenAI Vision OCR for Horse Racing Photos
Extracts structured horse data from DRF-like race tables using GPT-4 Vision
"""
from __future__ import annotations
import base64, io
from typing import List, Dict, Any
from fastapi import UploadFile
import os, httpx
from PIL import Image

OPENAI_API_KEY = os.getenv("FINISHLINE_OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

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

    # System instruction: extract table rows into strict JSON
    system = (
        "You are an OCR parser for horse race tables. "
        "Input is a screenshot of a race card with three columns:\n"
        "Left: 'Horse (last) / Sire' (first line is the horse name, next line is sire — ignore the sire).\n"
        "Middle: 'Trainer / Jockey' (first line trainer, second line jockey).\n"
        "Right: 'ML' with moneyline odds like '8/1', '9/2', '5/2' or whole numbers.\n\n"
        "Return STRICT JSON only (no text), shape:\n"
        "{ \"parsed_horses\": [ {\"name\":\"...\",\"trainer\":\"...\",\"jockey\":\"...\",\"ml_odds\":\"...\"}, ... ] }\n"
        "Rules:\n"
        "- name = first line of left column (drop the sire).\n"
        "- trainer = first line of middle column.\n"
        "- jockey = second line of middle column.\n"
        "- ml_odds = the ML odds string from right column (e.g., '8/1').\n"
        "- Do not make up names. If a row is incomplete, skip it.\n"
    )

    user_content = []
    for img in images:
        user_content.append(img)

    body = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
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
            rows = parsed.get("parsed_horses", [])
            # Clean up a bit
            cleaned = []
            for h in rows:
                name = (h.get("name") or "").strip()
                trainer = (h.get("trainer") or "").strip()
                jockey = (h.get("jockey") or "").strip()
                odds = (h.get("ml_odds") or h.get("odds") or "").strip()
                if not name or not odds:
                    continue
                cleaned.append({"name": name, "trainer": trainer, "jockey": jockey, "ml_odds": odds})
            return {"parsed_horses": cleaned}
        except Exception:
            return {"parsed_horses": []}

