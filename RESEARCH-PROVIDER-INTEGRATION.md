# Custom Research Provider Integration

## ✅ Integration Complete

The FinishLine WPS AI now supports custom research API integration for enhanced horse race predictions using real-world data from trainer stats, jockey performance, speed figures, and track bias.

---

## 🏗️ Architecture

### Components Added

1. **`apps/api/provider_custom.py`** - Custom provider with httpx client
   - Async HTTP requests to your research API
   - In-memory TTL cache (default 15 minutes)
   - Graceful fallback if API is unavailable
   - Configurable timeout and retry logic
   - Bearer token authentication support

2. **`apps/api/provider_base.py`** - Provider factory
   - Returns configured provider based on `FINISHLINE_DATA_PROVIDER`
   - Defaults to stub (pass-through) provider
   - Easy to extend with additional providers

3. **`apps/api/research_scoring.py`** - Enhanced scoring algorithm
   - Speed figure analysis (normalized around 80)
   - Trainer/Jockey win percentage weighting
   - Pace style adjustments (E/P/S/C)
   - Form delta tracking (improving/declining)
   - Days since race optimization
   - Composite research score calculation

4. **`/api/finishline/research_predict` endpoint** - New API endpoint
   - Accepts race context (date, track, surface, distance)
   - Enriches horses via custom provider
   - Returns research-enhanced W/P/S predictions
   - Includes enrichment source in response

---

## 🔧 Configuration

### Environment Variables

Set these in Vercel Project Settings → Environment Variables:

```bash
# Enable custom provider
FINISHLINE_DATA_PROVIDER=custom

# Your research API base URL
FINISHLINE_RESEARCH_API_URL=https://api.your-domain.tld

# API authentication key (optional)
FINISHLINE_RESEARCH_API_KEY=your-secret-key-here

# Timeout for API calls (milliseconds, default: 4000)
FINISHLINE_PROVIDER_TIMEOUT_MS=4000

# Cache TTL (seconds, default: 900 = 15 minutes)
FINISHLINE_PROVIDER_CACHE_SECONDS=900

# Enable debug logging (default: false)
FINISHLINE_PROVIDER_DEBUG=false
```

### Without Custom Provider

If you don't set `FINISHLINE_DATA_PROVIDER=custom`, the system gracefully falls back to:
- Stub provider (pass-through, no enrichment)
- Standard odds-based predictions
- No external API calls

**This means it's safe to deploy without configuring a research API.**

---

## 📡 Research API Contract

Your research API should implement these endpoints:

### 1. Horse Data
```
GET /horse?name={horse_name}&track={track}&date={race_date}
```

**Expected Response:**
```json
{
  "last_speed_fig": 85,
  "pace_style": "E",
  "form_delta": 2.5,
  "days_since": 14
}
```

### 2. Trainer Data
```
GET /trainer?name={trainer_name}
```

**Expected Response:**
```json
{
  "win_pct": 0.18,
  "trainer_win_pct": 0.18
}
```

### 3. Jockey Data
```
GET /jockey?name={jockey_name}
```

**Expected Response:**
```json
{
  "win_pct": 0.15,
  "jockey_win_pct": 0.15
}
```

### 4. Track Data (Optional)
```
GET /track?name={track}&date={date}&surface={surface}&distance={distance}
```

**Expected Response:**
```json
{
  "bias": {
    "speed_favoring": "inside",
    "rail_distance": "fair"
  }
}
```

---

## 🔄 Data Flow

```
User submits race → /api/finishline/research_predict
                        ↓
                   Provider Factory
                        ↓
             ┌──────────┴──────────┐
             ↓                     ↓
      Custom Provider        Stub Provider
             ↓                     ↓
      Fetch from API         Pass-through
             ↓                     ↓
      Enrich horses          No enrichment
             └──────────┬──────────┘
                        ↓
            Research Scoring Algorithm
                        ↓
              W/P/S Predictions
                        ↓
               Return to user
```

---

## 🎯 Research Scoring Algorithm

