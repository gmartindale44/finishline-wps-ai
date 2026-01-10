# Calibration Diagnostics: PayGate Logging Volume & Predmeta Flow

**Generated:** 2026-01-04  
**Purpose:** Analyze PayGate impact on logging volume and document predmeta write/read flow

---

## Summary

### PayGate Impact on Logging Volume

**Yes, PayGate could reduce logging volume by blocking predict/verify endpoints**, but there are important caveats:

1. **✅ Protected Endpoints (Would Reduce Logging):**
   - `/api/predict_wps` - **Protected** ✅
     - Writes: `fl:predmeta:*` keys
     - Blocks: Predmeta writes (permanent + pending keys)
   - `/api/verify_race` - **Protected** ✅
     - Writes: `fl:verify:*` keys (with predmeta embedded)
     - Blocks: Verify log writes (primary calibration data source)

2. **❌ Unprotected Endpoint (Would NOT Reduce Logging):**
   - `/api/log_prediction` - **NOT Protected** ❌
     - Writes: `fl:pred:*` keys (Redis hashes)
     - Status: No PayGate check, always accessible
     - Impact: Prediction logs continue even if PayGate blocks predict_wps

**Current PayGate Status:**
- Default mode: **Monitor mode** (`PAYGATE_SERVER_ENFORCE=0` or unset)
- Monitor mode: Logs access but **allows all requests** (no blocking)
- Enforcement mode: Blocks requests without valid cookie (403 Forbidden)
- Fail-open: If PayGate check throws error, request is allowed (safety feature)

**Logging Volume Reduction Potential:**
- If PayGate enforcement enabled and blocks requests:
  - ✅ **Would reduce:** `fl:predmeta:*` writes (from predict_wps)
  - ✅ **Would reduce:** `fl:verify:*` writes (from verify_race) - **Primary calibration data source**
  - ❌ **Would NOT reduce:** `fl:pred:*` writes (from log_prediction, not gated)
- **Current reality:** PayGate in monitor mode, so no logging reduction yet

### Predmeta Write Locations & Fields

**Write Location:** `pages/api/predict_wps.js` (function `safeWritePredmeta`)

**Redis Keys Written:**

1. **Permanent Key (when date + raceNo available):**
   - Pattern: `fl:predmeta:${date}|${normTrack}|${raceNo}`
   - Example: `fl:predmeta:2025-12-28|gulfstreampark|5`
   - TTL: 45 days (3,888,000 seconds)
   - Mode: `permanent`

2. **Pending Key (when date/raceNo missing):**
   - Pattern: `fl:predmeta:pending:${timestamp}`
   - Example: `fl:predmeta:pending:1704288823000`
   - TTL: 2 hours (7,200 seconds)
   - Mode: `pending`
   - **Note:** Pending keys are reconciled by `verify_race.js` when verify runs

3. **Debug Key (always written):**
   - Key: `fl:predmeta:last_write`
   - TTL: 6 hours (21,600 seconds)
   - Purpose: Debugging/verification of predmeta writes

**Fields Written to Predmeta Keys:**

```javascript
{
  track: string,              // Normalized track name
  confidence_pct: number,     // Confidence percentage (0-100)
  t3m_pct: number,           // Top 3 Mass percentage (0-100)
  top3_list: array,          // Array of top 3 horse names
  predicted_win: string,     // Predicted win horse name
  predicted_place: string,   // Predicted place horse name
  predicted_show: string,    // Predicted show horse name
  created_at: string,        // ISO timestamp string
  created_at_ms: number,     // Unix timestamp (milliseconds)
  date: string | null,       // Race date (YYYY-MM-DD) or null
  raceNo: string | null      // Race number or null
}
```

**Write Conditions:**
- Requires: `FINISHLINE_PERSISTENCE_ENABLED=true` (env var)
- Requires: Redis env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)
- Requires: `confidence_pct` must be finite (validation check)
- Key format depends on availability of `date` and `raceNo` in payload

