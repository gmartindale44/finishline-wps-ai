"""
OpenAI Vision OCR for Horse Racing Photos
Extracts structured horse data from DRF-like race tables using GPT-4 Vision
"""
from __future__ import annotations
import os, re, io, base64, logging
from typing import List, Dict, Any
from fastapi import UploadFile
from PIL import Image
from openai import OpenAI

logger = logging.getLogger("finishline")
logger.setLevel(logging.INFO)

FALLBACK_BANKROLL = 1000
FALLBACK_KELLY = 0.25

def _env(name: str, default: str = "") -> str:
    v = os.getenv(name)
    return v if v is not None else default

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
        "You are an expert at extracting structured data from DRF-style race tables. "
        "Extract ONLY horses that appear in the table and output STRICT JSON per schema.\n"
        "Layout cues:\n"
        "• Left column header: 'Horse (last) / Sire' — the first line in BLUE/BOLD is the HORSE NAME.\n"
        "  The small grey line beneath it is the SIRE (IGNORE sire; do not place sire in name).\n"
        "• Middle column header: 'Trainer / Jockey' — two stacked lines: top is TRAINER, bottom is JOCKEY.\n"
        "• Right column header: 'ML' — this is MORNING LINE fractional odds like '6/1', '9/2', '7/2'.\n"
        "Extraction rules:\n"
        "1) name MUST be the blue/bold horse name (no sire, no numbers in parentheses).\n"
        "2) trainer = top line from Trainer/Jockey column; jockey = bottom line from that column.\n"
        "3) odds = the right-most ML fractional odds; normalize to 'A/B' (e.g., '3/1', '9/2').\n"
        "4) Ignore sire, weight, and any parenthetical ratings like (66). Leave missing values as empty strings.\n"
        "5) Output ONLY horses listed in the image. Do not invent or include any non-visible horse.\n"
    )

# Removed - now using ocr_user_prompt_json() and ocr_user_prompt_tsv()

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
            "odds": odds,
            "bankroll": h.get("bankroll", FALLBACK_BANKROLL),
            "kelly_fraction": h.get("kelly_fraction", FALLBACK_KELLY),
        })
    return out

def decode_data_url_or_b64(data_b64: str) -> bytes:
    """Decode plain base64 or data URL to bytes"""
    if data_b64.startswith("data:"):
        _, b64 = data_b64.split(",", 1)
        return base64.b64decode(b64)
    return base64.b64decode(data_b64)

async def run_openai_ocr_on_bytes(content: bytes, filename: str) -> Dict[str, Any]:
    """Run OpenAI Vision OCR on raw image bytes"""
    if not OPENAI_API_KEY:
        return {"horses": []}
    
    # Create fake upload file from bytes
    from io import BytesIO
    fake_file_list = []
    
    # Detect mime type from filename
    mime = "image/jpeg"
    if filename.lower().endswith('.png'):
        mime = "image/png"
    elif filename.lower().endswith('.webp'):
        mime = "image/webp"
    
    # Use existing image compression logic
    try:
        im = Image.open(BytesIO(content))
        im = im.convert("RGB")
        im.thumbnail((2000, 2000))
        buf = BytesIO()
        im.save(buf, format="JPEG", quality=88)
        content = buf.getvalue()
        mime = "image/jpeg"
    except Exception:
        pass
    
    # Create data URL
    b64 = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{mime};base64,{b64}"
    
    # Build OpenAI Vision API request
    system = ocr_system_prompt()
    user_content = [
        {"type": "text", "text": ocr_user_prompt()},
        {"type": "image_url", "image_url": {"url": data_url}}
    ]
    
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
            import json as json_module
            parsed = json_module.loads(raw)
            rows = parsed.get("parsed_horses", parsed.get("horses", []))
            cleaned = post_process_horses(rows)
            return {"horses": cleaned}
        except Exception as e:
            print(f"[OpenAI OCR] Parse error: {e}")
            return {"horses": []}

def decode_data_url_or_b64(data_b64: str) -> bytes:
    """Decode plain base64 or data URL to bytes"""
    if data_b64.startswith("data:"):
        _, b64 = data_b64.split(",", 1)
        return base64.b64decode(b64)
    return base64.b64decode(data_b64)

def _img_to_data_url(data: bytes, mime: str) -> str:
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:{mime};base64,{b64}"

def _first_page_pdf_to_png(pdf_bytes: bytes) -> bytes:
    # Light fallback: if PIL can't read PDF (likely), we just return empty.
    # In real deployments, use "pdf2image". For now, skip PDFs quietly.
    return b""

def _smart_downscale(png_bytes: bytes, max_w=1600, max_h=1600) -> bytes:
    """Downscale large images to keep request size small"""
    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        img.thumbnail((max_w, max_h))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85)
        return out.getvalue()
    except Exception:
        return png_bytes

def _openai_client() -> OpenAI:
    api_key = _env("FINISHLINE_OPENAI_API_KEY") or _env("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing FINISHLINE_OPENAI_API_KEY/OPENAI_API_KEY")
    # 25s client-side timeout to align with function budget
    return OpenAI(api_key=api_key, timeout=25.0)

def _model_name() -> str:
    return _env("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

def _json_schema():
    return {
        "name": "FinishLineHorses",
        "schema": {
            "type": "object",
            "properties": {
                "horses": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["name"],
                        "properties": {
                            "name": {"type": "string"},
                            "odds": {"type": "string"},
                            "trainer": {"type": "string"},
                            "jockey": {"type": "string"},
                            "bankroll": {"type": "number"},
                            "kelly_fraction": {"type": "number"}
                        },
                        "additionalProperties": False
                    }
                }
            },
            "required": ["horses"],
            "additionalProperties": False
        },
        "strict": True
    }

