from __future__ import annotations
import os, sys, traceback, json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="FinishLine WPS AI")

# ---- Stable paths for Vercel/CI/local ---------------------------------------
BASE_DIR = Path(__file__).resolve().parent
# public folder is a sibling of api/ (…/project/public and …/project/api)
PUBLIC_DIR = (BASE_DIR / ".." / "public").resolve()
INDEX_HTML = PUBLIC_DIR / "index.html"

# Log what we resolved (visible in Vercel logs)
print(f"[BOOT] BASE_DIR={BASE_DIR}")
print(f"[BOOT] PUBLIC_DIR={PUBLIC_DIR} exists={PUBLIC_DIR.exists()}")
print(f"[BOOT] INDEX_HTML={INDEX_HTML} exists={INDEX_HTML.exists()}")

# Serve static files under /static (CSS/JS/images)
if PUBLIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR)), name="static")


# ---- Helpers -----------------------------------------------------------------
def error_payload(msg: str, detail: dict | None = None, status: int = 500):
    payload = {"ok": False, "error": msg}
    if detail:
        payload["detail"] = detail
    return JSONResponse(payload, status_code=status)

def log_exception(where: str, exc: Exception):
    print(f"[ERROR] {where}: {exc.__class__.__name__}: {exc}", file=sys.stderr, flush=True)
    traceback.print_exc()


# ---- Health & root -----------------------------------------------------------
@app.get("/api/healthz")
async def healthz():
    return {"ok": True, "public_exists": PUBLIC_DIR.exists(), "index_exists": INDEX_HTML.exists()}

@app.get("/")
async def root():
    # Try to serve the real SPA; never crash if it's missing.
    if INDEX_HTML.exists():
        return FileResponse(str(INDEX_HTML))
    # Fallback so we don't 500 if index.html isn't there yet.
    fallback = f"""
    <!doctype html><html><head><meta charset="utf-8"/>
    <title>FinishLine WPS AI</title></head>
    <body style="background:#0b0b14;color:#fff;font-family:system-ui;padding:24px">
      <h1>FinishLine WPS AI</h1>
      <p>index.html not found at <code>{INDEX_HTML}</code></p>
      <p>Put your UI in <code>/public</code> and reference assets via <code>/static/…</code>.</p>
      <p><a style="color:#7aa2ff" href="/api/healthz">/api/healthz</a></p>
    </body></html>
    """
    return HTMLResponse(fallback)


# ---- Example guards for your existing endpoints ------------------------------
# Keep your real handlers; wrap bodies in try/except to avoid hard crashes.
@app.post("/api/extract/smoke")
async def extract_smoke():
    try:
        return {"ok": True, "step": "extract"}
    except Exception as e:
        log_exception("extract_smoke", e)
        return error_payload("extract failed")

@app.post("/api/research/smoke")
async def research_smoke():
    try:
        return {"ok": True, "step": "research"}
    except Exception as e:
        log_exception("research_smoke", e)
        return error_payload("research failed")

@app.post("/api/predict/smoke")
async def predict_smoke():
    try:
        return {"ok": True, "step": "predict"}
    except Exception as e:
        log_exception("predict_smoke", e)
        return error_payload("predict failed")

# NOTE: For your real /api/photo_extract, /api/research_predict, /api/predict,
# keep their logic but add the same try/except + error_payload + log_exception
# so exceptions don't crash the function.
