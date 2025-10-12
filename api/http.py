"""
FastAPI HTTP entrypoint for FinishLine WPS AI.
Serves UI at "/" and static assets at "/static" from /public directory.
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import logging

logger = logging.getLogger("uvicorn.error")

app = FastAPI(
    title="FinishLine WPS AI",
    description="Win/Place/Show horse race prediction API",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,
)

# Setup paths
BASE_DIR = os.path.dirname(__file__)
PUBLIC_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "public"))

# Ensure public directory exists
os.makedirs(PUBLIC_DIR, exist_ok=True)
logger.info(f"Public directory: {PUBLIC_DIR}")

# Mount /public as /static
try:
    app.mount("/static", StaticFiles(directory=PUBLIC_DIR), name="static")
    logger.info(f"✓ Mounted /public as /static")
except Exception as e:
    logger.error(f"Failed to mount static files: {e}")

# Path to index.html
INDEX_PATH = os.path.join(PUBLIC_DIR, "index.html")

@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the UI at root"""
    if os.path.isfile(INDEX_PATH):
        logger.info(f"Serving index.html from {INDEX_PATH}")
        return FileResponse(INDEX_PATH, media_type="text/html")
    
    # Fallback if index.html is missing
    logger.warning("index.html not found, serving fallback")
    html = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>FinishLine WPS AI</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white">
    <div class="max-w-4xl mx-auto p-8">
        <h1 class="text-3xl font-bold mb-4">🏇 FinishLine WPS AI</h1>
        <div class="bg-gray-800 rounded-lg p-6">
            <h2 class="text-xl font-semibold mb-2">Setup Required</h2>
            <p class="text-gray-300">
                index.html not found in /public directory.<br>
                Place your UI files in <code class="bg-gray-700 px-2 py-1 rounded">public/</code> 
                and reference assets as <code class="bg-gray-700 px-2 py-1 rounded">/static/...</code>
            </p>
            <div class="mt-4 text-sm text-gray-400">
                <p>✓ FastAPI is running</p>
                <p>✓ Static files should be accessible at /static/*</p>
            </div>
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(html)

@app.get("/index.html", response_class=HTMLResponse)
async def index_html():
    """Serve index.html"""
    return await root()

@app.get("/health")
async def health():
    """Health check"""
    return {"ok": True, "status": "healthy", "service": "FinishLine WPS AI"}

# Log 404s for static files to help debugging
@app.exception_handler(404)
async def not_found_handler(request, exc):
    """Log 404s for static files"""
    path = str(request.url.path)
    if path.startswith("/static/"):
        logger.warning(f"[static-404] {path}")
    return JSONResponse({"detail": "Not Found", "path": path}, status_code=404)

logger.info("✓ FinishLine WPS AI HTTP server initialized")
