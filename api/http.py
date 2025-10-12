from __future__ import annotations
import os, sys, traceback, json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response

app = FastAPI(title="FinishLine WPS AI")

# ---- Stable paths for Vercel/CI/local ---------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = (BASE_DIR / ".." / "public").resolve()
INDEX_HTML = PUBLIC_DIR / "index.html"

# Log what we resolved (visible in Vercel logs)
print(f"[BOOT] BASE_DIR={BASE_DIR}", flush=True)
print(f"[BOOT] PUBLIC_DIR={PUBLIC_DIR} exists={PUBLIC_DIR.exists()}", flush=True)
print(f"[BOOT] INDEX_HTML={INDEX_HTML} exists={INDEX_HTML.exists()}", flush=True)

# Try to mount static files (may fail on Vercel if public doesn't deploy)
try:
    if PUBLIC_DIR.exists():
        from fastapi.staticfiles import StaticFiles
        app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR)), name="static")
        print(f"[BOOT] Mounted /static from {PUBLIC_DIR}", flush=True)
except Exception as e:
    print(f"[BOOT] Could not mount /static: {e}", flush=True)


# ---- Helpers -----------------------------------------------------------------
def error_payload(msg: str, detail: dict | None = None, status: int = 500):
    payload = {"ok": False, "error": msg}
    if detail:
        payload["detail"] = detail
    return JSONResponse(payload, status_code=status)

def log_exception(where: str, exc: Exception):
    print(f"[ERROR] {where}: {exc.__class__.__name__}: {exc}", file=sys.stderr, flush=True)
    traceback.print_exc()


# ---- Embedded UI (fallback if /public doesn't deploy) ----------------------
EMBEDDED_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>FinishLine WPS AI</title>
  <style>
    .page{background:#0b0b14;color:#fff;font-family:system-ui;margin:0;min-height:100vh}
    .wrap{max-width:900px;margin:0 auto;padding:24px}
    .btns{display:flex;gap:8px;margin:12px 0}
    .btn{background:#4f46e5;border:none;color:#fff;padding:.6rem 1rem;border-radius:.6rem;cursor:pointer}
    .btn:hover{filter:brightness(1.1)}
    .out{background:#111824;padding:12px;border-radius:8px;white-space:pre-wrap;margin-top:12px}
  </style>
</head>
<body class="page">
  <div class="wrap">
    <h1>FinishLine WPS AI</h1>
    <p>UI placeholder. CSS/JS embedded inline (public folder not deployed).</p>
    <div class="btns">
      <button id="btn-extract" class="btn">Extract (smoke)</button>
      <button id="btn-analyze" class="btn">Analyze (smoke)</button>
      <button id="btn-predict" class="btn">Predict (smoke)</button>
    </div>
    <pre id="out" class="out"></pre>
  </div>
  <script>
    const out = document.getElementById('out');
    const run = async (url) => {
      out.textContent = `POST ${url}…`;
      try {
        const r = await fetch(url, {method:'POST'});
        const t = await r.text();
        out.textContent = `${r.status} ${r.statusText}\\n\\n${t}`;
      } catch (e) {
        out.textContent = `Network error: ${e}`;
      }
    };
    document.getElementById('btn-extract').onclick = ()=>run('/api/extract/smoke');
    document.getElementById('btn-analyze').onclick = ()=>run('/api/research/smoke');
    document.getElementById('btn-predict').onclick = ()=>run('/api/predict/smoke');
    console.log('✓ FinishLine UI loaded (embedded)');
  </script>
</body>
</html>"""

EMBEDDED_CSS = """.page{background:#0b0b14;color:#fff;font-family:system-ui;margin:0;min-height:100vh}
.wrap{max-width:900px;margin:0 auto;padding:24px}
.btns{display:flex;gap:8px;margin:12px 0}
.btn{background:#4f46e5;border:none;color:#fff;padding:.6rem 1rem;border-radius:.6rem;cursor:pointer}
.out{background:#111824;padding:12px;border-radius:8px;white-space:pre-wrap}"""

EMBEDDED_JS = """const out = document.getElementById('out');
const run = async (url) => {
  out.textContent = `POST ${url}…`;
  try {
    const r = await fetch(url, {method:'POST'});
    const t = await r.text();
    out.textContent = `${r.status} ${r.statusText}\\n\\n${t}`;
  } catch (e) {
    out.textContent = `Network error: ${e}`;
  }
};
document.getElementById('btn-extract').onclick = ()=>run('/api/extract/smoke');
document.getElementById('btn-analyze').onclick = ()=>run('/api/research/smoke');
document.getElementById('btn-predict').onclick = ()=>run('/api/predict/smoke');"""


# ---- Health & root -----------------------------------------------------------
@app.get("/api/healthz")
async def healthz():
    return {"ok": True, "public_exists": PUBLIC_DIR.exists(), "index_exists": INDEX_HTML.exists()}

@app.get("/")
async def root():
    # Try to serve from file system first
    if INDEX_HTML.exists():
        try:
            return FileResponse(str(INDEX_HTML))
        except Exception as e:
            log_exception("root_file_serve", e)
    
    # Fallback: serve embedded HTML
    print("[BOOT] Serving embedded HTML (public folder not found)", flush=True)
    return HTMLResponse(EMBEDDED_HTML)

@app.get("/static/css/app.css")
async def serve_css():
    """Fallback CSS endpoint if static mount fails"""
    css_path = PUBLIC_DIR / "css" / "app.css"
    if css_path.exists():
        return FileResponse(str(css_path), media_type="text/css")
    # Embedded fallback
    return Response(content=EMBEDDED_CSS, media_type="text/css")

@app.get("/static/js/app.js")
async def serve_js():
    """Fallback JS endpoint if static mount fails"""
    js_path = PUBLIC_DIR / "js" / "app.js"
    if js_path.exists():
        return FileResponse(str(js_path), media_type="application/javascript")
    # Embedded fallback
    return Response(content=EMBEDDED_JS, media_type="application/javascript")


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
