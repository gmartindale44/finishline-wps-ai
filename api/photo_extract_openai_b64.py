from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from io import BytesIO

app = FastAPI()

@app.post("/api/photo_extract_openai_b64")
async def photo_extract_openai_b64(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        if not contents:
            return JSONResponse({"ok": False, "error": "Empty file or upload failed"}, status_code=400)

        # basic debug info only
        return JSONResponse({
            "ok": True,
            "message": "Image received and validated",
            "bytes": len(contents),
            "filename": file.filename,
            "content_type": file.content_type
        })
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)