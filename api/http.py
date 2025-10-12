"""
Minimal FastAPI entrypoint for serving UI.
Serves /public/index.html at / and mounts /public as /static.
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import logging

logger = logging.getLogger("uvicorn.error")

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,
)

# Setup paths - PUBLIC_DIR must point to /public
BASE_DIR = os.path.dirname(__file__)
PUBLIC_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "public"))

# Ensure public directory exists
os.makedirs(PUBLIC_DIR, exist_ok=True)
logger.info(f"[http] PUBLIC_DIR: {PUBLIC_DIR}")

# Mount /public as /static
try:
    app.mount("/static", StaticFiles(directory=PUBLIC_DIR), name="static")
    logger.info(f"[http] ✓ Mounted {PUBLIC_DIR} as /static")
except Exception as e:
    logger.error(f"[http] Failed to mount static: {e}")

# Path to index.html
INDEX_PATH = os.path.join(PUBLIC_DIR, "index.html")

@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve index.html at root"""
    logger.info(f"[http] Checking for index.html at: {INDEX_PATH}")
    
    if os.path.isfile(INDEX_PATH):
        logger.info(f"[http] ✓ Serving index.html from {INDEX_PATH}")
        return FileResponse(INDEX_PATH, media_type="text/html")
    
    # Fallback if missing
    logger.warning(f"[http] index.html NOT FOUND at {INDEX_PATH}")
    logger.warning(f"[http] Files in PUBLIC_DIR: {os.listdir(PUBLIC_DIR) if os.path.isdir(PUBLIC_DIR) else 'DIR NOT FOUND'}")
    
    return HTMLResponse("""<!doctype html>
<html><head><meta charset="utf-8"/><title>FinishLine WPS AI</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-900 text-white p-8">
<h1 class="text-2xl font-bold">FinishLine WPS AI</h1>
<p class="text-gray-300 mt-2">index.html not found in /public</p>
<p class="text-sm text-gray-500 mt-1">Looking at: """ + INDEX_PATH + """</p>
</body></html>""")

@app.get("/index.html", response_class=HTMLResponse)
async def index_html():
    """Serve index.html"""
    return await root()

@app.get("/health")
async def health():
    """Health check"""
    return {"ok": True, "status": "healthy"}

# Log 404s for static to help debug
@app.exception_handler(404)
async def not_found_handler(request, exc):
    """Log static 404s"""
    path = str(request.url.path)
    if path.startswith("/static/"):
        logger.warning(f"[static-404] {path}")
    return JSONResponse({"detail": "Not Found", "path": path}, status_code=404)

logger.info("[http] ✓ HTTP server initialized")
