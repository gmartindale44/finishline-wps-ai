import os, base64, json
from io import BytesIO
from typing import List, Dict, Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from pydantic import BaseModel

class OCRResponse(BaseModel):
    ok: bool
    horses: List[Dict[str, Any]] = []
    error: str = ""

async def photo_extract(req: Request):
    try:
        if req.method != "POST":
            return JSONResponse({"ok": False, "error": "POST required"}, 405)

        content_type = req.headers.get("content-type", "")
        data = {}

        if "multipart/form-data" in content_type:
            form = await req.form()
            data = dict(form)
        else:
            try:
                data = await req.json()
            except Exception:
                pass

        img_bytes = None
        if "file" in data and hasattr(data["file"], "read"):
            img_bytes = data["file"].read()
        elif "b64" in data:
            b64 = data["b64"].split(",", 1)[-1]
            img_bytes = base64.b64decode(b64)

        if not img_bytes:
            return JSONResponse({"ok": False, "error": "No image received"}, 400)

        # For now, return a mock response to test the endpoint structure
        mock_horses = [
            {"name": "Test Horse 1", "odds": "5-1", "jockey": "Test Jockey", "trainer": "Test Trainer"},
            {"name": "Test Horse 2", "odds": "3-1", "jockey": "Test Jockey 2", "trainer": "Test Trainer 2"}
        ]

        return JSONResponse({"ok": True, "horses": mock_horses}, 200)

    except Exception as e:
        print("photo_extract_openai_b64.py crashed:", e)
        return JSONResponse({"ok": False, "error": str(e)}, 500)

routes = [Route("/api/photo_extract_openai_b64", photo_extract, methods=["POST"])]
app = Starlette(routes=routes)