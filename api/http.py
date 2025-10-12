from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

app = FastAPI(title="FinishLine WPS AI")

# Include API routers
try:
    from apps.api.photo_extract_endpoint import router as ocr_router
    app.include_router(ocr_router)
    logger.info("✓ Included OCR router")
except ImportError as e:
    logger.warning(f"Could not import OCR router: {e}")

try:
    from apps.api.healthz_endpoint import router as health_router
    app.include_router(health_router)
    logger.info("✓ Included health router")
except ImportError as e:
    logger.warning(f"Could not import health router: {e}")

# ---- Stable paths for Vercel/CI/local ---------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = (BASE_DIR / ".." / "public").resolve()
INDEX_HTML = PUBLIC_DIR / "index.html"

# Log what we resolved (visible in Vercel logs)
print(f"[BOOT] BASE_DIR={BASE_DIR}", flush=True)
print(f"[BOOT] PUBLIC_DIR={PUBLIC_DIR} exists={PUBLIC_DIR.exists()}", flush=True)
print(f"[BOOT] INDEX_HTML={INDEX_HTML} exists={INDEX_HTML.exists()}", flush=True)

# Mount static files if public directory exists
if PUBLIC_DIR.exists():
    try:
        app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR)), name="static")
        print(f"[BOOT] Mounted /static from {PUBLIC_DIR}", flush=True)
    except Exception as e:
        print(f"[BOOT] Could not mount /static: {e}", flush=True)

# Note: Main API endpoints now handled by imported routers:
# - /api/finishline/photo_extract_openai_b64 → apps/api/photo_extract_endpoint.py  
# - /api/healthz → apps/api/healthz_endpoint.py
# - /api/finishline/research_predict → apps/api/api_main.py (existing)
# - /api/finishline/predict → apps/api/api_main.py (existing)

# ---- UI Serving --------------------------------------------------------------

@app.get("/")
async def root():
    """Serve index.html at root"""
    if INDEX_HTML.exists():
        return FileResponse(str(INDEX_HTML))
    
    # Fallback HTML if index.html not found
    fallback = f"""<!doctype html>
<html><head><meta charset="utf-8"/>
<title>FinishLine WPS AI</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white p-8">
<h1 class="text-2xl font-bold">FinishLine WPS AI</h1>
<p class="text-gray-300 mt-2">index.html not found at: {INDEX_HTML}</p>
<p class="text-sm text-gray-500 mt-1">PUBLIC_DIR exists: {PUBLIC_DIR.exists()}</p>
<p class="mt-4"><a href="/api/healthz" class="text-blue-400">Check /api/healthz</a></p>
</body></html>"""
    return HTMLResponse(fallback)

@app.get("/index.html")
async def index_html():
    return await root()
