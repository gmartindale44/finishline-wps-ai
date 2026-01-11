# Test verify_race with snapshot lookup
$env:ENABLE_PRED_SNAPSHOTS = "true"
Write-Host "Testing verify_race with snapshot lookup..."

$body = @{
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

try {
    $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/verify_race' -Method POST -ContentType 'application/json' -Body $body
    $response | ConvertTo-Json -Depth 10 | Out-File -FilePath 'tmp_verify_with_snapshot.json' -Encoding utf8
    Write-Host "SUCCESS: Verify response saved"
    
    # Check if predsnap_asOf is in the response (would be in verify log, not response)
    Write-Host "Verify completed. Check tmp_verify_with_snapshot.json for results."
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host $_.Exception.Response
    exit 1
}

