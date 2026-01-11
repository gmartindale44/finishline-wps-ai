# Test snapshot storage
$env:ENABLE_PRED_SNAPSHOTS = "true"
Write-Host "ENABLE_PRED_SNAPSHOTS set to: $env:ENABLE_PRED_SNAPSHOTS"

Start-Sleep -Seconds 3

Write-Host "Calling /api/predict_wps with date+raceNo..."
$body = Get-Content tmp_pred_with_raceid_request.json -Raw
try {
    $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/predict_wps' -Method POST -ContentType 'application/json' -Body $body
    $response | ConvertTo-Json -Depth 10 | Out-File -FilePath 'tmp_pred_with_snapshot.json' -Encoding utf8
    Write-Host "SUCCESS: Response saved to tmp_pred_with_snapshot.json"
    Write-Host "raceId: $($response.meta.raceId)"
    Write-Host "asOf: $($response.meta.asOf)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
}

