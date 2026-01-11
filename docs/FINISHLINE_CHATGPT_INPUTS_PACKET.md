# FinishLine WPS AI - ChatGPT Inputs Packet

**Generated:** 2026-01-06 17:49:19 UTC  
**Git Branch:** `feat/paygate-server-enforcement`  
**Git Commit:** `ade8253fed1082f2573c29ec08cb326e555571d0`  
**Purpose:** Provide exact artifacts ChatGPT needs to implement additive intelligence upgrades safely

---

## A. Exact File Contents (Verbatim)

### A1. data/model_params.json

```json
{
  "reliability": [
    {
      "c": 0.64,
      "p": 0.5
    },
    {
      "c": 0.66,
      "p": 0.7777777777777778
    },
    {
      "c": 0.68,
      "p": 0.9655172413793104
    },
    {
      "c": 0.7,
      "p": 0.9655172413793104
    },
    {
      "c": 0.72,
      "p": 1
    }
  ],
  "temp_tau": 1,
  "policy": {
    "60-64": {
      "stats": {
        "across the board": {
          "n": 0,
          "avg_roi": -999
        },
        "exacta box": {
          "n": 0,
          "avg_roi": -999
        },
        "trifecta box": {
          "n": 0,
          "avg_roi": -999
        }
      },
      "recommended": "across the board"
    },
    "65-69": {
      "stats": {
        "across the board": {
          "n": 0,
          "avg_roi": -999
        },
        "exacta box": {
          "n": 0,
          "avg_roi": -999
        },
        "trifecta box": {
          "n": 0,
          "avg_roi": -999
        }
      },
      "recommended": "across the board"
    },
    "70-74": {
      "stats": {
        "across the board": {
          "n": 0,
          "avg_roi": -999
        },
        "exacta box": {
          "n": 0,
          "avg_roi": -999
        },
        "trifecta box": {
          "n": 0,
          "avg_roi": -999
        }
      },
      "recommended": "across the board"
    },
    "75-79": {
      "stats": {
        "across the board": {
          "n": 0,
          "avg_roi": -999
        },
        "exacta box": {
          "n": 0,
          "avg_roi": -999
        },
        "trifecta box": {
          "n": 0,
          "avg_roi": -999
        }
      },
      "recommended": "across the board"
    }
  }
}
```

**File Path:** `data/model_params.json`  
**Purpose:** Calibration post-processor configuration
- `reliability`: Array of `{c, p}` pairs for confidence calibration (piecewise linear interpolation)
- `temp_tau`: Temperature parameter for softmax normalization (default: 1.0)
- `policy`: Strategy recommendation overrides by confidence band (60-64, 65-69, 70-74, 75-79)

### A2. config/calibration_thresholds.json

```json
{
  "version": 1,
  "updatedAt": "2025-11-25T00:00:00.000Z",
  "strategyName": "v1_shadow_only",
  "notes": [
    "Read-only thresholds for shadow-mode decision logging.",
    "These DO NOT change prediction behavior; they are only used to log what the app *would* have decided.",
    "Safe to edit gradually once we trust the feedback loop."
  ],
  "win": {
    "minConfidence": 0.62,
    "maxFieldSize": 12
  },
  "place": {
    "minConfidence": 0.55,
    "maxFieldSize": 14
  },
  "show": {
    "minConfidence": 0.50,
    "maxFieldSize": 16
  },
  "global": {
    "minOddsFloor": 1.2,
    "maxOddsCeiling": 8.0,
    "enableLongshotFilter": true
  }
}
```

**File Path:** `config/calibration_thresholds.json`  
**Purpose:** Shadow-mode decision thresholds (read-only, does NOT affect predictions)
- Used by `lib/calibrationThresholds.js` to build `shadowDecision` object
- Thresholds define minimum confidence and maximum field size for Win/Place/Show recommendations
- Global settings: odds floor/ceiling, longshot filter

