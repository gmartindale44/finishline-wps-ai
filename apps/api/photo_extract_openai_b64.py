"""
Hardened OCR endpoint with strict JSON envelope and validation.
Prevents FUNCTION_INVOCATION_FAILED by validating payloads and handling all errors.
"""
import logging
import base64
import asyncio
from typing import List, Optional
from fastapi import Request
from pydantic import BaseModel, Field, validator
from .common.schemas import json_ok, json_err, make_request_id

logger = logging.getLogger(__name__)

# Vercel request body limit is ~4.5MB, but we need headroom for JSON overhead
MAX_DECODED_SIZE_MB = 3.5
MAX_IMAGES = 6


class OcrRequest(BaseModel):
    """OCR request payload schema."""
    images: List[str] = Field(..., description="List of base64-encoded images (data URLs or raw base64)")
    max_pages: Optional[int] = Field(None, description="Optional max pages for PDF")
    
    @validator("images")
    def validate_images_not_empty(cls, v):
        if not v or len(v) == 0:
            raise ValueError("images list cannot be empty")
        if len(v) > MAX_IMAGES:
            raise ValueError(f"Too many images (max {MAX_IMAGES})")
        return v


def estimate_decoded_size_mb(base64_string: str) -> float:
    """
    Estimate decoded size of base64 string in MB.
    Base64 encoding is ~4/3 of original size.
    """
    # Remove data URL prefix if present
    if "," in base64_string:
        base64_string = base64_string.split(",", 1)[1]
    
    # Calculate decoded size
    size_bytes = (len(base64_string) * 3) / 4
    return size_bytes / (1024 * 1024)


