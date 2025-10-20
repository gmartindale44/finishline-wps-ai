from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

async def photo_extract_openai_b64(request):
    try:
        return JSONResponse({
            "ok": True,
            "message": "photo_extract_openai_b64 ready",
            "method": request.method
        })
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

routes = [Route("/api/photo_extract_openai_b64", endpoint=photo_extract_openai_b64, methods=["GET", "POST"])]
app = Starlette(routes=routes)