### A3. package.json scripts section

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "append:raw": "node scripts/csv-append.js",
    "append:rows": "node scripts/csv-append.js",
    "append:today": "node scripts/map-append-current.js && node scripts/merge-append-current.js",
    "append:ready": "node scripts/append-from-races.js",
    "append:redis": "node scripts/append-from-redis.js",
    "validate:dataset": "node scripts/validate-dataset.js",
    "data:validate": "npm run validate:dataset",
    "calibrate": "node scripts/calibrate.js",
    "calibrate:report": "node scripts/build-report.js",
    "build:report": "node scripts/build-report.js",
    "calibrate:all": "npm run validate:dataset && npm run calibrate && npm run calibrate:report",
    "backfill:persistence": "node scripts/backfill-persistence.js",
    "backfill:calibrate": "node scripts/redis-backfill-to-csv.js",
    "backfill:http": "node scripts/backfill_verify_http.js",
    "export:verify-redis": "node scripts/calibration/export_verify_redis_to_csv.mjs",
    "build:calibration-sample": "node scripts/calibration/build_calibration_sample_from_verify_csv.mjs",
    "calibrate:verify-v1": "node scripts/calibration/run_calibrate_verify_v1.mjs",
    "audit:server": "node scripts/fetch-audit.js",
    "sanitize:placeholders": "node scripts/sanitize-placeholders.js",
    "debug:verify": "node scripts/debug_verify_race.js",
    "debug:greenzone": "node scripts/debug/run_greenzone_smoke.mjs",
    "shadow:report": "node scripts/shadow_calibration_report.js"
  }
}
```

**File Path:** `package.json` (scripts section only)  
**Key Commands:**
- `npm run dev` - Start Next.js dev server
- `npm run export:verify-redis` - Export verify logs from Redis to CSV
- `npm run build:calibration-sample` - Build filtered calibration sample
- `npm run calibrate:verify-v1` - Run verify v1 calibration and generate reports

### A4. .github/workflows/nightly-calibration.yml

```yaml
# Nightly Calibration Workflow
#
# This workflow runs nightly to:
# 1. Export verify logs from Redis (fl:verify:* keys) to CSV
# 2. Build a filtered calibration sample (max 5000 rows, predictions-only)
# 3. Run verify-v1 calibration to compute metrics and generate reports
# 4. Commit the resulting artifacts back to master:
#    - data/finishline_tests_from_verify_redis_v1.csv (all verify logs)
#    - data/finishline_tests_calibration_v1.csv (filtered predictions-only sample)
#    - data/calibration/verify_v1_report.json (machine-readable metrics)
#    - data/calibration/verify_v1_report.md (human-readable summary)
#
# The workflow is scheduled to run weekly on Sunday at 08:15 UTC and can also be triggered manually.

name: nightly-calibration

on:
  schedule:
    # 08:15 UTC weekly on Sunday (02:15 AM CST / 03:15 AM CDT)
    - cron: "15 8 * * 0"
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: nightly-calibration
  cancel-in-progress: false

jobs:
  recalibrate:
    runs-on: ubuntu-latest
    environment: Preview
    env:
      UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
      UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Export verify logs from Redis
        run: npm run export:verify-redis

      - name: Build calibration sample
        run: npm run build:calibration-sample

      - name: Run verify v1 calibration
        run: npm run calibrate:verify-v1

      - name: Check for artifact changes
        id: check-changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          if git diff --quiet --exit-code \
            data/finishline_tests_from_verify_redis_v1.csv \
            data/finishline_tests_calibration_v1.csv \
            data/calibration/verify_v1_report.json \
            data/calibration/verify_v1_report.md; then
            echo "changed=false" >> $GITHUB_OUTPUT
            echo "No changes detected in calibration artifacts"
          else
            echo "changed=true" >> $GITHUB_OUTPUT
            echo "Changes detected in calibration artifacts"
          fi

      - name: Commit calibration artifacts
        if: steps.check-changes.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add \
            data/finishline_tests_from_verify_redis_v1.csv \
            data/finishline_tests_calibration_v1.csv \
            data/calibration/verify_v1_report.json \
            data/calibration/verify_v1_report.md
          git commit -m "ci: nightly calibration artifacts"
          git push origin HEAD:master
```

**File Path:** `.github/workflows/nightly-calibration.yml`  
**Schedule:** Weekly on Sunday at 08:15 UTC  
**Artifacts Committed:**
- `data/finishline_tests_from_verify_redis_v1.csv`
- `data/finishline_tests_calibration_v1.csv`
- `data/calibration/verify_v1_report.json`
- `data/calibration/verify_v1_report.md`

---

## B. Real Prediction JSON (Unmodified)

### B1. Request Body Used

```json
{
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
}
```

**Endpoint:** `POST http://localhost:3000/api/predict_wps`  
**Method:** Captured via PowerShell `Invoke-RestMethod`  
**Timestamp:** 2026-01-06 17:49:19 UTC (approximate)

### B2. Raw Response JSON (Unmodified)

