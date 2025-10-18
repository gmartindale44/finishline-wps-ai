from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

async def test_handler(request):
    return JSONResponse({"status": "ok", "message": "Test endpoint working"})

routes = [Route("/api/test", test_handler, methods=["GET", "POST"])]
app = Starlette(routes=routes)