**Key Format Details:**
- Join key format: `${date}|${normTrack}|${raceNo}`
- Track normalization: Lowercase, trim, collapse spaces, remove non-alphanumeric (except spaces)
- Date format: YYYY-MM-DD (ISO format)
- Race number: String representation

### Calibration Scripts: Predmeta Read Behavior

**Key Finding: Calibration scripts do NOT read predmeta keys directly. They read predmeta from verify logs.**

#### Script 1: `scripts/calibration/export_verify_redis_to_csv.mjs`

**What it reads:**
- ✅ `fl:verify:*` keys only
- ❌ Does NOT read `fl:predmeta:*` keys
- ❌ Does NOT read `fl:pred:*` keys

**How predmeta is obtained:**
- Predmeta fields are **embedded in verify logs** by `verify_race.js`
- When `verify_race.js` logs a verify result, it:
  1. Reads predmeta from `fl:predmeta:*` keys (permanent or pending reconciliation)
  2. Attaches predmeta fields to verify log payload:
     - `confidence_pct`
     - `t3m_pct` (or `top3_mass_pct` as fallback)
     - `top3_list`
  3. Writes verify log to `fl:verify:*` key with predmeta embedded
- Calibration script reads verify logs and extracts predmeta fields from the embedded data

**CSV Schema:**
```csv
track,date,raceNo,strategyName,version,predWin,predPlace,predShow,outWin,outPlace,outShow,winHit,placeHit,showHit,top3Hit,confidence_pct,t3m_pct,top3_list
```

**Predmeta extraction (lines 98-115):**
```javascript
// Extract predmeta fields (if present, added by verify_race.js)
const confidencePct = verifyLog.confidence_pct;
const t3mPct = verifyLog.t3m_pct;
const top3List = verifyLog.top3_list;
```

#### Script 2: `scripts/rebuild_calibration_from_logs.mjs`

**What it reads:**
- ✅ `fl:pred:*` keys (prediction logs)
- ✅ `fl:verify:*` keys (verify logs)
- ❌ Does NOT read `fl:predmeta:*` keys directly

**Purpose:**
- Rebuilds calibration CSV by joining prediction logs + verify logs
- Reads prediction logs from `fl:pred:*` (hashes)
- Reads verify logs from `fl:verify:*` (JSON strings)
- Joins on (track, date, raceNo)

**Predmeta handling:**
- Gets predmeta from verify logs (which have predmeta embedded by verify_race.js)
- Same flow as export script: predmeta is embedded in verify logs, not read from predmeta keys

---

## Detailed Analysis

### PayGate Protection Matrix

| Endpoint | PayGate Protected | Writes to Redis | Impact if Blocked |
|----------|-------------------|-----------------|-------------------|
| `/api/predict_wps` | ✅ Yes | `fl:predmeta:*` | Reduces predmeta writes |
| `/api/verify_race` | ✅ Yes | `fl:verify:*` | **Reduces verify logs (primary calibration data)** |
| `/api/log_prediction` | ❌ No | `fl:pred:*` | Continues logging (not gated) |

**PayGate Configuration:**
- Protected routes defined in: `lib/paygate-server.js` (function `isPremiumApiRoute`)
- Protection pattern: `checkPayGateAccess(req)` at start of handler
- Default behavior: Monitor mode (logs but allows all requests)
- Enforcement: Requires `PAYGATE_SERVER_ENFORCE=1` env var

### Predmeta Data Flow

