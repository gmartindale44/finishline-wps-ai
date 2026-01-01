# PayGate Routing Smoke Test Script
# Usage: .\smoke-test.ps1 -PreviewUrl "https://your-preview-url.vercel.app"

param(
    [Parameter(Mandatory=$true)]
    [string]$PreviewUrl
)

Write-Host "`n=== PayGate Routing Smoke Tests ===" -ForegroundColor Green
Write-Host "Preview URL: $PreviewUrl`n" -ForegroundColor Yellow

# Test 1: /api/paygate-token
Write-Host "=== Test 1: /api/paygate-token ===" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "$PreviewUrl/api/paygate-token?cb=123" -Method GET -UseBasicParsing
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "   X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
    Write-Host "   Content-Type: $($response.Headers['Content-Type'])"
    $bodyPreview = $response.Content.Substring(0, [Math]::Min(200, $response.Content.Length))
    Write-Host "   Body (first 200 chars): $bodyPreview"
    
    # Verify correctness
    if ($response.Headers['X-Handler-Identity'] -eq 'PAYGATE_TOKEN_OK' -and 
        $response.Content -match 'PAYGATE_TOKEN_HANDLER_OK' -and
        $response.Content -notmatch 'verify_race_stub') {
        Write-Host "   ✅ PASS: Correct handler, no verify_race_stub" -ForegroundColor Green
    } else {
        Write-Host "   ❌ FAIL: Wrong handler or contains verify_race_stub" -ForegroundColor Red
    }
} catch {
    Write-Host "   ❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: /api/debug-paygate
Write-Host "`n=== Test 2: /api/debug-paygate ===" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "$PreviewUrl/api/debug-paygate?cb=123" -Method GET -UseBasicParsing
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "   X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
    Write-Host "   Content-Type: $($response.Headers['Content-Type'])"
    $json = $response.Content | ConvertFrom-Json
    Write-Host "   Body (JSON): $($json | ConvertTo-Json -Compress)"
    
    # Verify correctness
    if ($response.Headers['X-Handler-Identity'] -eq 'DEBUG_PAYGATE_OK' -and 
        $json.ok -eq $true -and
        $response.Content -notmatch 'verify_race_stub') {
        Write-Host "   ✅ PASS: Correct handler, ok:true, no verify_race_stub" -ForegroundColor Green
    } else {
        Write-Host "   ❌ FAIL: Wrong handler or contains verify_race_stub" -ForegroundColor Red
    }
} catch {
    Write-Host "   ❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: /api/verify_race (GET - should return stub)
Write-Host "`n=== Test 3: /api/verify_race (GET) ===" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "$PreviewUrl/api/verify_race" -Method GET -UseBasicParsing
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "   X-Handler-Identity: $($response.Headers['X-Handler-Identity'])"
    $json = $response.Content | ConvertFrom-Json
    Write-Host "   Body (JSON): $($json | ConvertTo-Json -Compress)"
    
    # Verify stub behavior (expected)
    if ($response.Headers['X-Handler-Identity'] -eq 'VERIFY_RACE_STUB' -and 
        $json.step -eq 'verify_race_stub') {
        Write-Host "   ✅ PASS: Correct stub response with identity header" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  WARNING: Unexpected response format" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: /api/verify_race (POST - should work normally)
Write-Host "`n=== Test 4: /api/verify_race (POST) ===" -ForegroundColor Cyan
try {
    $body = @{
        date = "2025-12-31"
        track = "Turfway Park"
        raceNo = "8"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$PreviewUrl/api/verify_race" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    $json = $response.Content | ConvertFrom-Json
    Write-Host "   Body (JSON): $($json | ConvertTo-Json -Compress)"
    
    # Verify POST works (not stub)
    if ($json.step -ne 'verify_race_stub' -and $json.ok -ne $false) {
        Write-Host "   ✅ PASS: POST works correctly (not stub)" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  WARNING: POST returned stub (may be expected if no data available)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Smoke Tests Complete ===" -ForegroundColor Green

