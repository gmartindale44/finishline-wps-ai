from starlette.requests import Request
from starlette.responses import JSONResponse

async def handler(request: Request):
    try:
        # lightweight debug GET probe
        if request.method == "GET":
            if request.query_params.get("dbg") == "1":
                return JSONResponse({"ok": True, "dbg": True, "message": "photo_extract_openai_b64 live"})
            # If not dbg mode, still respond 200 to show liveness
            return JSONResponse({"ok": True, "message": "photo_extract_openai_b64 ready"})

        # POST/PUT only for data
        if request.method not in ("POST", "PUT"):
            return JSONResponse({"ok": False, "error": "Use POST (multipart/json/raw) or GET?dbg=1 for debug"}, status_code=405)

        # For now, just return success to test basic functionality
        return JSONResponse({
            "ok": True,
            "message": "Image handler ready",
            "method": request.method,
            "content_type": request.headers.get("content-type", "")
        })

    except Exception as e:
        # last-resort error, include stack for logs
        return JSONResponse({
            "ok": False,
            "error": str(e)
        }, status_code=500)

# Export name expected by Vercel
app = handler