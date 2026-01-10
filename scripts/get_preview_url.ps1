# Get Preview URL from Vercel deployment
param(
    [string]$PrNumber = "157"
)

Write-Host "Attempting to get Preview URL for PR #$PrNumber..." -ForegroundColor Yellow

# Try to get deployment info from Vercel API
# Note: Requires VERCEL_TOKEN environment variable
$vercelToken = $env:VERCEL_TOKEN

if (-not $vercelToken) {
    Write-Host "[INFO] VERCEL_TOKEN not set. Cannot query Vercel API." -ForegroundColor Yellow
    Write-Host "[INFO] Get Preview URL from:" -ForegroundColor Yellow
    Write-Host "  1. Vercel Dashboard: https://vercel.com/hired-hive/finishline-wps-ai" -ForegroundColor Cyan
    Write-Host "  2. PR #157 comments (Vercel bot)" -ForegroundColor Cyan
    Write-Host "  3. PR #157 checks tab" -ForegroundColor Cyan
    exit 0
}

# Query Vercel deployments API
try {
    $deployments = Invoke-RestMethod -Uri "https://api.vercel.com/v6/deployments?projectId=finishline-wps-ai&target=preview" -Headers @{
        "Authorization" = "Bearer $vercelToken"
    }
    
    # Find deployment for PR branch
    $prDeployment = $deployments.deployments | Where-Object { $_.meta.githubCommitRef -eq "feat/paygate-server-enforcement" } | Select-Object -First 1
    
    if ($prDeployment) {
        Write-Host "Preview URL: $($prDeployment.url)" -ForegroundColor Green
        return $prDeployment.url
    } else {
        Write-Host "[WARNING] No Preview deployment found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[ERROR] Failed to query Vercel API: $($_.Exception.Message)" -ForegroundColor Red
}