```json
{
  "ok": true,
  "picks": [
    {
      "slot": "Win",
      "name": "Lightning Bolt",
      "odds": "5/2",
      "reasons": [
        "odds rank inv +0.50",
        "speedFig z +0.53",
        "dist adj",
        "surf adj",
        "post adj"
      ],
      "prob": 37
    },
    {
      "slot": "Place",
      "name": "Thunder Strike",
      "odds": "3/1",
      "reasons": [
        "odds rank inv +0.17",
        "speedFig z +1.31",
        "dist adj",
        "surf adj",
        "post adj"
      ],
      "prob": 14
    },
    {
      "slot": "Show",
      "name": "Silver Star",
      "odds": "7/2",
      "reasons": [
        "odds rank inv -0.17",
        "speedFig z -0.53",
        "dist adj",
        "surf adj",
        "post adj"
      ],
      "prob": 5
    }
  ],
  "confidence": 55,
  "ranking": [
    {
      "name": "Lightning Bolt",
      "post": 5,
      "odds": "5/2",
      "comp": 0.7525225731438892,
      "prob": 0.37476223762145866,
      "reasons": [
        "odds rank inv +0.50",
        "speedFig z +0.53",
        "dist adj",
        "surf adj",
        "post adj"
      ]
    },
    {
      "name": "Thunder Strike",
      "post": 3,
      "odds": "3/1",
      "comp": 0.7019730995263893,
      "prob": 0.3495881969752934,
      "reasons": [
        "odds rank inv +0.17",
        "speedFig z +1.31",
        "dist adj",
        "surf adj",
        "post adj"
      ]
    },
    {
      "name": "Silver Star",
      "post": 2,
      "odds": "7/2",
      "comp": 0.3848107601894443,
      "prob": 0.19163882479553995,
      "reasons": [
        "odds rank inv -0.17",
        "speedFig z -0.53",
        "dist adj",
        "surf adj",
        "post adj"
      ]
    },
    {
      "name": "Dark Moon",
      "post": 7,
      "odds": "4/1",
      "comp": 0.16869356714027745,
      "prob": 0.08401074060770787,
      "reasons": [
        "odds rank inv -0.50",
        "speedFig z -1.31",
        "dist adj",
        "surf adj",
        "post adj"
      ]
    }
  ],
  "tickets": {
    "trifecta": [
      {
        "text": "Lightning Bolt / Thunder Strike / Silver Star,Dark Moon",
        "confidence": 0.026975898009164622
      },
      {
        "text": "BOX Lightning Bolt,Thunder Strike,Silver Star",
        "confidence": 0.3437891877611585
      }
    ],
    "superfecta": [
      {
        "text": "Lightning Bolt / Thunder Strike / Silver Star,Dark Moon / Silver Star,Dark Moon",
        "confidence": 0.01
      },
      {
        "text": "Lightning Bolt / Lightning Bolt,Thunder Strike / Thunder Strike,Silver Star,Dark Moon / Silver Star,Dark Moon",
        "confidence": 0.01
      }
    ],
    "superHighFive": [
      {
        "text": "Lightning Bolt / Thunder Strike / Silver Star / Dark Moon / Dark Moon",
        "confidence": 0.01
      }
    ]
  },
  "strategy": {
    "recommended": "Across The Board",
    "rationale": [
      "Top-3 mass 92%",
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
      "confidence": 0.6438423673127304,
      "top3Mass": 0.915989259392292,
      "gap12": 0.02517404064616524,
      "gap23": 0.15794937217975347,
      "top": [
        {
          "name": "Lightning Bolt",
          "prob": 0.37476223762145866,
          "comp": 0.7525225731438892
        },
        {
          "name": "Thunder Strike",
          "prob": 0.3495881969752934,
          "comp": 0.7019730995263893
        },
        {
          "name": "Silver Star",
          "prob": 0.19163882479553995,
          "comp": 0.3848107601894443
        },
        {
          "name": "Dark Moon",
          "prob": 0.08401074060770787,
          "comp": 0.16869356714027745
        }
      ]
    },
    "band": "60-64",
    "policy_stats": {
      "across the board": {
        "n": 0,
        "avg_roi": -999
      },
      "exacta box": {
        "n": 0,
        "avg_roi": -999
      },
      "trifecta box": {
        "n": 0,
        "avg_roi": -999
      }
    }
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
  "top3_mass": 56,
  "shadowDecision": {
    "strategyName": "v1_shadow_only",
    "version": 1,
    "fieldSize": 4,
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
    "strategyName": "v1_shadow_only",
    "version": 1
  },
  "predmeta_debug": {
    "enabled": true,
    "mode": "pending",
    "key": "fl:predmeta:pending:1767744610796",
    "written": true,
    "error": null
  }
}
```

**Source:** Captured from running `npm run dev` and calling `POST /api/predict_wps`  
**Timestamp Fields:** `predmeta_debug.key` contains timestamp `1767744610796` (milliseconds since epoch)  
**Note:** This is a REAL, unmodified response from the production code running locally.

### B3. Prediction at Different Snapshots (MTP)

**Why Not Available:**
- FinishLine WPS AI does NOT currently track time-to-post (MTP) in predictions
- Predictions are stateless - same input always produces same output
- No late-signal volatility tracking (see Section D for MTP timestamp method)

