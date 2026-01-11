# Smoke test for Preview deployment
param(
    [Parameter(Mandatory=$true)]
    [string]$PreviewUrl
)

Write-Host "=== Smoke Test: Preview Deployment ===" -ForegroundColor Cyan
Write-Host "Preview URL: $PreviewUrl" -ForegroundColor Yellow

$body = @{
    track = "Gulfstream Park"
    surface = "dirt"
    distance_input = "6f"
    horses = @(
        @{name = "Thunder Strike"; odds = "3/1"; post = 3}
        @{name = "Lightning Bolt"; odds = "5/2"; post = 5}
        @{name = "Silver Star"; odds = "7/2"; post = 2}
        @{name = "Dark Moon"; odds = "4/1"; post = 7}
    )
    speedFigs = @{
        "Thunder Strike" = 95
        "Lightning Bolt" = 92
        "Silver Star" = 88
        "Dark Moon" = 85
    }
    date = "2026-01-07"
    raceNo = "8"
} | ConvertTo-Json -Depth 10

try {
    $apiUrl = "$PreviewUrl/api/predict_wps"
    Write-Host "`nCalling: $apiUrl" -ForegroundColor White
    
    $response = Invoke-RestMethod -Uri $apiUrl -Method POST -ContentType 'application/json' -Body $body
    
    Write-Host "`n[OK] Response received" -ForegroundColor Green
    
    # Check required fields
    Write-Host "`n=== Field Verification ===" -ForegroundColor Cyan
    
    $checks = @{
        "meta.asOf" = $response.meta.asOf
        "meta.raceId" = $response.meta.raceId
        "probs_win" = $response.probs_win
        "probs_place" = $response.probs_place
        "probs_show" = $response.probs_show
        "top3_mass_raw" = $response.top3_mass_raw
        "top3_mass_calibrated" = $response.top3_mass_calibrated
        "top3_mass_method" = $response.top3_mass_method
    }
    
    foreach ($check in $checks.GetEnumerator()) {
        $status = if ($null -ne $check.Value) { "OK" } else { "MISSING" }
        Write-Host "$($check.Key): $status" -ForegroundColor $(if ($null -ne $check.Value) { "Green" } else { "Red" })
    }
    
    # Show excerpt
    Write-Host "`n=== Response Excerpt ===" -ForegroundColor Cyan
    $excerpt = @{
        meta = @{
            asOf = $response.meta.asOf
            raceId = $response.meta.raceId
        }
        probs_win = $response.probs_win[0..1]
        probs_place = $response.probs_place[0..1]
        probs_show = $response.probs_show[0..1]
        top3_mass_raw = $response.top3_mass_raw
        top3_mass_calibrated = $response.top3_mass_calibrated
        top3_mass_method = $response.top3_mass_method
    } | ConvertTo-Json -Depth 5
    
    Write-Host $excerpt
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