The research score combines multiple factors:

```python
composite_score = (
    base_probability      * 0.30   # 30% odds-implied probability
    + speed_factor        * 0.25   # 25% speed figure (normalized)
    + people_factor       * 0.20   # 20% trainer/jockey stats
    + pace_bonus          * 0.10   # 10% pace style match
    + form_factor         * 0.10   # 10% form trend
    + rest_factor         * 0.05   # 5% days since race
)
```

### Factor Details

**Speed Figure** (`last_speed_fig`)
- Normalized around 80
- Range: 0.5 to 1.5 multiplier
- Higher figures = better scores

**Trainer/Jockey** (`trainer_win_pct`, `jockey_win_pct`)
- Combined win percentages
- Normalized around 24% (12% each)
- Better trainers/jockeys = higher scores

**Pace Style** (`early_pace`)
- `E` (Early) = 1.05x bonus
- `P` (Presser) = 1.0x neutral
- `S` (Stalker) = 0.95x slight penalty
- `C` (Closer) = 0.90x penalty

**Form Delta** (`form_delta`)
- Positive = improving form
- Negative = declining form
- ±10% per point
- Capped at 0.7 to 1.3 range

**Rest Pattern** (`days_since_race`)
- Optimal: 14-35 days = 1.1x bonus
- Too fresh: < 7 days = 0.9x penalty
- Layoff: > 60 days = 0.85x penalty

---

## 🧪 Testing

### Test Without Custom API (Stub Mode)
```bash
# Don't set FINISHLINE_DATA_PROVIDER (defaults to stub)
curl -X POST http://localhost:8000/api/finishline/research_predict \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2024-01-15",
    "track": "Churchill Downs",
    "surface": "dirt",
    "distance": "1 1/4 miles",
    "horses": [
      {
        "name": "Thunderstride",
        "odds": "5-2",
        "trainer": "Bob Baffert",
        "jockey": "John Velazquez",
        "bankroll": 1000,
        "kelly_fraction": 0.25
      }
    ]
  }'
```

**Response (stub mode):**
```json
{
  "win": {
    "name": "Thunderstride",
    "odds": "5-2",
    "prob": 0.29,
    "research_score": 0.35,
    "rationale": "Win selection - Research score: 0.350..."
  },
  "enrichment_source": "stub"
}
```

### Test With Custom API
```bash
# Set FINISHLINE_DATA_PROVIDER=custom
# Set FINISHLINE_RESEARCH_API_URL=https://api.example.com
# Set FINISHLINE_RESEARCH_API_KEY=your-key

# Same request as above
```

**Response (custom mode):**
```json
{
  "win": {
    "name": "Thunderstride",
    "odds": "5-2",
    "prob": 0.42,
    "research_score": 0.68,
    "rationale": "Win selection - Research score: 0.680 | Speed: 88 | Trainer: 18.5% | Jockey: 16.2% | Pace: E"
  },
  "enrichment_source": "custom",
  "race_context": {
    "date": "2024-01-15",
    "track": "Churchill Downs",
    "surface": "dirt",
    "distance": "1 1/4 miles"
  }
}
```

---

## 🔍 Customizing Field Mapping

Your API may use different field names. Edit `apps/api/provider_custom.py`:

```python
def _map_horse_features(h: Dict[str,Any], hjson: Dict[str,Any]) -> Dict[str,Any]:
    # Adjust these field names to match your API
    last_fig   = _as_float(_pick(hjson, 
        "last_speed_fig",    # Your API's field name
        "last_speed",        # Alternative name
        "speedfig",          # Another alternative
        "brz",               # Beyer speed rating
        "tfus",              # TimeForm US
        default=80), 80)
    
    pace_style = _pick(hjson,
        "pace_style",        # Your field
        "running_style",     # Alternative
        "pace",
        "rs",
        default="P")
    
    # Add more mappings as needed
```

---

## 📊 Performance & Caching

