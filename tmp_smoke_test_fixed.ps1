# Smoke test for fixed Harville formulas
Write-Host "=== Smoke Test: Fixed Harville Place Formula ===" -ForegroundColor Cyan

$body = Get-Content tmp_pred_with_raceid_request.json -Raw

try {
    $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/predict_wps' -Method POST -ContentType 'application/json' -Body $body
    $response | ConvertTo-Json -Depth 10 | Out-File -FilePath 'tmp_pred_fixed_harville.json' -Encoding utf8
    
    Write-Host "`n[OK] Response saved to tmp_pred_fixed_harville.json" -ForegroundColor Green
    
    # Check probs_win sum
    $winSum = ($response.probs_win | Measure-Object -Sum).Sum
    Write-Host "`nprobs_win sum: $([Math]::Round($winSum, 4))" -ForegroundColor Yellow
    
    # Display arrays
    Write-Host "`nprobs_win:   $($response.probs_win -join ', ')" -ForegroundColor White
    Write-Host "probs_place: $($response.probs_place -join ', ')" -ForegroundColor White
    Write-Host "probs_show:  $($response.probs_show -join ', ')" -ForegroundColor White
    
    # Verify place >= win for each horse
    Write-Host "`n=== Verification ===" -ForegroundColor Cyan
    for ($i = 0; $i -lt $response.probs_win.Length; $i++) {
        $w = [Math]::Round($response.probs_win[$i], 4)
        $p = [Math]::Round($response.probs_place[$i], 4)
        $s = [Math]::Round($response.probs_show[$i], 4)
        
        $placeOk = if ($p -ge $w) { "OK" } else { "FAIL" }
        $showOk = if ($s -ge $p) { "OK" } else { "FAIL" }
        
        Write-Host "Horse $i : win=$w, place=$p $placeOk, show=$s $showOk"
    }
    
    # Check unchanged fields
    Write-Host "`n=== Unchanged Fields ===" -ForegroundColor Cyan
    Write-Host "picks count: $($response.picks.Count)"
    Write-Host "confidence: $($response.confidence)"
    Write-Host "ranking[0].prob: $($response.ranking[0].prob)"
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