# Downscale and optimize images to reduce payload size and improve reliability
def _prepare_png_bytes(src_bytes: bytes, max_edge=1600) -> Tuple[bytes, str]:
    """
    Downscale and optimize image for OCR.
    Reduced max_edge to 1600px for better reliability and faster processing.
    """
    try:
        img = Image.open(io.BytesIO(src_bytes))
        
        # Convert to RGB (handles various formats)
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        
        # Downscale if needed
        if max(img.size) > max_edge:
            scale = max_edge / float(max(img.size))
            new_size = (max(1, int(img.size[0]*scale)), max(1, int(img.size[1]*scale)))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        
        # Save as JPEG for smaller payload (vs PNG)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue(), "image/jpeg"
    except Exception as e:
        logger.warning(f"Image processing failed: {e}, using original")
        return src_bytes, "image/png"

def _openai_client() -> OpenAI:
    api_key = _env("FINISHLINE_OPENAI_API_KEY") or _env("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing FINISHLINE_OPENAI_API_KEY/OPENAI_API_KEY")
    # 25s client-side timeout to align with function budget
    return OpenAI(api_key=api_key, timeout=25.0)

def _model_name() -> str:
    return _env("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

def _json_schema_def():
    return {
        "name": "FinishLineHorses",
        "schema": {
            "type": "object",
            "properties": {
                "horses": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["name"],
                        "properties": {
                            "name": {"type": "string"},
                            "odds": {"type": "string"},
                            "trainer": {"type": "string"},
                            "jockey": {"type": "string"},
                            "bankroll": {"type": "number"},
                            "kelly_fraction": {"type": "number"}
                        },
                        "additionalProperties": False
                    }
                }
            },
            "required": ["horses"],
            "additionalProperties": False
        },
        "strict": True
    }

def ocr_user_prompt_json():
    return (
        "Extract horses from the table image.\n"
        "Return JSON matching the provided schema with key 'horses'.\n"
        "Default bankroll=1000 and kelly_fraction=0.25."
    )

def ocr_user_prompt_tsv():
    return (
        "If JSON extraction is difficult, output ONLY a TSV (tab-separated) list of rows:\n"
        "name\ttrainer\tjockey\todds\n"
        "Use one row per horse visible in the image. Do not include sire or extra commentary."
    )

def _to_image_content(b64: str, mime: str):
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}

def _messages_for(mode: str, image_b64: str, mime: str):
    if mode == "json":
        return [
            {"role": "system", "content": ocr_system_prompt()},
            {"role": "user", "content": [
                {"type": "text", "text": ocr_user_prompt_json()},
                _to_image_content(image_b64, mime)
            ]}
        ]
    else:  # tsv
        return [
            {"role": "system", "content": ocr_system_prompt()},
            {"role": "user", "content": [
                {"type": "text", "text": ocr_user_prompt_tsv()},
                _to_image_content(image_b64, mime)
            ]}
        ]

def _call_openai(messages, expect_json: bool):
    client = _openai_client().with_options(timeout=25.0)
    model = _model_name()
    if expect_json:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_schema", "json_schema": _json_schema_def()},
            temperature=0.0
        )
        content_text = response.choices[0].message.content
        import json as json_module
        return json_module.loads(content_text)
    else:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.0
        )
        return response.choices[0].message.content or ""

def _parse_tsv(tsv: str) -> List[Dict]:
    rows = []
    for line in tsv.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("name\t"):  # skip header
            continue
        parts = [p.strip() for p in line.split("\t")]
        if len(parts) < 4: 
            continue
        name, trainer, jockey, odds = parts[:4]
        rows.append({
            "name": name,
            "trainer": trainer,
            "jockey": jockey,
            "odds": odds,
            "bankroll": FALLBACK_BANKROLL,
            "kelly_fraction": FALLBACK_KELLY
        })
    return post_process_horses(rows)

async def run_openai_ocr_on_bytes(content: bytes, filename: str) -> Dict[str, Any]:
    """Run OpenAI Vision OCR with JSON schema first, TSV fallback if empty"""
    # Prepare PNG and base64
    png_bytes, mime = _prepare_png_bytes(content, max_edge=2048)
    b64 = base64.b64encode(png_bytes).decode("utf-8")

    # Pass 1: strict JSON schema
    try:
        messages = _messages_for("json", b64, mime)
        parsed = _call_openai(messages, expect_json=True)
        horses = post_process_horses((parsed or {}).get("horses", []))
        if horses:
            logger.info(f"[openai_ocr] JSON schema extracted {len(horses)} horses")
            return {"horses": horses}
        logger.warning("[openai_ocr] JSON schema returned no horses; trying TSV fallback.")
    except Exception as e:
        logger.warning(f"[openai_ocr] JSON extraction failed: {e}; trying TSV fallback.")

    # Pass 2: TSV fallback
    try:
        messages = _messages_for("tsv", b64, mime)
        tsv = _call_openai(messages, expect_json=False)
        horses = _parse_tsv(tsv or "")
        if horses:
            logger.info(f"[openai_ocr] TSV fallback extracted {len(horses)} horses")
            return {"horses": horses}
        logger.warning("[openai_ocr] TSV fallback returned no horses.")
    except Exception as e:
        logger.warning(f"[openai_ocr] TSV fallback failed: {e}")

    # Nothing parsed
    logger.error("[openai_ocr] Both JSON and TSV failed to extract horses")
    return {"horses": []}

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

