# Snapshot test
Write-Host "=== Snapshot Test ===" -ForegroundColor Cyan

$env:ENABLE_PRED_SNAPSHOTS = "true"
Write-Host "ENABLE_PRED_SNAPSHOTS set to: $env:ENABLE_PRED_SNAPSHOTS" -ForegroundColor Yellow

Start-Sleep -Seconds 2

$body = Get-Content tmp_pred_with_raceid_request.json -Raw

try {
    Write-Host "`nCalling /api/predict_wps with date+raceNo..." -ForegroundColor White
    $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/predict_wps' -Method POST -ContentType 'application/json' -Body $body
    
    Write-Host "[OK] Prediction completed" -ForegroundColor Green
    Write-Host "  raceId: $($response.meta.raceId)" -ForegroundColor White
    Write-Host "  asOf: $($response.meta.asOf)" -ForegroundColor White
    
    Write-Host "`nWaiting 3 seconds for async snapshot write..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    
    Write-Host "`nChecking Redis for snapshot keys..." -ForegroundColor White
    # Note: We can't directly query Redis from PowerShell without the REST client
    # Instead, we'll call verify_race to confirm snapshot is used
    
    Write-Host "`nCalling /api/verify_race to test snapshot lookup..." -ForegroundColor White
    $verifyBody = @{
        track = "Gulfstream Park"
        date = "2026-01-06"
        raceNo = "8"
        mode = "manual"
        outcome = @{
            win = "Lightning Bolt"
            place = "Thunder Strike"
            show = "Silver Star"
        }
    } | ConvertTo-Json -Depth 10
    
    $verifyResponse = Invoke-RestMethod -Uri 'http://localhost:3000/api/verify_race' -Method POST -ContentType 'application/json' -Body $verifyBody
    
    Write-Host "[OK] Verify completed" -ForegroundColor Green
    Write-Host "  status: $($verifyResponse.status)" -ForegroundColor White
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