```
┌─────────────────┐
│  predict_wps.js │
│  (gated)        │
└────────┬────────┘
         │
         │ Writes predmeta
         ▼
┌─────────────────────────┐
│ fl:predmeta:${joinKey}  │  (permanent, 45 days)
│ fl:predmeta:pending:*   │  (temporary, 2 hours)
└─────────────────────────┘
         │
         │ verify_race.js reads predmeta
         │ (permanent key lookup + pending reconciliation)
         ▼
┌─────────────────┐
│ verify_race.js  │
│  (gated)        │
└────────┬────────┘
         │
         │ Embeds predmeta in verify log
         │ Writes verify log
         ▼
┌─────────────────────────┐
│ fl:verify:*             │  (90 days TTL)
│ {                       │
│   ...verify data...,    │
│   confidence_pct: 84,   │  ← Predmeta embedded here
│   t3m_pct: 54,          │
│   top3_list: [...]      │
│ }                       │
└─────────────────────────┘
         │
         │ Calibration scripts read
         ▼
┌──────────────────────────────┐
│ export_verify_redis_to_csv   │
│ rebuild_calibration_from_logs│
│                               │
│ Reads: fl:verify:* only      │
│ Extracts predmeta from       │
│ embedded fields in verify log│
└──────────────────────────────┘
```

**Key Insight:** Predmeta keys (`fl:predmeta:*`) are **intermediate storage**. The calibration pipeline consumes predmeta through verify logs, not directly from predmeta keys.

### PayGate Logging Reduction Analysis

**If PayGate enforcement enabled (PAYGATE_SERVER_ENFORCE=1):**

**Scenario 1: User without valid cookie (blocked)**
- `/api/predict_wps` → 403 Forbidden → **No predmeta write**
- `/api/verify_race` → 403 Forbidden → **No verify log write**
- `/api/log_prediction` → 200 OK → **Prediction log still written** (not gated)

**Scenario 2: User with valid cookie (allowed)**
- All endpoints → 200 OK → **All logging proceeds normally**

**Logging Volume Impact:**

| Redis Key Pattern | Source Endpoint | Gated? | Impact if Blocked |
|-------------------|-----------------|--------|-------------------|
| `fl:predmeta:*` | `/api/predict_wps` | ✅ Yes | ✅ Reduced |
| `fl:verify:*` | `/api/verify_race` | ✅ Yes | ✅ **Reduced (primary calibration data)** |
| `fl:pred:*` | `/api/log_prediction` | ❌ No | ❌ Not reduced |

**Calibration Impact:**
- **High impact:** Blocking `/api/verify_race` reduces `fl:verify:*` writes, which are the primary data source for calibration scripts
- **Medium impact:** Blocking `/api/predict_wps` reduces predmeta writes, but predmeta is also embedded in verify logs (so blocking verify_race already blocks predmeta from reaching calibration)
- **Low impact:** `/api/log_prediction` not gated, so prediction logs continue (but these are not used by current calibration pipeline which uses verify logs)

**Current State:**
- PayGate in monitor mode (default)
- All requests allowed regardless of cookie
- Logging volume not currently reduced by PayGate

### Predmeta Write Locations - Code References

**File:** `pages/api/predict_wps.js`

**Function:** `safeWritePredmeta` (lines 593-674)

**Key write logic:**
```javascript
// Permanent key (if date + raceNo available)
if (date && raceNo) {
  const joinKey = `${date}|${normTrack}|${raceNo}`;
  targetKey = `fl:predmeta:${joinKey}`;
  mode = 'permanent';
  ttl = 3888000; // 45 days
} else {
  // Pending key (if date/raceNo missing)
  targetKey = `fl:predmeta:pending:${timestamp}`;
  mode = 'pending';
  ttl = 7200; // 2 hours
}

// Write predmeta key
await setex(targetKey, ttl, JSON.stringify(payload));
```

**Fields extracted for predmeta payload:**
```javascript
const predmetaPayload = {
  track: normTrack,
  confidence_pct: confidencePct,      // From calibratedResponse.confidence
  t3m_pct: t3mPct,                    // From strategy.metrics.top3Mass * 100
  predicted_win: predictedWin,
  predicted_place: predictedPlace,
  predicted_show: predictedShow,
  top3_list: top3List,                // From calibratedResponse.ranking.slice(0,3)
  created_at,
  created_at_ms: timestamp,
  date: date || null,
  raceNo: raceNo || null
};
```

### Calibration Scripts - Data Source Confirmation

