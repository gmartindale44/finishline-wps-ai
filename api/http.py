"""
Minimal FastAPI entrypoint for serving UI.
Static files are served directly by Vercel from /public.
"""
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import os

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

# Path to index.html
BASE_DIR = os.path.dirname(__file__)
INDEX_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "public", "index.html"))

@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve index.html at root"""
    if os.path.isfile(INDEX_PATH):
        return FileResponse(INDEX_PATH, media_type="text/html")
    
    # Minimal fallback
    return HTMLResponse("""<!doctype html>
<html><head><meta charset="utf-8"/><title>FinishLine WPS AI</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-900 text-white p-8">
<h1 class="text-2xl font-bold">FinishLine WPS AI</h1>
<p class="text-gray-300 mt-2">index.html not found in /public</p>
</body></html>""")

@app.get("/index.html", response_class=HTMLResponse)
async def index_html():
    """Serve index.html"""
    return await root()

@app.get("/health")
async def health():
    """Health check"""
    return {"ok": True, "status": "healthy"}
