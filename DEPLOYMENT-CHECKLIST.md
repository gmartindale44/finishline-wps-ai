# FinishLine WPS AI — Deployment Checklist

## 1) GitHub (new repo, isolated)

```bash
git init
git add .
git commit -m "feat: FinishLine WPS AI (isolated FastAPI + static UI, odds/Kelly, CSV, OCR stub)"
# If you have GitHub CLI:
gh repo create finishline-wps-ai --public --source=. --remote=origin --push
# Otherwise create the repo on GitHub, then:
# git remote add origin <YOUR_GITHUB_REPO_URL>
# git push -u origin main
```

- Protect main (PR required, no force-push)
- Confirm `.gitignore` includes `.env` and `.vercel`
- Search the repo for any mention of other projects → must be none

## 2) Vercel (new project, not re-used)

- Vercel → New Project → Import from Git → select `finishline-wps-ai`
- Framework: Other
- Root: repo root (we route to `/apps/web` and `/apps/api` via `vercel.json`)

### Set Environment Variables (Project → Settings → Environment Variables)

```
FINISHLINE_MODEL=stub
FINISHLINE_OCR_ENABLED=false
FINISHLINE_ALLOWED_ORIGINS=https://<your-vercel>.vercel.app
FINISHLINE_LOG_LEVEL=info
```

### Verify after first deploy

- GET `/api/finishline/health` returns JSON with `"status":"ok"`
- Homepage loads; Predict (manual), CSV (file/text), Photo Predict (OCR stub) all work

### Sanity checks

- Project → Git points only to `finishline-wps-ai`
- Project → Functions shows `apps/api/api_main.py` (Python 3.12)
- Project → Domains: do not add apex domains here

## 3) (Optional) Add custom subdomain

- Vercel → FinishLine project → Settings → Domains → Add your custom subdomain
- Vercel shows CNAME target (usually `cname.vercel-dns.com`)
- Your DNS provider → Add CNAME:
  - Host: your-subdomain
  - Value/Target: `cname.vercel-dns.com`
  - TTL: Automatic
- Back in Vercel → Verify

### Test:
- https://your-subdomain.your-domain.com
- https://your-subdomain.your-domain.com/api/finishline/health

## 4) Production Smoke Test

- Manual entries return W/P/S (confidences normalize across top 3)
- CSV file & CSV text both parse and render cards + table
- 1–6 images via Photo Predict return OCR stub picks
- Changing Bankroll/Kelly Fraction shifts suggested stakes
- CORS OK from both your Vercel URL and the subdomain (if added)
- No cross-project references in code or settings