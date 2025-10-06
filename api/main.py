from vercel_asgi import VercelASGI
# Import the existing FastAPI app from our internal path
from apps.api.api_main import app
# Expose handler for Vercel
handler = VercelASGI(app)