### In-Memory TTL Cache
- **Default TTL:** 15 minutes (900 seconds)
- **Cache Key:** `(url, sorted_params)`
- **Benefits:**
  - Reduces API calls
  - Faster response times
  - Lower costs if API charges per call
  - Handles API rate limits

### Cache Behavior
```python
# First request: hits API
GET /horse?name=Thunderstride&track=Churchill&date=2024-01-15
→ API call → cached for 15 min

# Second request (within 15 min): uses cache
GET /horse?name=Thunderstride&track=Churchill&date=2024-01-15
→ Returns cached data (no API call)

# After 15 min: cache expired
→ Fresh API call → re-cached
```

### Timeout Configuration
```bash
# Set aggressive timeout for fast responses
FINISHLINE_PROVIDER_TIMEOUT_MS=2000  # 2 seconds

# Set generous timeout for slow APIs
FINISHLINE_PROVIDER_TIMEOUT_MS=8000  # 8 seconds
```

---

## 🚨 Error Handling

The provider gracefully handles all failures:

| Error | Behavior |
|-------|----------|
| API unavailable | Returns stub data (pass-through) |
| Timeout | Logs error, continues with odds-only |
| 4xx/5xx response | Logs status, uses fallback values |
| Invalid JSON | Logs error, uses default values |
| Missing fields | Uses sensible defaults |
| Network errors | Cached data if available, else defaults |

**All errors are logged when `FINISHLINE_PROVIDER_DEBUG=true`**

---

## 🔐 Security

### Authentication
```python
# Bearer token automatically added to requests
headers = {
    "Authorization": f"Bearer {FINISHLINE_RESEARCH_API_KEY}",
    "Accept": "application/json"
}
```

### Best Practices
1. **Never commit API keys** - use environment variables
2. **Use HTTPS** - always encrypt API communication
3. **Rotate keys** - periodically update `FINISHLINE_RESEARCH_API_KEY`
4. **Rate limiting** - implement on your API side
5. **Input validation** - sanitize horse/trainer/jockey names

---

## 📈 Deployment Checklist

- [ ] Set `FINISHLINE_DATA_PROVIDER=custom` in Vercel
- [ ] Set `FINISHLINE_RESEARCH_API_URL` to your API base URL
- [ ] Set `FINISHLINE_RESEARCH_API_KEY` (if required)
- [ ] Test `/api/finishline/research_predict` endpoint
- [ ] Verify `enrichment_source: "custom"` in response
- [ ] Check Vercel function logs for errors
- [ ] Monitor API call volume and cache hit rate
- [ ] Enable debug logging temporarily if issues occur

---

## 🛠️ Troubleshooting

### Issue: Always returns stub data
**Check:**
- `FINISHLINE_DATA_PROVIDER=custom` is set
- `FINISHLINE_RESEARCH_API_URL` is correct
- API is reachable from Vercel (test with curl)

### Issue: Timeout errors
**Solutions:**
- Increase `FINISHLINE_PROVIDER_TIMEOUT_MS`
- Optimize your API response time
- Add caching on your API side

### Issue: Wrong field mappings
**Solutions:**
- Enable `FINISHLINE_PROVIDER_DEBUG=true`
- Check Vercel logs for API responses
- Update field mapping in `provider_custom.py`

### Issue: Cache not working
**Check:**
- Same URL and params used
- TTL not expired
- Cache key generation (url + sorted params)

---

## 📚 Example Implementation

See `apps/api/provider_custom.py` for the full implementation with:
- ✅ Async httpx client
- ✅ In-memory TTL cache
- ✅ Bearer token authentication
- ✅ Configurable timeout/retry
- ✅ Error handling & logging
- ✅ Field mapping flexibility
- ✅ Graceful degradation

---

**Status:** ✅ **READY FOR PRODUCTION**

The custom provider is:
- Safe to deploy (graceful fallback)
- Production-ready (error handling, caching, timeouts)
- Configurable (env vars control all behavior)
- Extensible (easy to customize field mappings)

**Next:** Configure your research API endpoints and set environment variables in Vercel.

