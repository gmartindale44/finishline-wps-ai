from fastapi import APIRouter, Request, Response
import json

router = APIRouter()

@router.post("/api/debug_fill")
async def debug_fill(request: Request):
  # echo back entries as the OCR would: { ok: true, data: { entries: [...] } }
  payload = await request.json()
  entries = payload.get("entries", [])
  return Response(
    content=json.dumps({"ok": True, "data": {"entries": entries}}),
    media_type="application/json"
  )

app = router
