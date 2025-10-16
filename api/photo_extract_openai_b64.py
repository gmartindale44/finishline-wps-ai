from fastapi import APIRouter, File, UploadFile, HTTPException
from typing import List, Optional
from fastapi.responses import JSONResponse

router = APIRouter()

@router.post("/photo_extract_openai_b64")
async def photo_extract_openai_b64(
    files: Optional[List[UploadFile]] = File(None),
    photos: Optional[List[UploadFile]] = File(None),
):
    incoming = files or photos
    if not incoming:
        return JSONResponse(status_code=400, content={"ok": False, "error": {"code": "NO_FILES", "message": "No images were uploaded."}, "detail": []})
    try:
        received = []
        for f in incoming:
            content = await f.read()
            received.append({"filename": f.filename, "content_type": f.content_type or "", "bytes": len(content)})
        # TODO: plug your real OCR here — this is a placeholder shape the frontend expects
        extracted = {"race": {}, "horses": []}
        return {"ok": True, "data": {"received": received, "extracted": extracted}}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"code": "OCR_ERROR", "message": str(e)}})
