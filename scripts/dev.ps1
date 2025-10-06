Param(
  [string]$PortApi = "8000",
  [string]$PortWeb = "3000"
)
$ErrorActionPreference = "Stop"
Set-Location -Path (Resolve-Path "$PSScriptRoot\..")
if (!(Test-Path ".venv")) { python -m venv .venv }
. .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
# Start API in new window
Start-Process -WindowStyle Normal -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","Set-Location `"$((Resolve-Path .).Path)`"; . .\.venv\Scripts\Activate.ps1; python -m uvicorn apps.api.api_main:app --reload --port $PortApi"
# Start WEB in new window
Start-Process -WindowStyle Normal -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","Set-Location `"$((Resolve-Path .\apps\web).Path)`"; python -m http.server $PortWeb"
# Open browser to web
Start-Process "http://localhost:$PortWeb"
Write-Host "`nDev started. API: http://localhost:$PortApi  |  WEB: http://localhost:$PortWeb`n"