**Potential Enhancement:**
- Add `meta.asOf` timestamp to prediction response (server-side generated)
- Store multiple snapshots in Redis using timestamp-based keys
- Select "best" snapshot at verification time (see Section D)

---

## C. Downstream Contract Safety

### C1. Minimal Keys Required by `public/js/finishline-picker-bootstrap.js`

**File:** `public/js/finishline-picker-bootstrap.js`  
**Lines:** 602-617, 650-661

**Required Fields:**

1. **`picks`** (array, required)
   - **Structure:** `[{slot: "Win"|"Place"|"Show", name: string, odds: string, reasons?: string[]}]`
   - **Usage:**
     ```javascript
     const picks = data?.picks || [];
     const winPick = picks.find(p => p.slot === 'Win') || picks[0];
     const placePick = picks.find(p => p.slot === 'Place') || picks[1];
     const showPick = picks.find(p => p.slot === 'Show') || picks[2];
     ```
   - **Critical:** Must have at least 3 elements, `slot` must match exactly "Win", "Place", "Show" (case-sensitive)

2. **`confidence`** (number, required)
   - **Format:** 0-100 integer (after calibration) or 0-1 float (raw)
   - **Usage:**
     ```javascript
     const confPct = typeof data.confidence === 'number' && data.confidence >= 0 
       ? Math.round(data.confidence * 100) 
       : 7;
     ```
   - **Critical:** Must be a number, will default to 7 if missing/invalid

3. **`tickets`** (object, optional but recommended)
   - **Usage:** Displayed in results panel
   - **Structure:** `{trifecta: [{text, confidence}], superfecta: [...], superHighFive: [...]}`

4. **`strategy`** (object, optional but recommended)
   - **Usage:** Displayed in results panel
   - **Structure:** `{recommended: string, rationale: string[], betTypesTable: [...]}`

