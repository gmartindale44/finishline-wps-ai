function Show-VercelDeploymentSteps {
    Write-Host ""
    Write-Host "=== FinishLine WPS AI - Vercel Deployment Steps ===" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "1. Project must be NEW (do not reuse existing)" -ForegroundColor Yellow
    Write-Host "   - Go to vercel.com → New Project → Import from GitHub"
    Write-Host "   - Select: finishline-wps-ai"
    Write-Host ""
    
    Write-Host "2. Where to paste env vars:" -ForegroundColor Yellow
    Write-Host "   Project → Settings → Environment Variables"
    Write-Host "   Add these FOUR variables:"
    Write-Host ""
    Write-Host "   FINISHLINE_MODEL=stub" -ForegroundColor Green
    Write-Host "   FINISHLINE_OCR_ENABLED=false" -ForegroundColor Green
    Write-Host "   FINISHLINE_ALLOWED_ORIGINS=https://<your-vercel>.vercel.app,https://finishline.hiredhive.xyz" -ForegroundColor Green
    Write-Host "   FINISHLINE_LOG_LEVEL=info" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "3. What URL to test afterward:" -ForegroundColor Yellow
    Write-Host "   Health: https://<your-vercel>.vercel.app/api/finishline/health"
    Write-Host "   App:    https://<your-vercel>.vercel.app/"
    Write-Host ""
    
    Write-Host "4. DNS instructions for finishline.hiredhive.xyz:" -ForegroundColor Yellow
    Write-Host "   - Vercel → Project → Settings → Domains → Add Custom Domain"
    Write-Host "   - Enter: finishline.hiredhive.xyz"
    Write-Host "   - Copy the CNAME value from Vercel"
    Write-Host "   - Namecheap → DNS → Add CNAME Record:"
    Write-Host "     Host: finishline"
    Write-Host "     Value: cname.vercel-dns.com"
    Write-Host "   - Click Verify in Vercel"
    Write-Host ""
    
    Write-Host "5. Important reminder:" -ForegroundColor Red
    Write-Host "   APEX DOMAIN MUST NOT BE MOVED - Only add subdomain finishline.hiredhive.xyz"
    Write-Host ""
    
    Write-Host "Root directory: repository root (uses vercel.json)" -ForegroundColor Cyan
    Write-Host ""
}

# Call the function
Show-VercelDeploymentSteps
