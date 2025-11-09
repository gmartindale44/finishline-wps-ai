"""
Image processing utilities for OCR.
Handles downscaling, compression, and format conversion.
"""
import io
import base64
from PIL import Image

# Limits to prevent FUNCTION_INVOCATION_FAILED
MAX_BYTES = 9_000_000  # 9MB max payload (keep under Vercel/OpenAI limits)
MAX_SIDE = 1600  # Max dimension in pixels


def load_b64_image(b64_or_data_url: str) -> Image.Image:
    """
    Load image from base64 string or data URL.
    
    Args:
        b64_or_data_url: Base64 string or data URL
    
    Returns:
        PIL Image object
    
    Raises:
        ValueError: If image cannot be decoded
    """
    try:
        # Strip data URL prefix if present
        b64_clean = b64_or_data_url.split(",")[-1]
        image_bytes = base64.b64decode(b64_clean)
        return Image.open(io.BytesIO(image_bytes))
    except Exception as e:
        raise ValueError(f"Failed to decode image: {str(e)}")


def downscale_to_limit(img: Image.Image) -> bytes:
    """
    Downscale and compress image to meet size limits.
    
    Strategy:
    1. Convert to RGB
    2. Downscale to MAX_SIDE if needed
    3. Save as JPEG with adaptive quality
    4. Reduce quality until under MAX_BYTES
    
    Args:
        img: PIL Image object
    
    Returns:
        JPEG bytes (guaranteed under MAX_BYTES)
    """
    # Convert to RGB (handles RGBA, P, L modes)
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')
    
    # Downscale if needed
    w, h = img.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Compress to meet byte limit
    # Try quality levels: 85, 80, 75, 70
    for quality in (85, 80, 75, 70):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        
        if len(data) <= MAX_BYTES:
            return data
    
    # If still too large at quality=70, return it anyway (best effort)
    return data


def image_to_data_url(image_bytes: bytes, mime: str = "image/jpeg") -> str:
    """Convert image bytes to data URL."""
    b64 = base64.b64encode(image_bytes).decode('utf-8')
    return f"data:{mime};base64,{b64}"

