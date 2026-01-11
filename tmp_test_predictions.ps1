# Test prediction API calls
Start-Sleep -Seconds 10

# Test 1: Without date/raceNo
Write-Host "Test 1: Calling /api/predict_wps without date/raceNo..."
$body1 = Get-Content tmp_pred_no_raceid_request.json -Raw
try {
    $response1 = Invoke-RestMethod -Uri 'http://localhost:3000/api/predict_wps' -Method POST -ContentType 'application/json' -Body $body1
    $response1 | ConvertTo-Json -Depth 10 | Out-File -FilePath 'tmp_pred_no_raceid.json' -Encoding utf8
    Write-Host "SUCCESS: Response saved to tmp_pred_no_raceid.json"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
}

Start-Sleep -Seconds 2

# Test 2: With date/raceNo
Write-Host "Test 2: Calling /api/predict_wps with date/raceNo..."
$body2 = Get-Content tmp_pred_with_raceid_request.json -Raw
try {
    $response2 = Invoke-RestMethod -Uri 'http://localhost:3000/api/predict_wps' -Method POST -ContentType 'application/json' -Body $body2
    $response2 | ConvertTo-Json -Depth 10 | Out-File -FilePath 'tmp_pred_with_raceid.json' -Encoding utf8
    Write-Host "SUCCESS: Response saved to tmp_pred_with_raceid.json"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
}

Write-Host "All tests completed successfully"