**Safe to Add (Won't Break UI):**
- ✅ `meta.asOf` (ISO timestamp)
- ✅ `meta.raceId` (derived string)
- ✅ Any new fields in `meta` object
- ✅ Any new fields at root level (UI only reads specific keys)

### C2. Minimal Keys Required by `pages/api/verify_race.js`

**File:** `pages/api/verify_race.js`  
**Lines:** 69-366, 335, 353-365

**Required Fields:**

1. **`predicted`** (object, required for hit calculation)
   - **Structure:** `{win: string, place: string, show: string}`
   - **Source:** Extracted from predmeta keys (`fl:predmeta:*`) or request body
   - **Usage:**
     ```javascript
     const predicted = result.predicted || { win: "", place: "", show: "" };
     // Normalized to trimmed strings
     const win = typeof predicted.win === "string" ? predicted.win.trim() : "";
     ```
   - **Critical:** Horse names must match exactly (case-insensitive after normalization)

2. **`confidence_pct`** (number, optional but recommended)
   - **Format:** 0-100 integer
   - **Source:** Extracted from predmeta keys, embedded in verify log
   - **Usage:**
     ```javascript
     if (typeof predmeta.confidence_pct === 'number') {
       logPayload.confidence_pct = predmeta.confidence_pct;
     }
     ```

3. **`t3m_pct`** (number, optional but recommended)
   - **Format:** 0-100 integer
   - **Source:** Extracted from predmeta keys, embedded in verify log
   - **Usage:**
     ```javascript
     if (typeof predmeta.t3m_pct === 'number') {
       logPayload.t3m_pct = predmeta.t3m_pct;
     }
     ```

4. **`top3_list`** (array, optional but recommended)
   - **Format:** Array of horse name strings
   - **Source:** Extracted from predmeta keys, embedded in verify log
   - **Usage:**
     ```javascript
     if (Array.isArray(predmeta.top3_list) && predmeta.top3_list.length > 0) {
       logPayload.top3_list = predmeta.top3_list;
     }
     ```

**Safe to Add (Won't Break Verification):**
- ✅ `meta.asOf` (timestamp) - Can be stored in predmeta, won't affect hit calculation
- ✅ `meta.raceId` (derived string) - Can be used for snapshot key lookup
- ✅ Any new fields in `meta` object - Verify only reads specific predmeta fields

### C3. Minimal Keys Required by `scripts/calibration/export_verify_redis_to_csv.mjs`

**File:** `scripts/calibration/export_verify_redis_to_csv.mjs`  
**Lines:** 68-116

**Required Fields (from verify logs, not prediction JSON directly):**

1. **`predicted`** (object, required)
   - **Structure:** `{win: string, place: string, show: string}`
   - **Source:** From verify log (`verifyLog.predicted`)
   - **Usage:**
     ```javascript
     const predicted = verifyLog.predicted || {};
     const predWin = csvEscape(predicted.win || "");
     const predPlace = csvEscape(predicted.place || "");
     const predShow = csvEscape(predicted.show || "");
     ```

2. **`confidence_pct`** (number, optional but recommended)
   - **Format:** 0-100 integer
   - **Source:** From verify log (`verifyLog.confidence_pct`)
   - **Usage:**
     ```javascript
     const confidencePct = verifyLog.confidence_pct;
     const confidencePctStr = typeof confidencePct === 'number' && Number.isFinite(confidencePct)
       ? csvEscape(String(Math.round(confidencePct)))
       : "";
     ```

3. **`t3m_pct`** (number, optional but recommended)
   - **Format:** 0-100 integer
   - **Source:** From verify log (`verifyLog.t3m_pct`)
   - **Usage:**
     ```javascript
     const t3mPct = verifyLog.t3m_pct;
     const t3mPctStr = typeof t3mPct === 'number' && Number.isFinite(t3mPct)
       ? csvEscape(String(Math.round(t3mPct)))
       : "";
     ```

4. **`top3_list`** (array, optional but recommended)
   - **Format:** Array of horse name strings
   - **Source:** From verify log (`verifyLog.top3_list`)
   - **Usage:**
     ```javascript
     const top3List = verifyLog.top3_list;
     const top3ListStr = Array.isArray(top3List) && top3List.length > 0
       ? csvEscape(JSON.stringify(top3List))
       : "";
     ```

**Note:** Calibration script reads from verify logs (which embed predmeta), NOT directly from prediction JSON.

**Safe to Add (Won't Break Calibration):**
- ✅ `meta.asOf` - Can be stored in predmeta, won't affect CSV export
- ✅ `meta.raceId` - Can be used for snapshot key lookup, won't affect CSV export
- ✅ Any new fields in `meta` object - Calibration only reads specific verify log fields

### C4. Summary: Minimal Stable Keys

**MUST Remain Stable (Breaking Changes):**

1. **`picks`** (array)
   - **Required by:** UI (`finishline-picker-bootstrap.js`)
   - **Structure:** `[{slot: "Win"|"Place"|"Show", name: string, odds: string}]`
   - **Critical:** Must have at least 3 elements, `slot` values must match exactly

2. **`confidence`** (number)
   - **Required by:** UI (`finishline-picker-bootstrap.js`)
   - **Format:** 0-100 integer (after calibration) or 0-1 float (raw)
   - **Critical:** Must be a number

3. **`predicted`** (object in verify logs)
   - **Required by:** `verify_race.js`, `export_verify_redis_to_csv.mjs`
   - **Structure:** `{win: string, place: string, show: string}`
   - **Critical:** Horse names must be strings (trimmed, case-insensitive matching)

4. **`confidence_pct`** (number in predmeta/verify logs)
   - **Required by:** `verify_race.js`, `export_verify_redis_to_csv.mjs`
   - **Format:** 0-100 integer
   - **Critical:** Must be a number if present

5. **`t3m_pct`** (number in predmeta/verify logs)
   - **Required by:** `verify_race.js`, `export_verify_redis_to_csv.mjs`
   - **Format:** 0-100 integer
   - **Critical:** Must be a number if present

6. **`top3_list`** (array in predmeta/verify logs)
   - **Required by:** `verify_race.js`, `export_verify_redis_to_csv.mjs`
   - **Format:** Array of horse name strings
   - **Critical:** Must be an array if present

**Safe to Add (Non-Breaking):**
- ✅ `meta.asOf` (ISO timestamp)
- ✅ `meta.raceId` (derived string)
- ✅ Any new fields in `meta` object
- ✅ Any new fields at root level (as long as required fields remain)

---

## D. "MTP via Timestamp Method" Feasibility (NO User Input)

### D1. Overview

**Goal:** Track prediction snapshots over time without requiring users to provide MTP (minutes to post).

**Method:** Use server-side timestamps to create "snapshot timing" - each prediction request generates a timestamp that can be used to select the "best" snapshot at verification time.

**Key Insight:** We don't need explicit MTP from users. We can:
1. Generate `meta.asOf` timestamp server-side when prediction is created
2. Store multiple snapshots in Redis using timestamp-based keys
3. At verification time, select the "best" snapshot (latest before verification, or latest within N minutes of post)

### D2. Where to Attach Timestamps in `/api/predict_wps`

**File:** `pages/api/predict_wps.js`  
**Location:** After prediction computation, before response (around line 816)

**Current Code (lines 816-825):**
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

**Proposed Addition (NON-BREAKING):**
```javascript
// Generate server-side timestamp
const asOf = new Date().toISOString();

  // Derive raceId from track/date/raceNo if available (same format as predmeta keys)
  const raceId = (() => {
    const date = body.date || body.dateIso || null;
    const raceNo = body.raceNo || body.race || null;
    const track = body.track || null;
    
    if (!date || !raceNo || !track) return null;
    
    // Normalize track (same logic as predmeta write in predict_wps.js lines 615-625)
    const normalizeTrack = (t) => {
      if (!t) return "";
      return String(t)
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");
    };
    
    const normalizeDate = (d) => {
      if (!d) return "";
      const str = String(d).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      try {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().slice(0, 10);
        }
      } catch {}
      return "";
    };
    
    const normTrack = normalizeTrack(track);
    const normDate = normalizeDate(date);
    const normRaceNo = String(raceNo).trim();
    
    // Use same format as predmeta permanent keys: {date}|{normTrack}|{raceNo}
    if (normTrack && normDate && normRaceNo) {
      return `${normDate}|${normTrack}|${normRaceNo}`;
    }
    return null;
  })();

return res.status(200).json({
  ok: true,
  ...calibratedResponse,
  meta: {
    ...calibratedResponse.meta,
    asOf,        // NEW: Server-side timestamp
    raceId,      // NEW: Derived race identifier (null if date/raceNo missing)
  },
  shadowDecision,
  calibrationThresholds: {
    strategyName: thresholds.strategyName,
    version: thresholds.version,
  },
  predmeta_debug: predmetaDebug,
});
```

**Safety:**
- ✅ Non-breaking: New fields in `meta` object (UI doesn't read them)
- ✅ Backward compatible: `raceId` is `null` if date/raceNo missing (same as current behavior)
- ✅ No UI changes required

### D3. Redis Snapshot Storage

**Key Format:**
```
fl:predsnap:{raceId}:{asOf}
```

**Example Keys:**
```
fl:predsnap:2026-01-06|gulfstream park|5:2026-01-06T17:49:19.123Z
fl:predsnap:2026-01-06|gulfstream park|5:2026-01-06T17:52:30.456Z
fl:predsnap:2026-01-06|gulfstream park|5:2026-01-06T17:55:45.789Z
```

**Note:** Track normalization keeps spaces (e.g., "gulfstream park" not "gulfstreampark"), matching predmeta key format.

**Storage Logic (in `pages/api/predict_wps.js`):**

```javascript
// After predmeta write (around line 804)
// TEMP: Store prediction snapshot if raceId available
if (raceId && asOf) {
  (async () => {
    try {
      const { setex } = await import('../../lib/redis.js');
      const snapshotKey = `fl:predsnap:${raceId}:${asOf}`;
      const snapshotPayload = {
        ...calibratedResponse,
        asOf,
        raceId,
        timestamp: Date.now(),
      };
      // Store snapshot for 7 days (604800 seconds)
      await setex(snapshotKey, 604800, JSON.stringify(snapshotPayload));
    } catch (err) {
      // Non-fatal: log but don't block response
      console.warn('[predsnap] write failed', err?.message);
    }
  })();
}
```

**TTL:** 7 days (604800 seconds) - enough to capture multiple snapshots before verification

**Storage Pattern:**
- One snapshot per prediction request
- Multiple snapshots per race (if user requests predictions multiple times)
- Timestamp in key allows chronological sorting

### D4. Snapshot Selection at Verification Time

**File:** `pages/api/verify_race.js`  
**Location:** After predmeta lookup (around line 115)

**Current Code (lines 69-115):**
```javascript
// Try to fetch prediction metadata (confidence/T3M) if available
let predmeta = null;
try {
  // ... existing predmeta lookup logic ...
} catch (err) {
  // ... error handling ...
}
```

**Proposed Addition (NON-BREAKING):**

```javascript
// TEMP: Try to fetch best snapshot if raceId available
let bestSnapshot = null;
if (raceId) {
  try {
    const { keys: redisKeys, get: redisGet } = await import('../../lib/redis.js');
    
    // Find all snapshots for this race
    const snapshotPattern = `fl:predsnap:${raceId}:*`;
    const snapshotKeys = await redisKeys(snapshotPattern);
    
    if (snapshotKeys.length > 0) {
      // Parse timestamps from keys: fl:predsnap:{raceId}:{asOf}
      const snapshots = [];
      for (const key of snapshotKeys) {
        const match = key.match(/fl:predsnap:[^:]+:(.+)$/);
        if (match) {
          const asOf = match[1];
          const rawValue = await redisGet(key);
          if (rawValue) {
            try {
              const snapshot = JSON.parse(rawValue);
              snapshots.push({
                key,
                asOf: new Date(asOf),
                data: snapshot,
              });
            } catch {}
          }
        }
      }
      
      // Sort by timestamp (newest first)
      snapshots.sort((a, b) => b.asOf.getTime() - a.asOf.getTime());
      
      // Select best snapshot:
      // 1. If post time exists: latest snapshot within 30 minutes of post
      // 2. Otherwise: latest snapshot before verification time
      const verifyTime = new Date();
      const postTime = result.postTime ? new Date(result.postTime) : null;
      
      if (postTime && !isNaN(postTime.getTime())) {
        // Find latest snapshot within 30 minutes of post time
        const postTimeMs = postTime.getTime();
        const thirtyMinutesMs = 30 * 60 * 1000;
        
        bestSnapshot = snapshots.find(s => {
          const snapshotTimeMs = s.asOf.getTime();
          const timeDiff = Math.abs(snapshotTimeMs - postTimeMs);
          return timeDiff <= thirtyMinutesMs && snapshotTimeMs <= postTimeMs;
        });
        
        // Fallback: latest snapshot before post time
        if (!bestSnapshot) {
          bestSnapshot = snapshots.find(s => s.asOf.getTime() <= postTimeMs);
        }
      }
      
      // Fallback: latest snapshot before verification time
      if (!bestSnapshot) {
        bestSnapshot = snapshots.find(s => s.asOf.getTime() <= verifyTime.getTime());
      }
      
      // Final fallback: latest snapshot overall
      if (!bestSnapshot && snapshots.length > 0) {
        bestSnapshot = snapshots[0];
      }
    }
  } catch (err) {
    // Non-fatal: log but don't block verification
    console.warn('[predsnap] lookup failed', err?.message);
  }
}

// Use best snapshot if available, otherwise use existing predmeta
if (bestSnapshot) {
  // Extract predmeta fields from snapshot
  const snapshot = bestSnapshot.data;
  predmeta = {
    confidence_pct: snapshot.confidence || null,
    t3m_pct: snapshot.top3_mass || null,
    top3_list: snapshot.ranking?.slice(0, 3).map(r => r.name) || null,
    predicted_win: snapshot.picks?.[0]?.name || null,
    predicted_place: snapshot.picks?.[1]?.name || null,
    predicted_show: snapshot.picks?.[2]?.name || null,
    asOf: bestSnapshot.asOf.toISOString(),  // NEW: Snapshot timestamp
  };
}
```

**Selection Logic:**
1. **If post time exists:** Latest snapshot within 30 minutes of post time (prefer snapshots close to post)
2. **Otherwise:** Latest snapshot before verification time (prefer most recent before verification)
3. **Final fallback:** Latest snapshot overall (if no time constraints)

**Safety:**
- ✅ Non-breaking: Only used if `raceId` available (same condition as predmeta)
- ✅ Fail-open: If snapshot lookup fails, falls back to existing predmeta lookup
- ✅ No UI changes required

### D5. Zero UI Changes Required

**Confirmation:**

1. **No New User Fields:**
   - ✅ `meta.asOf` is generated server-side (no user input)
   - ✅ `meta.raceId` is derived from existing fields (track/date/raceNo)
   - ✅ Users don't need to provide MTP

2. **No UI Changes:**
   - ✅ `asOf` and `raceId` are in `meta` object (UI doesn't read `meta` fields)
   - ✅ Snapshot selection happens server-side in `verify_race.js`
   - ✅ UI continues to work with existing `picks`, `confidence`, `strategy` fields

3. **Backward Compatible:**
   - ✅ If `raceId` is `null` (date/raceNo missing), snapshot lookup is skipped
   - ✅ Falls back to existing predmeta lookup (no breaking changes)
   - ✅ Existing predictions without snapshots continue to work

### D6. Implementation Summary

**Changes Required:**

1. **`pages/api/predict_wps.js`:**
   - Add `meta.asOf` timestamp generation (server-side)
   - Add `meta.raceId` derivation (from track/date/raceNo)
   - Add snapshot write to Redis (if `raceId` available)

2. **`pages/api/verify_race.js`:**
   - Add snapshot lookup logic (if `raceId` available)
   - Add snapshot selection logic (latest within 30min of post, or latest before verify)
   - Use snapshot predmeta if available, otherwise fall back to existing predmeta

3. **Redis Key Pattern:**
   - `fl:predsnap:{raceId}:{asOf}` (ISO timestamp in key)
   - TTL: 7 days (604800 seconds)

**No Changes Required:**
- ❌ UI code (`public/js/finishline-picker-bootstrap.js`)
- ❌ Calibration scripts (read from verify logs, not snapshots)
- ❌ User input forms (no new fields)

---

## E. Output Instructions

### E1. Commands Run

**1. Started Dev Server:**
```bash
npm run dev
```
**Status:** Running in background on `http://localhost:3000`

**2. Captured Real Prediction:**
```powershell
# Created temp_prediction_request.json with request body
# Created temp_capture_prediction_v2.ps1 script
powershell -ExecutionPolicy Bypass -File temp_capture_prediction_v2.ps1
```
**Result:** Saved to `temp_prediction_response.json`

### E2. Curl Command (Equivalent)

**Request Body File:** `temp_prediction_request.json`

**PowerShell Command Used:**
```powershell
$body = Get-Content temp_prediction_request.json -Raw
$response = Invoke-RestMethod -Uri 'http://localhost:3000/api/predict_wps' -Method POST -ContentType 'application/json' -Body $body
$response | ConvertTo-Json -Depth 10 | Out-File -FilePath 'temp_prediction_response.json' -Encoding utf8
```

**Equivalent curl Command:**
```bash
curl -X POST http://localhost:3000/api/predict_wps \
  -H "Content-Type: application/json" \
  -d @temp_prediction_request.json \
  -o temp_prediction_response.json
```

**Request Body:**
```json
{
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
}
```

### E3. Generated Packet File

**Path:** `docs/FINISHLINE_CHATGPT_INPUTS_PACKET.md`

**Contents:**
- Section A: Exact file contents (model_params.json, calibration_thresholds.json, package.json scripts, nightly-calibration.yml)
- Section B: Real prediction JSON (unmodified, captured from running API)
- Section C: Downstream contract safety (minimal stable keys)
- Section D: MTP via timestamp method feasibility (zero UI changes)
- Section E: Output instructions (commands run, curl equivalent, file path)

**Temporary Files Created (Remove After Use):**
- `temp_prediction_request.json` - Request body used for API call
- `temp_prediction_response.json` - Real API response (captured)
- `temp_capture_prediction_v2.ps1` - PowerShell script used to capture response
- `temp_capture_prediction.ps1` - Initial attempt (can be removed)

---

## F. Additional Notes

### F1. Timestamp Format

**`meta.asOf`:**
- Format: ISO 8601 string (e.g., `"2026-01-06T17:49:19.123Z"`)
- Generated: Server-side using `new Date().toISOString()`
- Purpose: Identify when prediction was generated (for snapshot selection)

**`meta.raceId`:**
- Format: `"{date}|{normalizedTrack}|{raceNo}"` (e.g., `"2026-01-06|gulfstream park|5"`)
- Derived: From `track`, `date`/`dateIso`, `raceNo`/`race` fields in request body
- Normalization: Same logic as predmeta permanent key generation in `predict_wps.js` (lines 615-625)
  - Track: lowercase, trim, collapse spaces, remove non-alphanumeric (keeps spaces)
  - Date: YYYY-MM-DD format (ISO date string)
  - RaceNo: trimmed string
- Null: If any of track/date/raceNo missing
- **Note:** This matches the `joinKey` format used for permanent predmeta keys: `fl:predmeta:{date}|{normTrack}|{raceNo}`

### F2. Snapshot Key Format Details

**Pattern:** `fl:predsnap:{raceId}:{asOf}`

**Components:**
- `fl:predsnap:` - Prefix (consistent with other FinishLine keys)
- `{raceId}` - Race identifier (`{date}|{normalizedTrack}|{raceNo}`)
- `{asOf}` - ISO timestamp (e.g., `2026-01-06T17:49:19.123Z`)

**Example:**
```
fl:predsnap:2026-01-06|gulfstream park|5:2026-01-06T17:49:19.123Z
```

**Note:** Track normalization keeps spaces (matches predmeta key format).

**Sorting:**
- Keys can be sorted chronologically by parsing `asOf` from key name
- Latest snapshot = highest timestamp in key name

### F3. Snapshot Selection Logic

**Priority Order:**
1. **Latest snapshot within 30 minutes of post time** (if post time exists)
   - Rationale: Predictions close to post time are most relevant
   - Window: ±30 minutes from post time
   - Prefer: Snapshots before post time (not after)

2. **Latest snapshot before post time** (if post time exists, but no snapshot within 30min)
   - Rationale: Use most recent prediction before race starts

3. **Latest snapshot before verification time** (if no post time)
   - Rationale: Use most recent prediction before verification

4. **Latest snapshot overall** (final fallback)
   - Rationale: Use most recent snapshot if no time constraints

**Implementation Notes:**
- All timestamp comparisons use milliseconds since epoch
- 30-minute window: `30 * 60 * 1000 = 1,800,000` milliseconds
- Snapshot selection is non-blocking (fail-open if lookup fails)

---

## Report Metadata

**Generated:** 2026-01-06 17:49:19 UTC  
**Git Branch:** `feat/paygate-server-enforcement`  
**Git Commit:** `ade8253fed1082f2573c29ec08cb326e555571d0`  
**Author:** FinishLine AI Team  
**Version:** 1.0  
**Status:** ✅ COMPLETED

**Next Steps:**
1. Review this packet with ChatGPT for additive intelligence proposals
2. Implement MTP timestamp method (if approved)
3. Test snapshot storage and selection logic
4. Verify backward compatibility with existing predictions

---

**END OF PACKET**