**Script:** `scripts/calibration/export_verify_redis_to_csv.mjs`

**Redis key prefix (line 33):**
```javascript
const VERIFY_PREFIX = "fl:verify:";
```

**Scan operation:**
- Scans all keys matching `fl:verify:*`
- Does NOT scan `fl:predmeta:*`
- Does NOT scan `fl:pred:*`

**Predmeta extraction (lines 98-115):**
- Reads `confidence_pct`, `t3m_pct`, `top3_list` from verify log object
- These fields are embedded in verify logs by `verify_race.js`
- Verify logs are stored as JSON strings (not hashes)

**Script:** `scripts/rebuild_calibration_from_logs.mjs`

**Redis key prefixes (lines 37-38):**
```javascript
const PRED_PREFIX = "fl:pred:";
const VERIFY_PREFIX = "fl:verify:";
```

**Scan operations:**
- Scans `fl:pred:*` keys (prediction logs)
- Scans `fl:verify:*` keys (verify logs)
- Does NOT scan `fl:predmeta:*`

**Predmeta handling:**
- Gets predmeta from verify logs (embedded by verify_race.js)
- Same extraction pattern as export script

---

## Conclusions

### PayGate Logging Reduction

1. **PayGate CAN reduce logging volume** by blocking `/api/predict_wps` and `/api/verify_race`
2. **Primary impact:** Blocking `/api/verify_race` reduces `fl:verify:*` writes (primary calibration data source)
3. **Secondary impact:** Blocking `/api/predict_wps` reduces `fl:predmeta:*` writes, but predmeta also flows through verify logs
4. **Current state:** PayGate in monitor mode, so no blocking occurs (all requests allowed)
5. **Gap:** `/api/log_prediction` not gated, so `fl:pred:*` logs continue regardless of PayGate status

### Predmeta Write Locations

1. **Primary write location:** `pages/api/predict_wps.js` (function `safeWritePredmeta`)
2. **Key patterns:**
   - Permanent: `fl:predmeta:${date}|${normTrack}|${raceNo}` (45 days TTL)
   - Pending: `fl:predmeta:pending:${timestamp}` (2 hours TTL)
   - Debug: `fl:predmeta:last_write` (6 hours TTL)
3. **Fields written:** confidence_pct, t3m_pct, top3_list, predicted_win/place/show, track, date, raceNo, timestamps
4. **Write conditions:** Requires `FINISHLINE_PERSISTENCE_ENABLED=true` and Redis env vars

### Calibration Scripts Read Behavior

1. **Calibration scripts do NOT read predmeta keys directly**
2. **They read predmeta from verify logs** (`fl:verify:*` keys)
3. **Predmeta flow:** predict_wps writes predmeta → verify_race reads predmeta and embeds in verify log → calibration scripts extract predmeta from verify log
4. **Data sources:**
   - `export_verify_redis_to_csv.mjs`: Reads `fl:verify:*` only
   - `rebuild_calibration_from_logs.mjs`: Reads `fl:pred:*` + `fl:verify:*` (but predmeta comes from verify logs)

### Recommendations

1. **If goal is to reduce calibration logging volume:**
   - PayGate blocking `/api/verify_race` would achieve this (reduces primary calibration data source)
   - Consider if blocking calibration data collection aligns with product goals

2. **If goal is complete logging reduction:**
   - Add PayGate protection to `/api/log_prediction` to also reduce `fl:pred:*` writes
   - Current gap: log_prediction not gated

3. **Predmeta monitoring:**
   - Predmeta keys are intermediate storage (TTL: 45 days permanent, 2 hours pending)
   - Calibration scripts consume predmeta through verify logs (TTL: 90 days)
   - Predmeta keys may expire before calibration scripts run, but predmeta is preserved in verify logs

4. **Current PayGate status:**
   - In monitor mode by default (no blocking)
   - Logging volume not currently reduced
   - To enable blocking: Set `PAYGATE_SERVER_ENFORCE=1` in environment

