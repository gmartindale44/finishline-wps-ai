# FinishLine WPS AI

**Advanced horse race prediction system for Win/Place/Show betting**

A self-contained FastAPI + Static Web App that predicts horse race outcomes using simulated data and optional multi-image analysis. Built with NovaSpark Collective LLC branding and hosted on Vercel.

## 🏇 Features

- **Win/Place/Show Predictions**: AI-powered horse race outcome predictions
- **Kelly Criterion Betting**: Optimal bet sizing using Kelly fraction calculations
- **Photo Analysis**: Simulated OCR for extracting horse data from race photos
- **Modern UI**: Dark NovaSpark-themed interface with purple-blue gradients
- **Responsive Design**: Works on desktop and mobile devices
- **Real-time Predictions**: Instant results with loading animations

## 🚀 Quick Start

### Quickstart (Cursor/VS Code Tasks)
- **Windows (recommended):** `Terminal > Run Task > "FinishLine: Run BOTH (Windows)"`  
- **macOS/Linux:** `Terminal > Run Task > "FinishLine: Run BOTH (macOS/Linux)"`  
The script opens **http://localhost:3000**. API runs at **http://localhost:8000**.  
Health check: http://localhost:8000/api/finishline/health

### Manual terminals:
```bash
# 1) API  
python -m venv .venv
. .venv\Scripts\Activate.ps1 # Windows
# source .venv/bin/activate # macOS/Linux
python -m pip install -r requirements.txt
python -m uvicorn apps.api.api_main:app --reload --port 8000

# 2) Frontend  
cd apps/web
python -m http.server 3000
```

Deploy: create a NEW Vercel project, set env vars (FINISHLINE_*), deploy, then optionally add subdomain via CNAME → `cname.vercel-dns.com`.

### Local Dev (two terminals)

```bash
# Terminal A (API)
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn apps.api.api_main:app --reload --port 8000

# Terminal B (Frontend)
cd apps/web
python -m http.server 3000
# Open http://localhost:3000
```

## Environment Variables (prefix all with FINISHLINE_)

### Core Settings
```
FINISHLINE_MODEL=stub
FINISHLINE_OCR_ENABLED=false
FINISHLINE_ALLOWED_ORIGINS=https://<your-vercel>.vercel.app
FINISHLINE_LOG_LEVEL=info
```

### Research API Provider - Custom (Optional)
```
FINISHLINE_DATA_PROVIDER=custom
FINISHLINE_RESEARCH_API_URL=https://api.your-domain.tld
FINISHLINE_RESEARCH_API_KEY=your-api-key-here
FINISHLINE_PROVIDER_TIMEOUT_MS=4000
FINISHLINE_PROVIDER_CACHE_SECONDS=900
FINISHLINE_PROVIDER_DEBUG=false
```

**Expected API Endpoints:**
- `GET /horse?name={name}&track={track}&date={date}`
- `GET /trainer?name={name}`
- `GET /jockey?name={name}`
- `GET /track?name={name}&date={date}&surface={surface}&distance={distance}`

**Response Fields (customize mapping in `provider_custom.py`):**
- Horse: `last_speed_fig`, `pace_style`, `form_delta`, `days_since`
- Trainer/Jockey: `win_pct`, `trainer_win_pct`, `jockey_win_pct`
- Track: `bias` (object with track bias data)

### Research API Provider - WebSearch (Optional)
```
FINISHLINE_DATA_PROVIDER=websearch
FINISHLINE_TAVILY_API_KEY=tvly-xxxxx
FINISHLINE_OPENAI_API_KEY=sk-xxxxx
FINISHLINE_PROVIDER_TIMEOUT_MS=7000
FINISHLINE_PROVIDER_CACHE_SECONDS=900
FINISHLINE_PROVIDER_DEBUG=false
FINISHLINE_OPENAI_MODEL=gpt-4o-mini
```

**How it works:**
- Uses Tavily API to search for public racing information
- Extracts structured features from web pages using OpenAI
- No database required - pure web research
- TTL cache (15 min default) controls costs and latency
- Graceful fallback if API keys are missing

**Cost Considerations:**
- Tavily: ~$0.005 per search (3 results/horse × 3 entities = ~$0.05 per race)
- OpenAI: gpt-4o-mini ~$0.15 per 1M input tokens (~$0.02 per race)
- Cache hits eliminate costs for repeat queries
- Total: ~$0.07 per uncached race prediction

**Latency:**
- First request: 5-8 seconds (web search + OpenAI extraction)
- Cached request: <100ms
- Timeout: 7 seconds default (configurable)

## Endpoints

- GET `/api/finishline/health`
- GET `/api/finishline/version`
- POST `/api/finishline/predict` (JSON entries + textarea flow)
- POST `/api/finishline/photo_predict` (multipart; files<=6)
- POST `/api/finishline/csv_predict` (multipart "file" OR "csv_text")
- POST `/api/finishline/research_predict` (JSON with research enrichment)

## Isolation Rules

- Brand-new GitHub repo: `finishline-wps-ai`
- No references to other NovaSpark projects
- Do not import or reuse any Vercel settings from other projects
- `.gitignore` blocks `.env` and `.vercel` directories

## 📁 Project Structure