async def photo_extract_openai_b64_handler(request: Request, body: dict):
    """
    Extract text/data from images using OpenAI Vision API.
    
    This endpoint:
    - Validates Content-Type
    - Validates payload size
    - Calls OpenAI with timeouts and retries
    - Returns structured JSON (ApiOk or ApiErr)
    - NEVER throws unhandled exceptions
    
    Request body:
        {
            "images": ["data:image/jpeg;base64,...", ...],
            "max_pages": 10  // optional
        }
    
    Success response (ApiOk):
        {
            "ok": true,
            "data": {
                "spans": [...],
                "raw": "...",
                "count": 5
            },
            "requestId": "abc123..."
        }
    
    Error response (ApiErr):
        {
            "ok": false,
            "error": {
                "code": "payload_too_large",
                "message": "Image too large; please upload a smaller image",
                "details": {...}
            },
            "requestId": "abc123..."
        }
    """
    request_id = getattr(request.state, "request_id", make_request_id())
    
    try:
        # 1. Validate Content-Type
        content_type = request.headers.get("content-type", "")
        if not content_type.startswith("application/json"):
            logger.warning(f"[{request_id}] Bad content-type: {content_type}")
            return json_err(
                code="bad_content_type",
                message="Expected application/json",
                request_id=request_id,
                status=415
            )
        
        # 2. Validate request body schema
        try:
            ocr_request = OcrRequest(**body)
        except Exception as e:
            logger.warning(f"[{request_id}] Schema validation failed: {e}")
            return json_err(
                code="invalid_request",
                message="Request validation failed",
                request_id=request_id,
                status=400,
                details=str(e)
            )
        
        # 3. Preflight: Check for empty images (already validated by pydantic, but explicit check)
        if len(ocr_request.images) == 0:
            return json_err(
                code="no_images",
                message="No images provided",
                request_id=request_id,
                status=400
            )
        
        # 4. Preflight: Validate payload sizes
        for i, img_b64 in enumerate(ocr_request.images):
            size_mb = estimate_decoded_size_mb(img_b64)
            logger.info(f"[{request_id}] Image {i+1}/{len(ocr_request.images)}: ~{size_mb:.2f}MB decoded")
            
            if size_mb > MAX_DECODED_SIZE_MB:
                return json_err(
                    code="payload_too_large",
                    message=f"Image {i+1} too large (~{size_mb:.1f}MB); please upload a smaller image",
                    request_id=request_id,
                    status=413,
                    details={"index": i, "size_mb": round(size_mb, 2), "max_mb": MAX_DECODED_SIZE_MB}
                )
        
        # 5. Import OCR provider (lazy import to avoid startup failures)
        try:
            from .openai_ocr import run_openai_ocr_on_bytes, decode_data_url_or_b64
        except ImportError as e:
            logger.error(f"[{request_id}] OCR provider import failed: {e}")
            return json_err(
                code="ocr_unavailable",
                message="OCR service unavailable",
                request_id=request_id,
                status=503,
                details="OCR provider not configured"
            )
        
        # 6. Process images with timeout and retry
        PER_IMAGE_TIMEOUT = 25  # seconds
        TOTAL_BUDGET = 45  # seconds (stay under Vercel 60s limit)
        MAX_RETRIES = 1
        
        all_spans = []
        raw_results = []
        
        async def process_with_retry(img_b64: str, img_index: int):
            """Process single image with retry on transient errors."""
            for attempt in range(MAX_RETRIES + 1):
                try:
                    # Decode image
                    content = decode_data_url_or_b64(img_b64)
                    
                    # Call OCR with timeout
                    result = await asyncio.wait_for(
                        run_openai_ocr_on_bytes(content, filename=f"image_{img_index+1}.jpg"),
                        timeout=PER_IMAGE_TIMEOUT
                    )
                    
                    return result
                    
                except asyncio.TimeoutError:
                    logger.warning(f"[{request_id}] Image {img_index+1} timed out after {PER_IMAGE_TIMEOUT}s")
                    if attempt == MAX_RETRIES:
                        raise
                    await asyncio.sleep(1)  # Brief backoff
                    
                except Exception as e:
                    # Check if it's a transient error (429, 5xx)
                    error_str = str(e).lower()
                    is_transient = "429" in error_str or "502" in error_str or "503" in error_str or "timeout" in error_str
                    
                    if attempt < MAX_RETRIES and is_transient:
                        logger.warning(f"[{request_id}] Image {img_index+1} attempt {attempt+1} failed (transient): {e}")
                        await asyncio.sleep(1)  # Brief backoff
                        continue
                    
                    # Non-transient or final retry
                    raise
        
        # Process all images with total timeout
        try:
            tasks = [process_with_retry(img, i) for i, img in enumerate(ocr_request.images)]
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=TOTAL_BUDGET
            )
            
            # Collect results and handle per-image errors
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.error(f"[{request_id}] Image {i+1} failed: {result}")
                    # Don't fail entire request for one image
                    raw_results.append({"error": str(result), "index": i})
                elif isinstance(result, dict):
                    horses = result.get("horses", [])
                    all_spans.extend(horses)
                    raw_results.append({"horses": horses, "index": i})
                else:
                    logger.warning(f"[{request_id}] Image {i+1} returned unexpected type: {type(result)}")
                    raw_results.append({"error": "unexpected_result_type", "index": i})
        
        except asyncio.TimeoutError:
            logger.error(f"[{request_id}] Total processing exceeded {TOTAL_BUDGET}s budget")
            return json_err(
                code="timeout",
                message=f"OCR processing exceeded {TOTAL_BUDGET}s time budget",
                request_id=request_id,
                status=504,
                details={"budget_seconds": TOTAL_BUDGET}
            )
        
        except Exception as e:
            # Provider error (network, API error, etc.)
            logger.exception(f"[{request_id}] OCR provider failed")
            return json_err(
                code="ocr_provider_error",
                message="OCR provider failed",
                request_id=request_id,
                status=502,
                details={"error": str(e)[:200]}
            )
        
        # 7. Return success with extracted data
        logger.info(f"[{request_id}] OCR success: {len(all_spans)} total spans from {len(ocr_request.images)} images")
        
        return json_ok(
            data={
                "spans": all_spans,
                "raw": raw_results,
                "count": len(all_spans)
            },
            request_id=request_id
        )
    
    except Exception as e:
        # Final catch-all (should never reach here due to middleware, but belt-and-suspenders)
        logger.exception(f"[{request_id}] Unhandled exception in OCR handler")
        return json_err(
            code="internal_error",
            message="Internal server error",
            request_id=request_id,
            status=500,
            details=str(e)[:200]
        )

