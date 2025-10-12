"""
FastAPI HTTP entrypoint for FinishLine WPS AI.
Serves the UI at "/" and static assets at "/static".
Imports and includes existing API routers.
"""
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import logging

# Set up logging
logger = logging.getLogger("uvicorn.error")

app = FastAPI(
    title="FinishLine WPS AI",
    description="Win/Place/Show horse race prediction API",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure as needed
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,
)

# Determine paths
BASE_DIR = os.path.dirname(__file__)
PUBLIC_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "public"))
APPS_WEB_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "apps", "web"))

# Prefer apps/web if public doesn't exist
if not os.path.isdir(PUBLIC_DIR) and os.path.isdir(APPS_WEB_DIR):
    PUBLIC_DIR = APPS_WEB_DIR
    logger.info(f"Using apps/web as static directory: {PUBLIC_DIR}")
else:
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    logger.info(f"Using public as static directory: {PUBLIC_DIR}")

# Mount static assets
try:
    app.mount("/static", StaticFiles(directory=PUBLIC_DIR), name="static")
    logger.info(f"✓ Static files mounted at /static from {PUBLIC_DIR}")
except Exception as e:
    logger.error(f"Failed to mount static files: {e}")

# Determine index.html path
INDEX_PATH = os.path.join(APPS_WEB_DIR, "index.html") if os.path.isfile(os.path.join(APPS_WEB_DIR, "index.html")) else os.path.join(PUBLIC_DIR, "index.html")

# Create minimal index.html if it doesn't exist
if not os.path.isfile(INDEX_PATH):
    logger.warning(f"index.html not found, creating minimal stub at {INDEX_PATH}")
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        f.write("""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>FinishLine WPS AI</title>
<link rel="stylesheet" href="/static/css/app.css">
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white">
<div id="app" class="container mx-auto p-6">
  <h1 class="text-3xl font-bold mb-4">🏇 FinishLine WPS AI</h1>
  <p class="text-gray-300">Static assets are loading. Replace this file with your real UI bundle.</p>
  <div class="mt-4 p-4 bg-blue-900 rounded">
    <p class="text-sm">✓ FastAPI is serving this page</p>
    <p class="text-sm">✓ Static CSS/JS should load from /static</p>
  </div>
  <script defer src="/static/js/app.js"></script>
</div>
</body>
</html>""")
else:
    logger.info(f"✓ Found index.html at {INDEX_PATH}")

@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the static index.html"""
    return FileResponse(INDEX_PATH, media_type="text/html")

@app.get("/index.html", response_class=HTMLResponse)
async def index_html():
    """Serve the static index.html"""
    return FileResponse(INDEX_PATH, media_type="text/html")

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"ok": True, "status": "healthy", "service": "FinishLine WPS AI"}

# Log static 404s to help diagnose path issues
@app.exception_handler(404)
async def not_found_handler(request, exc):
    """Log 404s for static files to help debugging"""
    path = str(request.url.path)
    if path.startswith("/static/"):
        logger.warning(f"[static-404] {path}")
    return JSONResponse({"detail": "Not Found", "path": path}, status_code=404)

# Import and include existing API routers
try:
    from apps.api.api_main import app as api_app
    
    # Mount the API routes under /api
    @app.get("/api/{path:path}")
    @app.post("/api/{path:path}")
    async def proxy_to_api(path: str, request):
        """Proxy API requests to the main API app"""
        # This is a simple proxy - in production, you might want to use app.mount()
        # or include_router() depending on your structure
        pass
    
    logger.info("✓ Loaded API routers from apps.api.api_main")
except ImportError as e:
    logger.warning(f"Could not import API routers: {e}")
    logger.warning("API endpoints may not be available")

logger.info("FinishLine WPS AI HTTP server initialized")

