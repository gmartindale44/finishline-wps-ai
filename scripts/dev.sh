#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d ".venv" ]; then python3 -m venv .venv; fi
source .venv/bin/activate
python -m pip install -r requirements.txt
# Start API
( python -m uvicorn apps.api.api_main:app --reload --port "${PORT_API:-8000}" ) &
API_PID=$!
# Start WEB
( cd apps/web && python -m http.server "${PORT_WEB:-3000}" ) &
WEB_PID=$!
# Open browser (best effort)
if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${PORT_WEB:-3000}" || true; fi
if command -v open >/dev/null 2>&1; then open "http://localhost:${PORT_WEB:-3000}" || true; fi
echo
echo "Dev started. API: http://localhost:${PORT_API:-8000} | WEB: http://localhost:${PORT_WEB:-3000}"
echo "Press Ctrl+C to stop (this shell only stops the last background process)."
wait
