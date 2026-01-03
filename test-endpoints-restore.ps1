# Test script for restored /api/health and /api/log_prediction endpoints
# Usage: .\test-endpoints-restore.ps1 -BaseUrl "https://your-preview-url.vercel.app"

param(
    [Parameter(Mandatory=$true)]
    [string]$BaseUrl
)

Write-Host "Testing restored endpoints on: $BaseUrl" -ForegroundColor Cyan
Write-Host ""

# Test 1: GET /api/health
Write-Host "Test 1: GET /api/health" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/health" -Method GET -UseBasicParsing
    Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "  Body: $($response.Content)" -ForegroundColor Gray
    
    $json = $response.Content | ConvertFrom-Json
    if ($json.ok -eq $true -and $json.ts -and $json.node) {
        Write-Host "  ✓ Health endpoint working correctly" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Health endpoint returned unexpected format" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Health endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "  Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    }
}
Write-Host ""

# Test 2: POST /api/log_prediction
Write-Host "Test 2: POST /api/log_prediction" -ForegroundColor Yellow
$testBody = @{
    track = "test-track"
    date = "2024-01-01"
    raceNo = "1"
    picks = @{
        win = "1"
        place = "1"
        show = "1"
    }
    confidence = "0.8"
    top3_mass = "0.9"
    strategy = "test-strategy"
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/log_prediction" -Method POST -Body $testBody -ContentType "application/json" -UseBasicParsing
    Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "  Body: $($response.Content)" -ForegroundColor Gray
    
    $json = $response.Content | ConvertFrom-Json
    if ($json.ok -and $json.race_id) {
        Write-Host "  ✓ Log prediction endpoint working correctly" -ForegroundColor Green
        Write-Host "  Race ID: $($json.race_id)" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ Log prediction endpoint returned unexpected format" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Log prediction endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "  Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
        try {
            $errorStream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($errorStream)
            $errorBody = $reader.ReadToEnd()
            Write-Host "  Error Body: $errorBody" -ForegroundColor Red
        } catch {
            # Ignore error reading error body
        }
    }
}
Write-Host ""

# Test 3: Wrong method on /api/health (should return 405)
Write-Host "Test 3: POST /api/health (should return 405)" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/health" -Method POST -UseBasicParsing -ErrorAction Stop
    Write-Host "  ✗ Should have returned 405, got $($response.StatusCode)" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 405) {
        Write-Host "  ✓ Correctly returns 405 for wrong method" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Unexpected status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    }
}
Write-Host ""

# Test 4: Wrong method on /api/log_prediction (should return 405)
Write-Host "Test 4: GET /api/log_prediction (should return 405)" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/log_prediction" -Method GET -UseBasicParsing -ErrorAction Stop
    Write-Host "  ✗ Should have returned 405, got $($response.StatusCode)" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 405) {
        Write-Host "  ✓ Correctly returns 405 for wrong method" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Unexpected status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "Testing complete!" -ForegroundColor Cyan

