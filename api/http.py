from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

app = FastAPI(title="FinishLine WPS AI")

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

# ---- API Endpoints (matching frontend expectations) -------------------------

@app.post("/api/finishline/photo_extract_openai_b64")
async def photo_extract_openai_b64(request: Request):
    """OCR endpoint - always returns JSON"""
    try:
        body = await request.json()
        images_b64 = body.get("images_b64", []) or body.get("images", [])
        
        # Placeholder for real OCR logic
        result_text = f"Simulated OCR extracted {len(images_b64)} images"
        
        # Return in expected format
        return {"ok": True, "horses": [], "result": result_text}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

@app.post("/api/finishline/research_predict")
async def research_predict(data: dict):
    """Analyze/Predict endpoint - always returns JSON"""
    try:
        horses = data.get("horses", [])
        # Simulated prediction response
        return {
            "ok": True,
            "win": {"name": "Simulated Horse 1", "prob": 0.35},
            "place": {"name": "Simulated Horse 2", "prob": 0.28},
            "show": {"name": "Simulated Horse 3", "prob": 0.22}
        }
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

@app.post("/api/finishline/predict")
async def predict_endpoint(data: dict):
    """Predict endpoint - always returns JSON"""
    try:
        horses = data.get("horses", [])
        # Simulated prediction response
        return {
            "ok": True,
            "predictions": {
                "win": {"name": "Simulated Horse 1", "prob": 0.35},
                "place": {"name": "Simulated Horse 2", "prob": 0.28},
                "show": {"name": "Simulated Horse 3", "prob": 0.22}
            }
        }
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

@app.get("/api/healthz")
@app.get("/api/finishline/health")
async def healthz():
    return {"ok": True, "status": "healthy", "public_exists": PUBLIC_DIR.exists(), "index_exists": INDEX_HTML.exists()}

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