```
finishline-wps-ai/
├── apps/
│   ├── api/                    # FastAPI Backend
│   │   ├── api_main.py        # Main API endpoints
│   │   ├── odds.py            # ML odds conversion utilities
│   │   ├── scoring.py         # Horse ranking and predictions
│   │   ├── ocr_stub.py        # Simulated image analysis
│   │   └── requirements.txt   # Python dependencies
│   └── web/                   # Frontend
│       ├── index.html         # Main HTML page
│       ├── app.js             # JavaScript application
│       └── styles.css         # NovaSpark-themed CSS
├── vercel.json               # Vercel deployment config
├── requirements.txt          # Root-level Python dependencies
├── .gitignore               # Git ignore patterns
└── README.md                # This file
```

## 🔌 API Usage Examples

### Basic Prediction
```javascript
const response = await fetch('/api/finishline/predict', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    horses: [
      { name: "Thunderstride", odds: "5-2", bankroll: 1000, kelly_fraction: 0.25 }
    ]
  })
});
```

### Photo Analysis
```javascript
const formData = new FormData();
formData.append('files', imageFile);
const response = await fetch('/api/finishline/photo_predict', {
  method: 'POST',
  body: formData
});
```

## 🧮 Algorithm Details

### Kelly Criterion
- Calculates optimal bet sizing based on probability and odds
- Formula: `f = (bp - q) / b`
- Where: `b = odds - 1`, `p = probability`, `q = 1 - p`

### Composite Scoring
- Combines Expected Value (40%) and Kelly Fraction (60%)
- Ranks horses by composite score
- Selects top 3 for Win/Place/Show predictions

### Odds Conversion
- Supports fractional odds: "5-2", "3-1", "6-1"
- Converts to decimal format for calculations
- Calculates implied probabilities

## 🎨 NovaSpark Branding

### Color Scheme
- **Primary**: Deep purple (`#8b5cf6`) and cyan blue (`#38bdf8`)
- **Background**: Dark gradient (`#0a0014` to `#000`)
- **Cards**: Semi-transparent purple (`#1a1124`)
- **Accents**: Neon glow effects

### Typography
- **Font**: Poppins (Google Fonts)
- **Weights**: 300, 400, 500, 600, 700
- **Effects**: Text shadows and gradients

## 🔧 Configuration

### Environment Variables
- `FINISHLINE_MODEL`: Model type (default: "stub")
- `FINISHLINE_OCR_ENABLED`: Enable OCR (default: false)
- `FINISHLINE_ALLOWED_ORIGINS`: CORS origins
- `FINISHLINE_LOG_LEVEL`: Logging level (default: "info")

### Customization
- Modify `apps/web/styles.css` for styling changes
- Update `apps/api/scoring.py` for algorithm tweaks
- Customize `apps/api/ocr_stub.py` for different horse data

## 🧪 Testing

### Manual Testing
1. **Health Check**: `curl /api/finishline/health`
2. **Version**: `curl /api/finishline/version`
3. **Prediction**: Use frontend form or API directly
4. **Photo Analysis**: Upload test images

### Frontend Testing
- Test form validation
- Verify responsive design
- Check loading states
- Test error handling

## 🚨 Troubleshooting

### Common Issues

**API Not Responding**
- Check Vercel deployment status
- Verify environment variables
- Check function logs

**Frontend Not Loading**
- Verify static file serving
- Check browser console for errors
- Ensure API_BASE is correct

**Prediction Errors**
- Validate horse data format
- Check odds format (e.g., "5-2", not "2.5")
- Verify bankroll and Kelly fraction values

### Debug Mode
```javascript
// Enable debug logging
window.FINISHLINE_DEBUG = true;
```

## 📈 Performance

### Optimization Features
- Lazy loading of images
- Debounced API calls
- Efficient DOM updates
- Minimal bundle size

### Monitoring
- Built-in error handling
- Console logging for debugging
- Loading state indicators
- Graceful fallbacks

## 🔒 Security

### Best Practices
- Input validation on all endpoints
- File type restrictions for uploads
- CORS configuration
- Error message sanitization

### Production Considerations
- Rate limiting (implement if needed)
- Authentication (add if required)
- Input sanitization
- File size limits

## 📝 License

This project is part of the NovaSpark Collective LLC ecosystem. All rights reserved.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## 📞 Support

For issues and questions:
- Check the troubleshooting section
- Review API documentation
- Test with provided examples
- Contact NovaSpark Collective LLC support

## Deployment (GitHub + Vercel)
1) **GitHub**  
   ```bash
   git init
   git add .
   git commit -m "feat: FinishLine WPS AI initial"
   gh repo create finishline-wps-ai --public --source=. --remote=origin --push
   # If 'gh' is not installed, create the repo manually on GitHub,
   # then: git remote add origin <YOUR_REPO_URL> && git push -u origin main
   ```

2) **Vercel**
   - New Project → Import finishline-wps-ai
   - Root: repo root (we use vercel.json)
   - Env vars (Project → Settings → Environment Variables):
     ```
     FINISHLINE_MODEL=stub
     FINISHLINE_OCR_ENABLED=false
     FINISHLINE_ALLOWED_ORIGINS=https://<your-vercel>.vercel.app,https://finishline.hiredhive.xyz
     FINISHLINE_LOG_LEVEL=info
     ```
   - Deploy → verify /api/finishline/health.

3) **Optional subdomain finishline.hiredhive.xyz**
   - Vercel → Project → Settings → Domains → Add subdomain
   - Namecheap → add CNAME: host=finishline, target=cname.vercel-dns.com → Verify.

---

**Built with ❤️ by NovaSpark Collective LLC**