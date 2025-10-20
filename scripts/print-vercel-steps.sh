#!/bin/bash

echo ""
echo "=== FinishLine WPS AI - Vercel Deployment Steps ==="
echo ""

echo "1. Project must be NEW (do not reuse existing)"
echo "   - Go to vercel.com → New Project → Import from GitHub"
echo "   - Select: finishline-wps-ai"
echo ""

echo "2. Where to paste env vars:"
echo "   Project → Settings → Environment Variables"
echo "   Add these FOUR variables:"
echo ""
echo "   FINISHLINE_MODEL=stub"
echo "   FINISHLINE_OCR_ENABLED=false"
echo "   FINISHLINE_ALLOWED_ORIGINS=https://<your-vercel>.vercel.app,https://finishline.hiredhive.xyz"
echo "   FINISHLINE_LOG_LEVEL=info"
echo ""

echo "3. What URL to test afterward:"
echo "   Health: https://<your-vercel>.vercel.app/api/finishline/health"
echo "   App:    https://<your-vercel>.vercel.app/"
echo ""

echo "4. DNS instructions for finishline.hiredhive.xyz:"
echo "   - Vercel → Project → Settings → Domains → Add Custom Domain"
echo "   - Enter: finishline.hiredhive.xyz"
echo "   - Copy the CNAME value from Vercel"
echo "   - Namecheap → DNS → Add CNAME Record:"
echo "     Host: finishline"
echo "     Value: cname.vercel-dns.com"
echo "   - Click Verify in Vercel"
echo ""

echo "5. Important reminder:"
echo "   APEX DOMAIN MUST NOT BE MOVED - Only add subdomain finishline.hiredhive.xyz"
echo ""

echo "Root directory: repository root (uses vercel.json)"
echo ""
