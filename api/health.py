from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

async def health(request):
    return JSONResponse({"status": "ok", "message": "FinishLine WPS AI is running"}, 200)

routes = [Route("/api/health", endpoint=health, methods=["GET"])]
app = Starlette(routes=routes)
