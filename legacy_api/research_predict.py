from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

async def research_predict(request):
    # TODO: parse posted horses and run research; for now return ok
    return JSONResponse({"ok": True, "features": [], "msg": "research stub"}, 200)

routes = [Route("/api/research_predict", endpoint=research_predict, methods=["POST"])]
app = Starlette(routes=routes)
