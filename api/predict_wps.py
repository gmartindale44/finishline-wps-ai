from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

async def predict_wps(request):
    # TODO: parse features and compute predictions; for now return ok
    return JSONResponse({"ok": True, "predictions": [], "msg": "predict stub"}, 200)

routes = [Route("/api/predict_wps", endpoint=predict_wps, methods=["POST"])]
app = Starlette(routes=routes)
