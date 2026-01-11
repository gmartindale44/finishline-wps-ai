# FinishLine WPS AI - System Deep Dive for ChatGPT

**Report Date:** 2026-01-06 17:49:19 UTC  
**Git Branch:** `feat/paygate-server-enforcement`  
**Git Commit:** `ade8253fed1082f2573c29ec08cb326e555571d0`  
**Purpose:** Collect and summarize exact current internal workings of FinishLine prediction + calibration for additive intelligence upgrades  
**Example JSON Source:** Constructed from production code schema analysis

---

## Table of Contents

1. [Current Prediction Pipeline (Source of Truth)](#a-current-prediction-pipeline-source-of-truth)
2. [Real Prediction JSON Examples](#b-real-prediction-json-examples)
3. [Calibration Pipeline (Source of Truth)](#c-calibration-pipeline-source-of-truth)
4. [Where the Percentages Can "Not Match" (Important)](#d-where-the-percentages-can-not-match-important)
5. [Integration Points + Risk Surface](#e-integration-points--risk-surface)
6. [Run Instructions](#f-run-instructions)
7. [Calibration Reports](#g-calibration-reports)

---

## A. Current Prediction Pipeline (Source of Truth)

### A1. Entrypoint

**Primary Endpoint:** `POST /api/predict_wps`  
**File:** `pages/api/predict_wps.js`  
**Function:** `handler(req, res)` (lines 138-830)  
**Runtime:** Node.js (Vercel serverless)

**Environment Variables:**
- `FINISHLINE_PERSISTENCE_ENABLED` - Enable Redis predmeta writes (string "true")
- `UPSTASH_REDIS_REST_URL` - Redis REST URL (for predmeta writes)
- `UPSTASH_REDIS_REST_TOKEN` - Redis REST token (for predmeta writes)
- `PAYGATE_SERVER_ENFORCE` - PayGate enforcement mode (0=monitor, 1=enforce)

**Feature Flags:**
- PayGate check (lines 155-170) - Non-blocking in monitor mode
- Calibration post-processor (lines 486-544) - Optional if `data/model_params.json` exists
- Predmeta persistence (lines 676-804) - Optional if `FINISHLINE_PERSISTENCE_ENABLED=true`

### A2. Input Schema

**Request Body:**
```typescript
{
  horses: Array<{
    name: string;           // Required: Horse name
    odds: string;           // Required: Fractional odds (e.g., "3/1", "9-5", "4.5")
    post?: number;          // Optional: Post position (1-14)
    speed_figure?: number;  // Optional: Speed figure (80-120 typical range)
  }>;
  track?: string;           // Optional: Track name (e.g., "Gulfstream Park")
  surface?: string;         // Optional: Surface type (e.g., "dirt", "turf")
  distance_input?: string;  // Optional: Distance as string (e.g., "6f", "1 1/16 miles")
  distance_furlongs?: number; // Optional: Normalized distance in furlongs
  distance_meters?: number;   // Optional: Normalized distance in meters
  speedFigs?: { [horseName: string]: number }; // Optional: Speed figures lookup
  date?: string;            // Optional: Race date (YYYY-MM-DD)
  dateIso?: string;         // Optional: Race date ISO format
  raceNo?: string;          // Optional: Race number
  race?: string;            // Optional: Race number (alternate field)
}
```

**Minimum Requirements:**
- `horses` array with at least 3 horses
- Each horse must have `name` and `odds`

### A3. Pipeline Steps (In Order)

#### Step 1: Input Validation & Normalization

**File:** `pages/api/predict_wps.js`  
**Lines:** 172-199

```javascript
// Normalize distance if client didn't provide normalized values
if (!body.distance_furlongs || !body.distance_meters) {
  const norm = parseDistance(body.distance || body.distance_input || '');
  if (norm) {
    body.distance_furlongs = norm.distance_furlongs;
    body.distance_meters = norm.distance_meters;
  }
}

// Extract horses array
const { horses = [], track, surface, distance_input, distance_furlongs, distance_meters, speedFigs = {} } = body;

// Validate minimum horses
if (!Array.isArray(horses) || horses.length < 3) {
  return res.status(400).json({ ok: false, error: 'Need at least 3 horses' });
}
```

**Key Functions:**
- `parseDistance()` - `lib/distance.js` (normalizes distance strings to furlongs/meters)

#### Step 2: Odds Scoring

**File:** `pages/api/predict_wps.js`  
**Lines:** 201-203  
**Functions:** `impliedProbFromOdds()`, `normalizeRanks()`

```javascript
// Odds → implied probabilities → inverse rank (normalized 0–1)
const oddsImpl = horses.map(h => impliedProbFromOdds(h?.odds));
const oddsScore = normalizeRanks(oddsImpl);
```

**Math:**
1. **Implied Probability from Odds:**
   ```javascript
   function impliedProbFromOdds(frac) {
     const p = parseOddsFraction(frac);  // "3/1" → 3, "9-5" → 1.8
     return p ? (1 / (1 + p)) : 0.5;     // 3 → 0.25, 1.8 → 0.357
   }
   ```

2. **Normalize Ranks:**
   ```javascript
   function normalizeRanks(arr) {
     // Sort by value descending, assign normalized rank 1.0 to highest
     const o = arr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
     const r = new Array(n);
     o.forEach((row, idx) => { 
       r[row.i] = 1 - idx / (n - 1 || 1);  // Highest gets 1.0, lowest gets 0.0
     });
     return r;
   }
   ```

**Weight:** 40% of composite score (`W.o = 0.40`)

#### Step 3: Speed Figure Scoring

**File:** `pages/api/predict_wps.js`  
**Lines:** 205-216  
**Functions:** `zScores()`

```javascript
// Speed figs: fill missing with mean, then z-score → map to [0..1]
const speedRaw = horses.map(h => {
  const nm = String(h?.name || '').toLowerCase();
  const key = Object.keys(speedFigs).find(k => String(k).toLowerCase() === nm);
  const val = key ? Number(speedFigs[key]) : NaN;
  return Number.isNaN(val) ? null : val;
});

const have = speedRaw.filter(v => v != null);
const mean = have.length ? (have.reduce((a, b) => a + b, 0) / have.length) : 0;
const filled = speedRaw.map(v => (v == null ? mean : v));

const z = zScores(filled);  // Standardized z-scores (mean=0, std=1)
const speedScore = z.map(v => 0.5 + Math.max(Math.min(v, 2.5), -2.5) / 5);
// Clamp z to [-2.5, 2.5], then scale to [0, 1] with center at 0.5
```

**Math:**
1. **Z-Score:**
   ```javascript
   function zScores(vs) {
     const m = vs.reduce((a, b) => a + b, 0) / vs.length;  // Mean
     const sd = Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / vs.length) || 1;  // Std dev
     return vs.map(v => (v - m) / sd);  // (value - mean) / std_dev
   }
   ```

2. **Clamp and Scale:**
   - Clamp z-scores to [-2.5, 2.5] (2.5 standard deviations)
   - Scale to [0, 1] range: `0.5 + clamped_z / 5`
   - Result: Mean performance = 0.5, ±2.5σ mapped to [0, 1]

**Weight:** 50% of composite score (`W.s = 0.50`)

#### Step 4: Bias Factors

**File:** `pages/api/predict_wps.js`  
**Lines:** 218-246

```javascript
const miles = distance_furlongs != null 
  ? distance_furlongs / 8  // Convert furlongs to miles
  : toMiles(distance_input);
const sprint = (miles != null && miles < 1.0);
const surf = String(surface || '').toLowerCase();

const bias = horses.map((h, i) => {
  let b = 0.5;  // Base bias (neutral)

  // Surface-distance interplay: turf sprint boost
  if (surf.includes('turf') && sprint) b += (z[i] || 0) * 0.05;

  // Surface bias for routes: dirt slight boost, turf slight penalty
  if (!sprint) {
    if (surf.includes('dirt')) b += 0.02;
    if (surf.includes('turf')) b -= 0.02;
  }

  // Sprint post bias: inside preference, outside penalty
  const post = Number(h?.post);
  if (!Number.isNaN(post) && sprint) {
    if (post <= 4) b += 0.04;  // Inside posts get boost
    if (post >= 9) b -= 0.04;  // Outside posts get penalty
  }

  return Math.max(0, Math.min(1, b));  // Clamp to [0, 1]
});
```

**Bias Factors:**
- **Base:** 0.5 (neutral)
- **Turf sprint boost:** +0.05 × z-score (for turf sprints only)
- **Route surface:** +0.02 (dirt) / -0.02 (turf)
- **Sprint post position:** +0.04 (post ≤4) / -0.04 (post ≥9)

**Weight:** 10% of composite score (`W.b = 0.10`)

#### Step 5: Composite Score

**File:** `pages/api/predict_wps.js`  
**Lines:** 248-254

```javascript
// Dynamic weights (identical for sprint and route currently)
const W = sprint ? { o: 0.40, s: 0.50, b: 0.10 } : { o: 0.40, s: 0.50, b: 0.10 };

// Composite score
const comp = horses.map((h, i) =>
  W.o * oddsScore[i] + W.s * speedScore[i] + W.b * bias[i]
);
```

**Formula:**
```
composite[i] = 0.40 × oddsScore[i] + 0.50 × speedScore[i] + 0.10 × bias[i]
```

**Weights (Fixed):**
- **Odds (market wisdom):** 40%
- **Speed figures (performance):** 50%
- **Bias factors (track/surface/post):** 10%

#### Step 6: Ranking

**File:** `pages/api/predict_wps.js`  
**Lines:** 256-259

```javascript
// Full ranking: all horses sorted by composite
const fullRanking = comp
  .map((v, i) => ({ i, v, spd: speedScore[i] }))
  .sort((a, b) => (b.v - a.v) || (b.spd - a.spd));
```

**Sort Logic:**
1. Primary: Composite score (descending)
2. Tiebreaker: Speed score (descending)

#### Step 7: Probability Normalization

**File:** `pages/api/predict_wps.js`  
**Lines:** 261-263

```javascript
// Normalize composites to probabilities (softmax-like)
const compSum = comp.reduce((a, b) => a + b, 0);
const probs = comp.map(v => (compSum > 0 ? v / compSum : 1 / comp.length));
```

**Formula:**
```
prob[i] = composite[i] / Σ(composite)
```

**Result:** Probabilities sum to 1.0 (like softmax but simpler - direct normalization, no exponential)

#### Step 8: W/P/S Assignment

**File:** `pages/api/predict_wps.js`  
**Lines:** 265-313

```javascript
// Build full ranking with reasons
const ranking = fullRanking.map((o) => {
  const hs = horses[o.i] || {};
  const reasons = [];
  
  // Odds rank contribution
  const ro = oddsScore[o.i] - 0.5;
  if (Math.abs(ro) > 0.05) reasons.push(`odds rank inv ${ro > 0 ? '+' : ''}${ro.toFixed(2)}`);
  
  // Speed figure z-score
  const rz = z[o.i] || 0;
  if (Math.abs(rz) > 0.25) reasons.push(`speedFig z ${rz > 0 ? '+' : ''}${rz.toFixed(2)}`);
  
  // Context adjustments
  if (sprint) reasons.push('dist adj');
  if (surf) reasons.push('surf adj');
  if (!Number.isNaN(Number(hs.post))) reasons.push('post adj');
  
  return {
    name: hs.name,
    post: hs.post || null,
    odds: hs.odds || '',
    comp: o.v,        // Composite score
    prob: probs[o.i], // Normalized probability
    reasons,
  };
});

// Top 3 for W/P/S picks
const ord = fullRanking.slice(0, 3);
const slots = ['Win', 'Place', 'Show'];
const picks = ord.map((o, idx) => {
  // ... same reason generation ...
  return {
    slot: slots[idx],
    name: hs.name,
    odds: hs.odds || '',
    reasons
  };
});
```

**Assignment:**
- **Win:** Highest composite score (ranking[0])
- **Place:** 2nd highest composite score (ranking[1])
- **Show:** 3rd highest composite score (ranking[2])

**No special logic** - Simply top 3 horses by composite score.

#### Step 9: Confidence Calculation

**File:** `pages/api/predict_wps.js`  
**Lines:** 408-410

```javascript
// Confidence: mean composite ** 0.9, clamped 8%–85%
const meanComp = ord.reduce((a, b) => a + b.v, 0) / (ord.length || 1);
const confidence = Math.max(0.08, Math.min(0.85, Math.pow(meanComp, 0.9)));
```

**Formula:**
```
confidence = clamp(pow(mean(top3_composites), 0.9), 0.08, 0.85)
```

**Math:**
1. Mean of top 3 composite scores
2. Apply power function: `mean^0.9` (mild compression)
3. Clamp to [0.08, 0.85] range

**Result:** 0-1 range (fractional), typically displayed as 0-100%

#### Step 10: Top 3 Mass (T3M) Calculation

**File:** `pages/api/predict_wps.js`  
**Lines:** 415-420

```javascript
const P1 = ranking[0]?.prob || 0;
const P2 = ranking[1]?.prob || 0;
const P3 = ranking[2]?.prob || 0;
const top3Mass = P1 + P2 + P3;
```

**Formula:**
```
T3M = prob[Win] + prob[Place] + prob[Show]
```

**Result:** Fractional 0-1 range (sum of top 3 probabilities), typically displayed as 0-100%

#### Step 11: Strategy Recommendation (Post-Prediction)

**File:** `pages/api/predict_wps.js`  
**Lines:** 430-465

```javascript
let recommended = 'Across the Board';
let rationale = [];

if (confidence >= 0.68 && gap12 >= 0.08) {
  recommended = 'Win Only';
  rationale.push('Top pick clear vs #2 (gap≥8%)', `Confidence ${Math.round(confidence*100)}%`);
}

if (top3Mass >= 0.72 && gap12 <= 0.06 && gap23 <= 0.06) {
  recommended = 'Trifecta Box (AI Top 3)';
  rationale = [`Top-3 mass ${(top3Mass*100).toFixed(0)}%`, 'Order risk high (gaps ≤6%)'];
} else if (top3Mass >= 0.62 && gap12 <= 0.08) {
  if (recommended !== 'Trifecta Box (AI Top 3)') {
    recommended = 'Exacta Box (Top 3)';
    rationale = [`Top-3 mass ${(top3Mass*100).toFixed(0)}%`, 'Two-horse finish likely among Top 3'];
  }
}

if (confidence < 0.58 && top3Mass >= 0.55) {
  recommended = 'Across the Board';
  rationale = [`Confidence ${Math.round(confidence*100)}%`, `Top-3 mass ${(top3Mass*100).toFixed(0)}%`];
}
```

**Rules (evaluated in order):**
1. **Win Only:** `confidence ≥ 68%` AND `gap12 ≥ 8%`
2. **Trifecta Box:** `top3Mass ≥ 72%` AND `gap12 ≤ 6%` AND `gap23 ≤ 6%`
3. **Exacta Box:** `top3Mass ≥ 62%` AND `gap12 ≤ 8%` (if not Trifecta)
4. **Across the Board:** Default (or `confidence < 58%` AND `top3Mass ≥ 55%`)

**Note:** Strategy is **advisory only** - does NOT alter predictions.

#### Step 12: Calibration Post-Processor (Optional)

**File:** `pages/api/predict_wps.js`  
**Lines:** 486-544

```javascript
try {
  const __p = __loadParams();  // Load data/model_params.json
  if (__p.reliability && __p.reliability.length) {
    // Adjust confidence based on calibration curve
    const __cal = __calConf(confidence, __p.reliability);
    
    // Compute top3_mass using softmax-like adjustment
    const __mass = __soft([0, -1, -2], __p.temp_tau || 1.0);
    
    // Adjust picks probabilities
    const __top3 = picks.slice(0, 3).map((p, i) => ({
      ...p,
      prob: Math.round(Math.max(0.0001, __mass[i]) * __cal * 100)
    }));
    
    // Determine confidence band for policy lookup
    const __perc = Math.round(__cal * 100);
    let __band = '60-64';
    if (__perc >= 85) __band = '85-100';
    else if (__perc >= 80) __band = '80-84';
    // ... more bands ...
    
    const __policy = (__p.policy && __p.policy[__band]) || {};
    const __reco = __tc(__policy.recommended || finalStrategy?.recommended || 'across the board');
    
    calibratedResponse = {
      ...calibratedResponse,
      picks: __top3,           // Adjusted picks (probabilities changed)
      confidence: __perc,      // Calibrated confidence (0-100)
      top3_mass: Math.round(__top3_mass),  // Sum of adjusted picks
      strategy: {
        ...finalStrategy,
        recommended: __reco,   // Policy-overridden strategy
        band: __band,
        policy_stats: __policy.stats || null
      },
      meta: {
        ...calibratedResponse.meta,
        calibrated: true,
        model: 'calib-v1'
      }
    };
  }
} catch (calibErr) {
  // Fallback to raw response
}
```

**Calibration Files:**
- `data/model_params.json` - Contains `reliability` array and `policy` bands
- Format: `{ reliability: [{c, p}, ...], temp_tau: 1.0, policy: { "60-64": {...}, ... } }`

**Calibration Functions:**
- `__calConf(raw, rel)` - Confidence calibration (piecewise linear interpolation)
- `__soft(scores, tau)` - Softmax-like normalization with temperature

**What Changes:**
- ✅ Confidence value (regressed based on historical accuracy)
- ✅ Pick probabilities (adjusted using softmax with temperature)
- ✅ Strategy recommendation (may be overridden by policy band)
- ❌ **Ranking order does NOT change** (still top 3 by composite score)

#### Step 13: JSON Response Formatting

**File:** `pages/api/predict_wps.js`  
**Lines:** 816-825

```javascript
return res.status(200).json({
  ok: true,
  ...calibratedResponse,
  shadowDecision,
  calibrationThresholds: {
    strategyName: thresholds.strategyName,
    version: thresholds.version,
  },
  predmeta_debug: predmetaDebug,
});
```

**Response Structure:** See Section B for full example.

---

## B. Real Prediction JSON Examples

### B1. Golden Prediction JSON (Representative Example)

**Source:** Constructed from production code schema analysis  
**Race:** Gulfstream Park, 6f dirt sprint, 8 horses  
**Timestamp:** 2026-01-06 17:49:19 UTC

```json
{
  "ok": true,
  "picks": [
    {
      "slot": "Win",
      "name": "Thunder Strike",
      "odds": "3/1",
      "reasons": [
        "odds rank inv +0.15",
        "speedFig z +1.25",
        "dist adj",
        "surf adj",
        "post adj"
      ],
      "prob": 35
    },
    {
      "slot": "Place",
      "name": "Lightning Bolt",
      "odds": "5/2",
      "reasons": [
        "odds rank inv +0.08",
        "speedFig z +0.85",
        "dist adj",
        "surf adj",
        "post adj"
      ],
      "prob": 28
    },
    {
      "slot": "Show",
      "name": "Silver Star",
      "odds": "7/2",
      "reasons": [
        "odds rank inv +0.03",
        "speedFig z +0.45",
        "dist adj",
        "surf adj"
      ],
      "prob": 22
    }
  ],
  "confidence": 72,
  "top3_mass": 85,
  "ranking": [
    {
      "name": "Thunder Strike",
      "post": 3,
      "odds": "3/1",
      "comp": 0.742,
      "prob": 0.35,
      "reasons": ["odds rank inv +0.15", "speedFig z +1.25", "dist adj", "surf adj", "post adj"]
    },
    {
      "name": "Lightning Bolt",
      "post": 5,
      "odds": "5/2",
      "comp": 0.618,
      "prob": 0.28,
      "reasons": ["odds rank inv +0.08", "speedFig z +0.85", "dist adj", "surf adj", "post adj"]
    },
    {
      "name": "Silver Star",
      "post": 2,
      "odds": "7/2",
      "comp": 0.521,
      "prob": 0.22,
      "reasons": ["odds rank inv +0.03", "speedFig z +0.45", "dist adj", "surf adj"]
    },
    {
      "name": "Dark Moon",
      "post": 7,
      "odds": "4/1",
      "comp": 0.398,
      "prob": 0.09,
      "reasons": ["speedFig z -0.15"]
    },
    {
      "name": "Wind Rider",
      "post": 8,
      "odds": "6/1",
      "comp": 0.287,
      "prob": 0.04,
      "reasons": []
    },
    {
      "name": "Storm Cloud",
      "post": 1,
      "odds": "8/1",
      "comp": 0.195,
      "prob": 0.02,
      "reasons": ["dist adj", "surf adj", "post adj"]
    }
  ],
  "tickets": {
    "trifecta": [
      {
        "text": "Thunder Strike / Lightning Bolt / Silver Star,Dark Moon",
        "confidence": 0.42
      },
      {
        "text": "BOX Thunder Strike,Lightning Bolt,Silver Star",
        "confidence": 0.38
      }
    ],
    "superfecta": [
      {
        "text": "Thunder Strike / Lightning Bolt / Silver Star,Dark Moon / Silver Star,Dark Moon,Wind Rider",
        "confidence": 0.28
      },
      {
        "text": "Thunder Strike / Thunder Strike,Lightning Bolt / Lightning Bolt,Silver Star,Dark Moon / Silver Star,Dark Moon,Wind Rider",
        "confidence": 0.22
      }
    ],
    "superHighFive": [
      {
        "text": "Thunder Strike / Lightning Bolt / Silver Star / Dark Moon,Wind Rider / Dark Moon,Wind Rider,Storm Cloud",
        "confidence": 0.15
      },
      {
        "text": "Thunder Strike / Lightning Bolt,Silver Star / Lightning Bolt,Silver Star,Dark Moon / Dark Moon,Wind Rider / Wind Rider,Storm Cloud",
        "confidence": 0.12
      }
    ]
  },
  "strategy": {
    "recommended": "Exacta Box (Top 3)",
    "rationale": [
      "Top-3 mass 85%",
      "Two-horse finish likely among Top 3"
    ],
    "betTypesTable": [
      {
        "type": "Trifecta Box (AI Top 3)",
        "icon": "🔥",
        "bestFor": "Max profit",
        "desc": "Leverages AI's strength at identifying the 3 right horses even if order flips."
      },
      {
        "type": "Across the Board",
        "icon": "🛡️",
        "bestFor": "Consistency",
        "desc": "Always collects if top pick finishes top 3. Ideal for low variance bankroll play."
      },
      {
        "type": "Win Only",
        "icon": "🎯",
        "bestFor": "Confidence plays",
        "desc": "When AI confidence > 68%, Win-only yields clean edge."
      },
      {
        "type": "Exacta Box (Top 3)",
        "icon": "⚖️",
        "bestFor": "Middle ground",
        "desc": "Works when AI has correct pair but misses trifecta."
      }
    ],
    "metrics": {
      "confidence": 0.72,
      "top3Mass": 0.85,
      "gap12": 0.07,
      "gap23": 0.06,
      "top": [
        { "name": "Thunder Strike", "prob": 0.35, "comp": 0.742 },
        { "name": "Lightning Bolt", "prob": 0.28, "comp": 0.618 },
        { "name": "Silver Star", "prob": 0.22, "comp": 0.521 },
        { "name": "Dark Moon", "prob": 0.09, "comp": 0.398 },
        { "name": "Wind Rider", "prob": 0.04, "comp": 0.287 },
        { "name": "Storm Cloud", "prob": 0.02, "comp": 0.195 }
      ]
    },
    "band": "70-74",
    "policy_stats": null
  },
  "meta": {
    "track": "Gulfstream Park",
    "surface": "dirt",
    "distance_mi": 0.75,
    "distance_furlongs": 6,
    "distance_meters": 1207,
    "calibrated": true,
    "model": "calib-v1"
  },
  "shadowDecision": {
    "strategyName": "v1_shadow_only_default",
    "version": 1,
    "fieldSize": 8,
    "confidences": {
      "win": null,
      "place": null,
      "show": null
    },
    "allow": {
      "win": false,
      "place": false,
      "show": false
    }
  },
  "calibrationThresholds": {
    "strategyName": "v1_shadow_only_default",
    "version": 1
  },
  "predmeta_debug": {
    "enabled": false,
    "mode": null,
    "key": null,
    "written": false,
    "error": null
  }
}
```

**Fields Required by Downstream Scripts:**

1. **`picks`** (required) - Array of 3 picks with `slot`, `name`, `odds`
   - Used by: UI rendering, verify_race.js (predicted picks)
   - Format: `[{slot: "Win"|"Place"|"Show", name: string, odds: string, reasons: string[]}]`

2. **`confidence`** (required) - Overall confidence 0-100
   - Used by: Calibration scripts (export_verify_redis_to_csv.mjs)
   - Format: Integer 0-100 (after calibration) or float 0-1 (raw)

3. **`top3_mass`** (required if predmeta enabled) - Sum of top 3 probabilities
   - Used by: Calibration scripts (T3M bucket analysis)
   - Format: Integer 0-100 (after calibration) or float 0-1 (raw)

4. **`ranking`** (optional but recommended) - Full ranking of all horses
   - Used by: UI display, exotic ticket generation
   - Format: Array of `{name, post, odds, comp, prob, reasons}`

5. **`strategy.recommended`** (optional) - Strategy recommendation string
   - Used by: UI display, calibration policy lookup
   - Format: String ("Across the Board", "Win Only", etc.)

6. **`meta.track`**, **`meta.surface`**, **`meta.distance_furlongs`** (optional)
   - Used by: Calibration scripts (track/surface analysis)
   - Format: Strings and numbers

### B2. Prediction at Different Snapshots (MTP)

**Why Not Available:**
- FinishLine WPS AI does NOT currently track time-to-post (MTP) in predictions
- Predictions are stateless - same input always produces same output
- No late-signal volatility tracking (see Section D for details)

**Potential Enhancement:**
- Add `mtp` (minutes to post) to input schema
- Adjust confidence/T3M based on MTP (late signals may increase volatility)
- Track prediction changes over time for same race

---

## C. Calibration Pipeline (Source of Truth)

### C1. Entrypoint

**Nightly Workflow:** `.github/workflows/nightly-calibration.yml`  
**Schedule:** Weekly on Sunday at 08:15 UTC  
**Trigger:** Cron schedule + manual `workflow_dispatch`

**Steps:**
1. Checkout repo (full history)
2. Install dependencies (`npm ci`)
3. Export verify logs from Redis (`npm run export:verify-redis`)
4. Build calibration sample (`npm run build:calibration-sample`)
5. Run verify v1 calibration (`npm run calibrate:verify-v1`)
6. Commit artifacts if changed

### C2. Calibration Pipeline Steps

#### Step 1: Export Verify Logs from Redis

**Script:** `scripts/calibration/export_verify_redis_to_csv.mjs`  
**NPM Command:** `npm run export:verify-redis`

**What it does:**
1. Scans all `fl:verify:*` keys in Redis
2. Reads verify logs (stored as JSON strings via `redis.set()`)
3. Normalizes to calibration CSV schema
4. Writes to `data/finishline_tests_from_verify_redis_v1.csv`

**CSV Schema:**
```csv
track,date,raceNo,strategyName,version,predWin,predPlace,predShow,outWin,outPlace,outShow,winHit,placeHit,showHit,top3Hit,confidence_pct,t3m_pct,top3_list
```

**Fields:**
- `track`, `date`, `raceNo` - Race identifiers
- `strategyName`, `version` - Prediction strategy metadata
- `predWin`, `predPlace`, `predShow` - Predicted horses
- `outWin`, `outPlace`, `outShow` - Actual outcome horses
- `winHit`, `placeHit`, `showHit`, `top3Hit` - Boolean hit flags
- `confidence_pct` - Confidence percentage (0-100) from prediction
- `t3m_pct` - Top 3 Mass percentage (0-100) from prediction
- `top3_list` - JSON array of top 3 horse names

**Source:** Redis keys `fl:verify:*` (written by `pages/api/verify_race.js`)

#### Step 2: Build Calibration Sample

**Script:** `scripts/calibration/build_calibration_sample_from_verify_csv.mjs`  
**NPM Command:** `npm run build:calibration-sample`

**What it does:**
1. Reads `data/finishline_tests_from_verify_redis_v1.csv`
2. Filters to rows where at least one of `predWin`, `predPlace`, `predShow` is non-empty
3. Keeps first 5,000 qualifying rows (stable order by CSV row number)
4. Writes to `data/finishline_tests_calibration_v1.csv`

**Purpose:** Create a stable, fixed-size sample for consistent calibration metrics.

#### Step 3: Run Verify v1 Calibration

**Script:** `scripts/calibration/run_calibrate_verify_v1.mjs`  
**NPM Command:** `npm run calibrate:verify-v1`  
**Library:** `lib/calibration/verify_metrics_v1.js`

**What it does:**
1. Loads `data/finishline_tests_calibration_v1.csv`
2. Parses CSV rows (handles quoted values with commas)
3. Computes metrics using `computeVerifyMetricsV1()`:
   - **Global hit rates** (win, place, show, top3, any, exact trifecta)
   - **Per-track hit rates** (tracks with ≥10 races)
   - **Per-race-number hit rates** (race 1, 2, 3, etc.)
   - **Per-strategy hit rates** (currently all "default@v1")
   - **Predmeta coverage** (how many rows have confidence/T3M)
   - **Accuracy by confidence bucket** (60-70%, 70-80%, 80+%)
   - **Accuracy by T3M bucket** (30-40%, 40-50%, 50-60%, 60+%)
4. Generates JSON report: `data/calibration/verify_v1_report.json`
5. Generates Markdown report: `data/calibration/verify_v1_report.md`

**Metrics Computed:**

```javascript
// Global metrics
{
  races: number,
  winHitRate: number,        // Fraction of races where predWin == outWin
  placeHitRate: number,      // Fraction of races where predPlace == outPlace
  showHitRate: number,       // Fraction of races where predShow == outShow
  top3HitRate: number,       // Fraction of races where any pick finished top 3
  anyHitRate: number,        // Fraction of races where any pick hit (win OR place OR show)
  exactTrifectaRate: number, // Fraction of races where all 3 picks matched exactly
  partialOrderTop3Rate: number // Same as top3HitRate
}

// Per-track metrics (same structure, filtered by track)
{
  [trackName]: {
    races: number,
    winHitRate: number,
    top3HitRate: number
  }
}

// Predmeta metrics
{
  coverage: {
    totalRows: number,
    rowsWithConfidence: number,
    rowsWithT3m: number,
    rowsWithBoth: number,
    coverageRate: number  // Fraction of rows with both confidence and T3M
  },
  accuracyByConfidenceBucket: {
    "60-70": { races: number, winHitRate: number, top3HitRate: number },
    "70-80": { races: number, winHitRate: number, top3HitRate: number },
    "80+": { races: number, winHitRate: number, top3HitRate: number }
  },
  accuracyByT3mBucket: {
    "30-40": { races: number, winHitRate: number, top3HitRate: number },
    "40-50": { races: number, winHitRate: number, top3HitRate: number },
    "50-60": { races: number, winHitRate: number, top3HitRate: number },
    "60+": { races: number, winHitRate: number, top3HitRate: number }
  }
}
```

### C3. How Outcomes Are Matched to Predictions

**Source:** Verify logs in Redis (`fl:verify:*` keys)

**Written by:** `pages/api/verify_race.js` (when user verifies a race outcome)

**Verification Flow:**
1. User calls `/api/verify_race` with `{track, date, raceNo, outcome: {win, place, show}}`
2. `verify_race.js`:
   - Looks up prediction from `fl:predmeta:*` keys (permanent or pending)
   - Compares predicted picks to actual outcome
   - Computes hit flags (`winHit`, `placeHit`, `showHit`, `top3Hit`)
   - Writes verify log to `fl:verify:{raceId}` (JSON string)
   - Embeds predmeta fields (`confidence_pct`, `t3m_pct`, `top3_list`) in verify log

**Matching Logic:**
```javascript
const winHit = predicted.win && outcome.win && 
  predicted.win.toLowerCase().trim() === outcome.win.toLowerCase().trim();
const placeHit = predicted.place && outcome.place && 
  predicted.place.toLowerCase().trim() === outcome.place.toLowerCase().trim();
const showHit = predicted.show && outcome.show && 
  predicted.show.toLowerCase().trim() === outcome.show.toLowerCase().trim();
const top3Hit = winHit || placeHit || showHit ||
  (predicted.win && [outcome.win, outcome.place, outcome.show].includes(predicted.win)) ||
  (predicted.place && [outcome.win, outcome.place, outcome.show].includes(predicted.place)) ||
  (predicted.show && [outcome.win, outcome.place, outcome.show].includes(predicted.show));
```

**Race ID Format:** `fl:verify:{date}|{normalizedTrack}|{raceNo}`

### C4. Calibration Artifacts

**Artifacts Generated:**

1. **`data/finishline_tests_from_verify_redis_v1.csv`**
   - All verify logs exported from Redis
   - Schema: See Step 1 above
   - Updated: Every calibration run

2. **`data/finishline_tests_calibration_v1.csv`**
   - Filtered sample (max 5,000 rows, predictions-only)
   - Same schema as above
   - Updated: Every calibration run (stable order)

3. **`data/calibration/verify_v1_report.json`**
   - Machine-readable metrics
   - Format: JSON object with `meta`, `global`, `byTrack`, `byRaceNo`, `byStrategy`, `predmeta`
   - Updated: Every calibration run

4. **`data/calibration/verify_v1_report.md`**
   - Human-readable summary
   - Format: Markdown with tables
   - Updated: Every calibration run

**Artifacts Committed:**
- All 4 artifacts are committed to `master` branch after each calibration run
- Commit message: `"ci: nightly calibration artifacts"`
- Author: `github-actions[bot]`

---

## D. Where the Percentages Can "Not Match" (Important)

### D1. Confidence% Calculation

**File:** `pages/api/predict_wps.js`  
**Lines:** 408-410

**Raw Formula:**
```javascript
const meanComp = ord.reduce((a, b) => a + b.v, 0) / (ord.length || 1);
const confidence = Math.max(0.08, Math.min(0.85, Math.pow(meanComp, 0.9)));
```

**Math:**
1. **Mean Composite:** Average of top 3 composite scores
2. **Power Function:** `mean^0.9` (mild compression toward center)
3. **Clamp:** [0.08, 0.85] range

**Calibrated Formula (if calibration file exists):**
```javascript
const __cal = __calConf(confidence, __p.reliability);
const __perc = Math.round(__cal * 100);
```

**Calibration Function (`__calConf`):**
```javascript
function __calConf(raw, rel) {
  if (!rel?.length) return raw;
  const arr = [...rel].sort((a, b) => a.c - b.c);  // Sort by c (confidence)
  if (raw <= arr[0].c) return arr[0].p;  // Below min → min calibrated
  if (raw >= arr[arr.length - 1].c) return arr[arr.length - 1].p;  // Above max → max calibrated
  // Linear interpolation between calibration points
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i - 1], b = arr[i];
    if (raw <= b.c) {
      const t = (raw - a.c) / (b.c - a.c);
      return a.p * (1 - t) + b.p * t;
    }
  }
  return raw;
}
```

**What Confidence% Represents:**
- ✅ **Overall prediction strength** (higher = more confident)
- ✅ **Calibrated** to match historical accuracy (if calibration file exists)
- ❌ **NOT** the probability that the Win pick will win
- ❌ **NOT** the probability that any pick will finish top 3
- ❌ **NOT** a direct probability of any specific outcome

**Misunderstanding Risk:**
Users might interpret `confidence: 72` as "72% chance the Win pick wins" - this is **incorrect**. It's an overall confidence metric that's been calibrated to historical accuracy but doesn't directly map to win probability.

### D2. Top 3 Mass (T3M)% Calculation

**File:** `pages/api/predict_wps.js`  
**Lines:** 415-420

**Raw Formula:**
```javascript
const P1 = ranking[0]?.prob || 0;
const P2 = ranking[1]?.prob || 0;
const P3 = ranking[2]?.prob || 0;
const top3Mass = P1 + P2 + P3;
```

**Math:**
1. Sum of top 3 normalized probabilities
2. Raw result: Fractional 0-1 range
3. Display: Typically shown as 0-100%

**Calibrated Formula (if calibration file exists):**
```javascript
const __mass = __soft([0, -1, -2], __p.temp_tau || 1.0);
const __top3 = picks.slice(0, 3).map((p, i) => ({
  ...p,
  prob: Math.round(Math.max(0.0001, __mass[i]) * __cal * 100)
}));
const __top3_mass = __top3.reduce((a, h) => a + (h.prob || 0), 0);
```

**Softmax Function (`__soft`):**
```javascript
function __soft(scores, tau = 1.0) {
  const ex = scores.map(s => Math.exp(s / Math.max(0.05, tau)));
  const Z = ex.reduce((a, b) => a + b, 0);
  return ex.map(v => v / Z);
}
```

**Temperature Effect:**
- `tau = 1.0`: Normal softmax
- `tau > 1.0`: Softer distribution (more spread)
- `tau < 1.0`: Sharper distribution (more concentrated)

**What T3M% Represents:**
- ✅ **Sum of top 3 normalized probabilities** (how much probability mass is in top 3)
- ✅ **Calibrated** if calibration file exists (probabilities adjusted)
- ❌ **NOT** the probability that at least one pick finishes top 3
- ❌ **NOT** the probability that all 3 picks finish top 3
- ❌ **NOT** a direct probability of any specific outcome

**Misunderstanding Risk:**
Users might interpret `top3_mass: 85` as "85% chance at least one pick finishes top 3" - this is **incorrect**. It's the sum of individual probabilities, which doesn't account for correlations or dependencies between picks.

### D3. Why Percentages Don't Match Direct Probabilities

**Key Reasons:**

1. **Normalization Artifact:**
   - Probabilities are normalized from composite scores: `prob[i] = composite[i] / Σ(composite)`
   - This ensures probabilities sum to 1.0, but doesn't mean they're "true" probabilities
   - Composite scores are weighted sums of odds, speed, and bias - not probabilities themselves

2. **No Correlation Modeling:**
   - Individual pick probabilities are independent in the model
   - Reality: If Win pick wins, Place/Show probabilities change (mutually exclusive outcomes)
   - T3M = P(Win) + P(Place) + P(Show) assumes independence (incorrect assumption)

3. **Confidence is Meta-Probability:**
   - Confidence is calibrated to historical accuracy (reliability curve)
   - It's a "confidence in the prediction" not "probability of outcome"
   - Example: `confidence: 72` means "this prediction is as reliable as historical 72% confident predictions"

4. **Calibration Adjusts, Doesn't Fix:**
   - Calibration regresses extreme probabilities toward mean
   - It makes predictions more accurate on average, but doesn't convert scores to true probabilities
   - Calibrated probabilities are still normalized composite scores, just adjusted

**Code References:**

- Confidence calculation: `pages/api/predict_wps.js:408-410`
- T3M calculation: `pages/api/predict_wps.js:415-420`
- Probability normalization: `pages/api/predict_wps.js:261-263`
- Calibration adjustment: `pages/api/predict_wps.js:502-514`

---

## E. Integration Points + Risk Surface

### E1. Scripts/Components Consuming Prediction JSON

**1. UI Rendering (`public/js/finishline-picker-bootstrap.js`)**
- **Consumes:** `picks`, `confidence`, `ranking`, `strategy.recommended`
- **Usage:** Display predictions, confidence, strategy recommendation
- **Required Fields:** `picks` (array with `slot`, `name`, `odds`), `confidence`
- **Risk:** Breaking change if `picks` structure changes

**2. Verify Race (`pages/api/verify_race.js`)**
- **Consumes:** `picks` (predicted Win/Place/Show), `confidence`, `top3_mass`
- **Usage:** Compare predicted picks to actual outcome, compute hit flags
- **Required Fields:** `picks` array with `name` field
- **Risk:** Case-sensitive string matching (horse names must match exactly)

**3. Predmeta Persistence (`pages/api/predict_wps.js:676-804`)**
- **Consumes:** `picks`, `ranking`, `confidence`, `top3_mass`, `strategy.recommended`
- **Usage:** Write prediction metadata to Redis for later verification
- **Required Fields:** `confidence` (must be finite number)
- **Risk:** Redis write failures (non-blocking, but data loss if fails)

**4. Calibration Export (`scripts/calibration/export_verify_redis_to_csv.mjs`)**
- **Consumes:** Verify logs (which embed prediction fields)
- **Usage:** Extract `confidence_pct`, `t3m_pct`, `top3_list` from verify logs
- **Required Fields:** `confidence_pct`, `t3m_pct` (optional but recommended)
- **Risk:** Missing predmeta fields if predmeta write failed

**5. Client Storage (`localStorage`)**
- **Consumes:** Full prediction JSON
- **Usage:** Cache predictions for refresh/back navigation
- **Required Fields:** All fields (for complete cache)
- **Risk:** `localStorage` quota limits, browser compatibility

**6. Backfill Scripts (`scripts/backfill-*.js`)**
- **Consumes:** Prediction responses (indirectly via verify logs)
- **Usage:** Re-verify historical races, compute calibration metrics
- **Required Fields:** None (uses verify logs, not direct predictions)
- **Risk:** Historical predictions may not match current schema

### E2. Scripts/Components Consuming Calibration Artifacts

**1. Calibration Metrics (`lib/calibration/verify_metrics_v1.js`)**
- **Consumes:** `data/finishline_tests_calibration_v1.csv`
- **Usage:** Compute hit rates, accuracy buckets, predmeta coverage
- **Required Fields:** `track`, `date`, `raceNo`, `predWin`, `predPlace`, `predShow`, `outWin`, `outPlace`, `outShow`, `winHit`, `placeHit`, `showHit`, `top3Hit`
- **Optional Fields:** `confidence_pct`, `t3m_pct`, `top3_list` (for predmeta analysis)
- **Risk:** CSV schema changes break parsing (hard-coded column indices)

**2. Calibration Report Generation (`scripts/calibration/run_calibrate_verify_v1.mjs`)**
- **Consumes:** Calibration CSV, generates JSON/MD reports
- **Usage:** Produce human-readable and machine-readable reports
- **Required Fields:** Same as above
- **Risk:** Report generation fails if CSV schema changes

**3. Model Parameters (`data/model_params.json`)**
- **Consumed By:** `pages/api/predict_wps.js:502-514` (calibration post-processor)
- **Format:** `{ reliability: [{c, p}, ...], temp_tau: number, policy: { "60-64": {...}, ... } }`
- **Required Fields:** `reliability` array (for confidence calibration)
- **Optional Fields:** `temp_tau` (default 1.0), `policy` (for strategy overrides)
- **Risk:** Missing file causes fallback to raw predictions (non-fatal)

**4. Calibration Thresholds (`config/calibration_thresholds.json`)**
- **Consumed By:** `lib/calibrationThresholds.js` (shadow-mode decision)
- **Format:** `{ version: number, strategyName: string, win: {...}, place: {...}, show: {...}, global: {...} }`
- **Required Fields:** None (has defaults)
- **Risk:** Missing file causes fallback to defaults (non-fatal)

### E3. Rigid Schema Expectations

**CSV Schema (Hard-Coded Column Names):**

**File:** `scripts/calibration/export_verify_redis_to_csv.mjs`  
**Lines:** 144-160

```javascript
const header = [
  "track",
  "date",
  "raceNo",
  "strategyName",
  "version",
  "predWin",
  "predPlace",
  "predShow",
  "outWin",
  "outPlace",
  "outShow",
  "winHit",
  "placeHit",
  "showHit",
  "top3Hit",
  "confidence_pct",  // Optional but recommended
  "t3m_pct",         // Optional but recommended
  "top3_list"        // Optional but recommended
];
```

**CSV Parser (Hard-Coded Column Indices):**

**File:** `scripts/calibration/run_calibrate_verify_v1.mjs`  
**Lines:** 62-82

```javascript
const fieldMap = {
  track: header.indexOf("track"),
  date: header.indexOf("date"),
  raceNo: header.indexOf("raceNo"),
  strategyName: header.indexOf("strategyName"),
  version: header.indexOf("version"),
  predWin: header.indexOf("predWin"),
  predPlace: header.indexOf("predPlace"),
  predShow: header.indexOf("predShow"),
  outWin: header.indexOf("outWin"),
  outPlace: header.indexOf("outPlace"),
  outShow: header.indexOf("outShow"),
  winHit: header.indexOf("winHit"),
  placeHit: header.indexOf("placeHit"),
  showHit: header.indexOf("showHit"),
  top3Hit: header.indexOf("top3Hit"),
  confidence_pct: header.indexOf("confidence_pct"),
  t3m_pct: header.indexOf("t3m_pct"),
  top3_list: header.indexOf("top3_list"),
};
```

**Risk:** Column order changes or missing columns break parsing (though `indexOf` returns -1 for missing columns, which is handled).

**JSON Response Schema (Hard-Coded Keys):**

**UI Consumers:** `public/js/finishline-picker-bootstrap.js:602-617`

```javascript
const picks = data?.picks || [];
const winPick = picks.find(p => p.slot === 'Win') || picks[0];
const placePick = picks.find(p => p.slot === 'Place') || picks[1];
const showPick = picks.find(p => p.slot === 'Show') || picks[2];
```

**Risk:** Assumes `picks` array has at least 3 elements, with `slot` field matching exactly "Win", "Place", "Show" (case-sensitive).

---

## F. Run Instructions

### F1. Run One Prediction Locally

**Prerequisites:**
- Node.js 20.x installed
- Dependencies installed (`npm install`)
- (Optional) Redis credentials if testing predmeta writes

**Option 1: Via Next.js Dev Server**

```bash
# Start dev server
npm run dev

# In another terminal, send POST request
curl -X POST http://localhost:3000/api/predict_wps \
  -H "Content-Type: application/json" \
  -d '{
    "horses": [
      {"name": "Thunder Strike", "odds": "3/1", "post": 3},
      {"name": "Lightning Bolt", "odds": "5/2", "post": 5},
      {"name": "Silver Star", "odds": "7/2", "post": 2},
      {"name": "Dark Moon", "odds": "4/1", "post": 7}
    ],
    "track": "Gulfstream Park",
    "surface": "dirt",
    "distance_input": "6f",
    "speedFigs": {
      "Thunder Strike": 95,
      "Lightning Bolt": 92,
      "Silver Star": 88,
      "Dark Moon": 85
    }
  }' | jq '.'
```

**Option 2: Direct Node.js Script (Temporary Debug)**

Create `temp_test_prediction.mjs`:

```javascript
// temp_test_prediction.mjs
import handler from './pages/api/predict_wps.js';

const req = {
  method: 'POST',
  body: JSON.stringify({
    horses: [
      { name: "Thunder Strike", odds: "3/1", post: 3 },
      { name: "Lightning Bolt", odds: "5/2", post: 5 },
      { name: "Silver Star", odds: "7/2", post: 2 },
      { name: "Dark Moon", odds: "4/1", post: 7 }
    ],
    track: "Gulfstream Park",
    surface: "dirt",
    distance_input: "6f",
    speedFigs: {
      "Thunder Strike": 95,
      "Lightning Bolt": 92,
      "Silver Star": 88,
      "Dark Moon": 85
    }
  })
};

const res = {
  statusCode: 200,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }
};

handler(req, res).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
```

Run:
```bash
node temp_test_prediction.mjs
```

**Note:** This is a temporary debug script - remove after testing.

### F2. Run Calibration Locally

**Prerequisites:**
- Node.js 20.x installed
- Dependencies installed (`npm install`)
- Redis credentials (environment variables):
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

**Full Calibration Pipeline:**

```bash
# Step 1: Export verify logs from Redis
npm run export:verify-redis

# Step 2: Build calibration sample (max 5,000 rows)
npm run build:calibration-sample

# Step 3: Run verify v1 calibration
npm run calibrate:verify-v1
```

**Output Artifacts:**
- `data/finishline_tests_from_verify_redis_v1.csv` (all verify logs)
- `data/finishline_tests_calibration_v1.csv` (filtered sample)
- `data/calibration/verify_v1_report.json` (machine-readable)
- `data/calibration/verify_v1_report.md` (human-readable)

**Individual Steps:**

```bash
# Export only
node scripts/calibration/export_verify_redis_to_csv.mjs

# Build sample only
node scripts/calibration/build_calibration_sample_from_verify_csv.mjs

# Run calibration only
node scripts/calibration/run_calibrate_verify_v1.mjs
```

### F3. Generate a Report Artifact

**Option 1: Calibration Report (Recommended)**

```bash
# Run full calibration pipeline (generates both JSON and MD)
npm run calibrate:verify-v1

# Output: data/calibration/verify_v1_report.md
```

**Option 2: Shadow Calibration Report**

```bash
# Generate shadow report (different metrics)
npm run shadow:report

# Output: data/shadow_calibration_report_v1.md
```

**Option 3: Manual Report Generation**

The calibration script automatically generates both JSON and MD reports. To regenerate MD only:

```bash
# Edit scripts/calibration/run_calibrate_verify_v1.mjs
# Re-run calibration script
npm run calibrate:verify-v1
```

---

## G. Calibration Reports

### G1. Latest Calibration Report (2026-01-04)

**Commit:** `4efa012f879b1b19f216f0409daa536d86f3d1b6`  
**Date:** 2026-01-04 09:03:50 UTC  
**Source:** `docs/CAL_DIAG_ARTIFACTS_2026-01-04.md`

**Summary:**

- **Total Races:** 5,000 (unchanged)
- **Win Hit Rate:** 24.38% (+0.70pp from previous)
- **Place Hit Rate:** 13.72% (-1.14pp from previous)
- **Show Hit Rate:** 12.24% (+0.60pp from previous)
- **Top 3 Hit Rate:** 81.30% (+1.28pp from previous)
- **Any Hit Rate:** 38.58% (+1.08pp from previous)
- **Exact Trifecta Rate:** 0.92% (-0.12pp from previous)
- **Predmeta Coverage:** 32.86% (+8.04pp from previous)

**Key Findings:**
- ✅ Top 3 Hit Rate improved (+1.28pp)
- ✅ Win Hit Rate improved (+0.70pp)
- ✅ Predmeta coverage increased significantly (+32.39% relative)
- ⚠️ Place Hit Rate declined (-1.14pp)

**Full Report:** See `docs/CAL_DIAG_ARTIFACTS_2026-01-04.md`

### G2. Previous Calibration Report (2025-12-28)

**Commit:** `406fd1d65f98cdcb4d60d1c159b7d298623fa627`  
**Date:** 2025-12-28 09:25:04 UTC  
**Source:** `data/calibration/verify_v1_report.json`

**Summary:**

- **Total Races:** 5,000
- **Win Hit Rate:** 23.68%
- **Place Hit Rate:** 14.86%
- **Show Hit Rate:** 11.64%
- **Top 3 Hit Rate:** 80.02%
- **Any Hit Rate:** 37.50%
- **Exact Trifecta Rate:** 1.04%
- **Predmeta Coverage:** 24.82%

**Accuracy by Confidence Bucket:**
- **60-70%:** 26 races, 0.0% win, 100.0% top3
- **70-80%:** 108 races, 25.0% win, 100.0% top3
- **80+%:** 1,107 races, 21.5% win, 83.4% top3

**Accuracy by T3M Bucket:**
- **30-40%:** 392 races, 20.2% win, 73.2% top3
- **40-50%:** 478 races, 11.1% win, 88.9% top3
- **50-60%:** 212 races, 62.7% win, 100.0% top3
- **60+%:** 107 races, 0.0% win, 100.0% top3

**Full Report:** See `data/calibration/verify_v1_report.json`

---

## H. Enhancement Opportunities for ChatGPT

Based on this deep dive, here are specific areas where additive intelligence could improve the system:

### H1. Probability Layer Enhancement

**Current State:**
- Probabilities are normalized composite scores, not true probabilities
- No correlation modeling between picks (mutually exclusive outcomes)
- T3M assumes independence (incorrect assumption)

**Enhancement Opportunities:**
- **Harville Formulas:** Convert Win probabilities to Place/Show probabilities using Harville formulas (accounts for mutual exclusivity)
- **Correlation Modeling:** Adjust probabilities based on joint outcomes (e.g., if Win pick wins, adjust Place/Show probabilities)
- **True Probability Calibration:** Train a model to convert composite scores to calibrated probabilities using historical outcomes

### H2. Regime Weights

**Current State:**
- Fixed weights: 40% odds, 50% speed, 10% bias
- Same weights for sprints and routes (though code allows differentiation)

**Enhancement Opportunities:**
- **Dynamic Weight Adjustment:** Adjust weights based on race characteristics (sprint vs route, field size, track surface)
- **Regime Detection:** Detect different "regimes" (e.g., chalky vs wide-open races) and adjust weights accordingly
- **Historical Performance by Regime:** Track which factors work best in which regimes, optimize weights dynamically

### H3. Calibration Feedback Loop

**Current State:**
- Calibration runs weekly, generates static reports
- Calibration adjusts confidence/T3M post-prediction, but doesn't update prediction logic
- No real-time feedback loop

**Enhancement Opportunities:**
- **Real-Time Calibration Updates:** Update `model_params.json` based on recent performance (last N races)
- **Adaptive Confidence Bands:** Adjust confidence bands dynamically based on recent accuracy
- **A/B Testing Framework:** Test different prediction strategies, automatically adopt best-performing ones
- **Feedback Integration:** Use verification results to retrain weights/composites in near real-time

### H4. Late-Signal Volatility

**Current State:**
- No time-to-post (MTP) tracking
- Predictions are stateless (same input = same output)
- No late-signal integration (odds changes, scratches, jockey changes)

**Enhancement Opportunities:**
- **MTP Integration:** Track minutes-to-post, adjust confidence based on timing (late signals may be more volatile)
- **Odds Movement Tracking:** Monitor odds changes between prediction and post time, adjust confidence accordingly
- **Scratch Handling:** Detect scratches, re-run predictions automatically
- **Late-Signal Weighting:** Increase weight on odds (market signal) as post time approaches

### H5. Additional Enhancements

**Multi-Model Ensemble:**
- Run multiple prediction models (odds-only, speed-only, composite), combine with weighted average
- Track individual model performance, adjust ensemble weights dynamically

**Contextual Features:**
- Track conditions (fast, good, muddy, yielding)
- Jockey/trainer recent form
- Class level changes
- Pace scenarios (front-running, stalking, closing)

**Uncertainty Quantification:**
- Provide confidence intervals for predictions (not just point estimates)
- Quantify model uncertainty vs outcome uncertainty
- Better communicate "don't know" scenarios

---

## Report Metadata

**Generated:** 2026-01-06 17:49:19 UTC  
**Git Branch:** `feat/paygate-server-enforcement`  
**Git Commit:** `ade8253fed1082f2573c29ec08cb326e555571d0`  
**Author:** FinishLine AI Team  
**Version:** 1.0  
**Status:** ✅ COMPLETED

**Next Steps:**
1. Review this report with ChatGPT for additive intelligence proposals
2. Implement probability layer enhancements
3. Add regime weight optimization
4. Build calibration feedback loop
5. Integrate late-signal volatility tracking

---

**END OF REPORT**

