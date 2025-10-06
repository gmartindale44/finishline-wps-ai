# FinishLine WPS AI - Deployment Guide

## Why isolation matters

This is a standalone repository and Vercel project with FINISHLINE_* environment variables only. No shared configurations or dependencies with other projects. This ensures:

- Clean separation of concerns
- Independent scaling and deployment
- Isolated environment variables
- No cross-project contamination

## Required Vercel env vars

Set these in Vercel → Project → Settings → Environment Variables:

```
FINISHLINE_MODEL=stub
FINISHLINE_OCR_ENABLED=false
FINISHLINE_ALLOWED_ORIGINS=https://<your-vercel>.vercel.app,https://finishline.hiredhive.xyz
FINISHLINE_LOG_LEVEL=info
```

## Post-deploy smoke

Manual testing checklist:

1. **Health endpoint**: https://<your-vercel>.vercel.app/api/finishline/health
2. **Main app**: https://<your-vercel>.vercel.app/
3. **CSV upload**: Test with sample horse data
4. **Photo stub**: Test with sample images
5. **CORS**: Verify frontend can call API
6. **Error handling**: Test with invalid data

## Rollback

If deployment issues occur:

1. Revert last Git commit: `git revert HEAD`
2. Push to main: `git push origin main`
3. Vercel auto redeploys from the reverted commit
4. Monitor Vercel deployment logs for success
