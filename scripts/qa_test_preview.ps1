# QA Test Script for PR #157 Preview Deployment
# Tests: Redis diag, predict snapshots, verify logs

param(
    [Parameter(Mandatory=$true)]
    [string]$PreviewUrl
)

Write-Host "=== QA TEST: Preview Deployment ===" -ForegroundColor Cyan
Write-Host "Preview URL: $PreviewUrl" -ForegroundColor Yellow
Write-Host ""

$baseUrl = $PreviewUrl.TrimEnd('/')

# Test 1: Redis Diagnostic
Write-Host "=== TEST 1: Redis Diagnostic ===" -ForegroundColor Cyan
try {
    $diagResponse = Invoke-RestMethod -Uri "$baseUrl/api/redis_diag" -Method GET
    Write-Host "[OK] Redis diag response received" -ForegroundColor Green
    Write-Host ($diagResponse | ConvertTo-Json -Depth 5)
    
    $diagResults = @{
        redisConfigured = $diagResponse.redisConfigured
        urlHost = $diagResponse.urlHost
        canWrite = $diagResponse.canWrite
        canRead = $diagResponse.canRead
        wroteKey = $diagResponse.wroteKey
        readBack = $diagResponse.readBack
        error = $diagResponse.error
    }
    
    if (-not $diagResponse.redisConfigured) {
        Write-Host "[ERROR] Redis not configured!" -ForegroundColor Red
    }
    
} catch {
    Write-Host "[ERROR] Redis diag failed: $($_.Exception.Message)" -ForegroundColor Red
    $diagResults = @{ error = $_.Exception.Message }
}

Write-Host ""

# Test 2: Predict with Snapshot
Write-Host "=== TEST 2: Predict with Snapshot ===" -ForegroundColor Cyan

$testRace = @{
    track = "Gulfstream Park"
    date = "2026-01-07"
    raceNo = "8"
    surface = "Dirt"
    distance_input = "6f"
    horses = @(
        @{name = "Thunder Strike"; odds = "3/1"; post = 3}
        @{name = "Lightning Bolt"; odds = "5/2"; post = 5}
        @{name = "Silver Star"; odds = "7/2"; post = 2}
        @{name = "Dark Moon"; odds = "4/1"; post = 7}
        @{name = "Wind Runner"; odds = "6/1"; post = 1}
        @{name = "Fire Storm"; odds = "8/1"; post = 4}
    )
    speedFigs = @{
        "Thunder Strike" = 95
        "Lightning Bolt" = 92
        "Silver Star" = 88
        "Dark Moon" = 85
        "Wind Runner" = 83
        "Fire Storm" = 80
    }
} | ConvertTo-Json -Depth 10

try {
    $predictResponse = Invoke-RestMethod -Uri "$baseUrl/api/predict_wps" -Method POST -ContentType 'application/json' -Body $testRace
    Write-Host "[OK] Predict response received" -ForegroundColor Green
    
    # Extract key info
    $raceId = $predictResponse.meta.raceId
    $snapshotDebug = $predictResponse.snapshot_debug
    $snapshotKey = $snapshotDebug.snapshotKey
    
    Write-Host "meta.raceId: $raceId" -ForegroundColor Yellow
    Write-Host "snapshot_debug:" -ForegroundColor Yellow
    Write-Host ($snapshotDebug | ConvertTo-Json -Depth 3)
    
    $predictResults = @{
        raceId = $raceId
        snapshotDebug = $snapshotDebug
        snapshotKey = $snapshotKey
        snapshotWriteOk = $snapshotDebug.snapshotWriteOk
        snapshotWriteError = $snapshotDebug.snapshotWriteError
    }
    
    # Verify raceId format
    if ($raceId -match '^\d{4}-\d{2}-\d{2}\|[^|]+\|\d+$') {
        Write-Host "[OK] raceId format correct" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] raceId format incorrect: $raceId" -ForegroundColor Red
    }
    
    # Verify snapshot debug
    if ($snapshotDebug.enablePredSnapshots -eq $true) {
        Write-Host "[OK] enablePredSnapshots = true" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] enablePredSnapshots = $($snapshotDebug.enablePredSnapshots)" -ForegroundColor Yellow
    }
    
    if ($snapshotDebug.redisConfigured -eq $true) {
        Write-Host "[OK] redisConfigured = true" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] redisConfigured = $($snapshotDebug.redisConfigured)" -ForegroundColor Yellow
    }
    
    if ($snapshotDebug.snapshotAttempted -eq $true) {
        Write-Host "[OK] snapshotAttempted = true" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] snapshotAttempted = $($snapshotDebug.snapshotAttempted)" -ForegroundColor Yellow
    }
    
    if ($snapshotDebug.snapshotWriteOk -eq $true) {
        Write-Host "[OK] snapshotWriteOk = true" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] snapshotWriteOk = $($snapshotDebug.snapshotWriteOk)" -ForegroundColor Red
        if ($snapshotDebug.snapshotWriteError) {
            Write-Host "  Error: $($snapshotDebug.snapshotWriteError)" -ForegroundColor Red
        }
    }
    
} catch {
    Write-Host "[ERROR] Predict failed: $($_.Exception.Message)" -ForegroundColor Red
    $predictResults = @{ error = $_.Exception.Message }
}

Write-Host ""

# Test 3: Verify Race
Write-Host "=== TEST 3: Verify Race ===" -ForegroundColor Cyan

$verifyBody = @{
    track = "Gulfstream Park"
    date = "2026-01-07"
    raceNo = "8"
    mode = "manual"
    outcome = @{
        win = "Thunder Strike"
        place = "Lightning Bolt"
        show = "Silver Star"
    }
} | ConvertTo-Json -Depth 10

try {
    $verifyResponse = Invoke-RestMethod -Uri "$baseUrl/api/verify_race" -Method POST -ContentType 'application/json' -Body $verifyBody
    Write-Host "[OK] Verify response received" -ForegroundColor Green
    
    # Note: verify log is written async, so we need to check Upstash for the key
    Write-Host "Verify completed. Check Upstash for verify log key." -ForegroundColor Yellow
    
    $verifyResults = @{
        ok = $verifyResponse.ok
        step = $verifyResponse.step
        hits = $verifyResponse.hits
    }
    
} catch {
    Write-Host "[ERROR] Verify failed: $($_.Exception.Message)" -ForegroundColor Red
    $verifyResults = @{ error = $_.Exception.Message }
}

Write-Host ""
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "Redis Configured: $($diagResults.redisConfigured)" -ForegroundColor $(if ($diagResults.redisConfigured) { "Green" } else { "Red" })
Write-Host "Snapshot Write OK: $($predictResults.snapshotWriteOk)" -ForegroundColor $(if ($predictResults.snapshotWriteOk) { "Green" } else { "Red" })
Write-Host "Snapshot Key: $($predictResults.snapshotKey)" -ForegroundColor Yellow
Write-Host "raceId: $($predictResults.raceId)" -ForegroundColor Yellow

# Save results for report
$results = @{
    timestamp = (Get-Date).ToISOString()
    previewUrl = $baseUrl
    redisDiag = $diagResults
    predict = $predictResults
    verify = $verifyResults
}

$results | ConvertTo-Json -Depth 5 | Out-File -FilePath "qa_test_results.json" -Encoding utf8
Write-Host "Results saved to qa_test_results.json" -ForegroundColor Green
