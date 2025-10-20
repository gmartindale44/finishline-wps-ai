from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

async def photo_extract_handler(request: Request):
    try:
        # Handle multipart form data
        if request.method == "POST":
            form = await request.form()
            file = form.get("file")
            
            if not file:
                return JSONResponse({"ok": False, "error": "No file uploaded"}, status_code=400)
            
            contents = await file.read()
            if not contents:
                return JSONResponse({"ok": False, "error": "Empty file or upload failed"}, status_code=400)

            # basic debug info only
            return JSONResponse({
                "ok": True,
                "message": "Image received and validated",
                "bytes": len(contents),
                "filename": getattr(file, 'filename', 'unknown'),
                "content_type": getattr(file, 'content_type', 'unknown')
            })
        
        # Handle GET requests
        return JSONResponse({"ok": True, "message": "photo_extract_openai_b64 ready"})
        
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

# Create Starlette app for Vercel
routes = [Route("/api/photo_extract_openai_b64", endpoint=photo_extract_handler, methods=["GET", "POST"])]
app = Starlette(routes=routes)