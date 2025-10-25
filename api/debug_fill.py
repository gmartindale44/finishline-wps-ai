# api/debug_fill.py
from fastapi import FastAPI, APIRouter, Request, Response
import json

app = FastAPI()
router = APIRouter()

@router.post("/api/debug_fill")
async def debug_fill(request: Request):
    try:
        payload = await request.json()
        entries = payload.get("entries", [])
        print("[debug_fill] received", entries)
        return Response(
            content=json.dumps({"ok": True, "data": {"entries": entries}}),
            media_type="application/json"
        )
    except Exception as e:
        print("[debug_fill] error", e)
        return Response(content=json.dumps({"ok": False, "error": str(e)}), media_type="application/json", status_code=500)

app.include_router(router)
