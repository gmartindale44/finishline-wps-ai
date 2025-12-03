// pages/api/verify_backfill.js
// 
// Verify Backfill API Endpoint
// 
// This endpoint triggers verify backfill by calling /api/verify_race for specified races.
// It uses the same HTTP-based approach as our QA scripts, ensuring we use the exact
// same verify logic as the UI.
//
// History:
// - Previously was a stub that returned { ok: true }
// - Now restored to call verify_race via HTTP and return backfill results
// - Compatible with existing frontend calls from verify-modal.js

export const config = {
  runtime: "nodejs",
};

// Inline helper functions (same logic as scripts/backfill/verify_backfill_runner.mjs)
// This avoids Next.js import path issues while maintaining the HTTP-based approach

/**
 * Get the base URL for verify_race API calls
 */
function getVerifyBaseUrl() {
  if (process.env.FINISHLINE_VERIFY_BASE_URL) {
    return process.env.FINISHLINE_VERIFY_BASE_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

/**
 * Call /api/verify_race for a single race
 */
async function callVerifyRace({ track, date, raceNo }) {
  const baseUrl = getVerifyBaseUrl();
  const url = `${baseUrl}/api/verify_race`;
  const dateRaw = date.replace(/-/g, "/");
  
  const payload = {
    track,
    raceNo: String(raceNo || ""),
    date,
    dateIso: date,
    dateRaw,
  };
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    
    return await res.json();
  } catch (err) {
    return {
      ok: false,
      step: "verify_race_error",
      error: String(err && err.message ? err.message : err),
      track: track || "",
      date: date || "",
      raceNo: String(raceNo || ""),
      outcome: { win: "", place: "", show: "" },
      predicted: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      debug: { error: String(err && err.message ? err.message : err) },
    };
  }
}

/**
 * Trim debug object to only include lightweight fields
 */
function trimDebug(debug) {
  if (!debug || typeof debug !== "object") {
    return {};
  }
  
  const trimmed = {};
  const allowedFields = [
    "googleUrl", "hrnUrl", "hrnRaceNo", "hrnParseError",
    "equibaseUrl", "equibaseParseError",
    "backendVersion", "handlerFile", "canonicalDateIso",
    "source", "uiDateRaw",
  ];
  
  for (const field of allowedFields) {
    if (debug[field] !== undefined) {
      trimmed[field] = debug[field];
    }
  }
  
  return trimmed;
}

/**
 * Get default canonical test races
 */
function getCanonicalTestRaces() {
  return [
    { track: "Laurel Park", raceNo: 1, date: "2025-11-30" },
    { track: "Parx Racing", raceNo: 3, date: "2025-12-01" },
    { track: "Turf Paradise", raceNo: 2, date: "2025-12-02" },
    { track: "Zia Park", raceNo: 2, date: "2025-12-02" },
  ];
}

/**
 * Run verify backfill for a list of races
 */
async function runVerifyBackfill({ races, dryRun = true }) {
  const results = [];
  let successes = 0;
  let failures = 0;
  
  for (const race of races) {
    const { track, date, raceNo } = race;
    
    try {
      const verifyResult = await callVerifyRace({ track, date, raceNo });
      
      const resultEntry = {
        track: verifyResult.track || track || "",
        date: verifyResult.date || date || "",
        raceNo: String(verifyResult.raceNo || raceNo || ""),
        ok: verifyResult.ok === true,
        step: verifyResult.step || "",
        outcome: verifyResult.outcome || { win: "", place: "", show: "" },
        predicted: verifyResult.predicted || { win: "", place: "", show: "" },
        hits: verifyResult.hits || {
          winHit: false, placeHit: false, showHit: false, top3Hit: false,
        },
        debug: trimDebug(verifyResult.debug),
      };
      
      results.push(resultEntry);
      
      const hasOutcome = !!(resultEntry.outcome.win || resultEntry.outcome.place || resultEntry.outcome.show);
      if (resultEntry.ok && hasOutcome) {
        successes++;
      } else {
        failures++;
      }
      
      if (races.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (err) {
      failures++;
      results.push({
        track: track || "",
        date: date || "",
        raceNo: String(raceNo || ""),
        ok: false,
        step: "verify_backfill_error",
        outcome: { win: "", place: "", show: "" },
        predicted: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        debug: { error: String(err && err.message ? err.message : err) },
      });
    }
  }
  
  // TODO: If dryRun === false, persist results to Redis
  // For now, we just return the results
  
  return { results, count: results.length, successes, failures };
}

export default async function handler(req, res) {
  // Always return JSON, never throw
  try {
    // Accept both POST (with JSON body) and GET (with query params) for flexibility
    let body = {};
    
    if (req.method === "POST") {
      // Try to get body from Next.js parsed body or parse manually
      if (req.body && typeof req.body === "object") {
        body = req.body;
      } else {
        // Manual parsing if needed
        try {
          let raw = "";
          req.on("data", (chunk) => {
            raw += chunk.toString();
          });
          await new Promise((resolve) => {
            req.on("end", () => {
              if (raw) {
                try {
                  body = JSON.parse(raw);
                } catch {
                  // Ignore parse errors, use empty body
                }
              }
              resolve();
            });
          });
        } catch {
          // Ignore parsing errors, use empty body
        }
      }
    } else if (req.method === "GET") {
      // GET with query params for manual testing
      body = {
        track: req.query.track || null,
        date: req.query.date || null,
        raceNo: req.query.raceNo || req.query.race || null,
        maxRaces: req.query.maxRaces || req.query.limit || null,
        dryRun: req.query.dryRun !== "false",
      };
    } else {
      return res.status(200).json({
        ok: false,
        step: "verify_backfill",
        error: `Method ${req.method} not allowed. Use POST or GET.`,
      });
    }
    
    // Extract filters
    const track = body.track ? String(body.track).trim() : null;
    const date = body.date ? String(body.date).trim() : null;
    const raceNo = body.raceNo || body.race ? String(body.raceNo || body.race).trim() : null;
    const maxRaces = body.maxRaces || body.limit ? parseInt(body.maxRaces || body.limit, 10) : null;
    const dryRun = body.dryRun !== false; // Default to true for safety
    
    // Build list of races to process
    let races = [];
    
    if (track && date && raceNo) {
      // Single race specified
      races = [{ track, date, raceNo }];
    } else if (track || date || raceNo) {
      // Partial filters - for now, we only support exact match (all three required)
      // Could be extended to scan Redis for matching races
      return res.status(200).json({
        ok: false,
        step: "verify_backfill",
        mode: dryRun ? "dryRun" : "write",
        filters: { track, date, raceNo, maxRaces },
        count: 0,
        successes: 0,
        failures: 0,
        error: "Partial filters not yet supported. Provide track, date, and raceNo together, or omit all for default test races.",
      });
    } else {
      // No filters - use default canonical test races (safe for manual testing)
      races = getCanonicalTestRaces();
    }
    
    // Apply maxRaces limit if specified
    if (maxRaces && maxRaces > 0 && races.length > maxRaces) {
      races = races.slice(0, maxRaces);
    }
    
    // Run backfill
    const { results, count, successes, failures } = await runVerifyBackfill({
      races,
      dryRun,
    });
    
    // Build response
    const response = {
      ok: true,
      step: "verify_backfill",
      mode: dryRun ? "dryRun" : "write",
      filters: {
        track: track || null,
        date: date || null,
        raceNo: raceNo || null,
        maxRaces: maxRaces || null,
      },
      count,
      successes,
      failures,
      sample: results.length > 0 ? {
        track: results[0].track,
        date: results[0].date,
        raceNo: results[0].raceNo,
        ok: results[0].ok,
        step: results[0].step,
        outcome: results[0].outcome,
      } : null,
    };
    
    // Add a brief summary string for UI display
    if (count > 0) {
      response.summary = `Processed ${count} race(s): ${successes} success(es), ${failures} failure(s)`;
    } else {
      response.summary = "No races processed";
    }
    
    return res.status(200).json(response);
    
  } catch (err) {
    // Never throw - always return JSON
    console.error("[verify_backfill] Error:", err);
    return res.status(200).json({
      ok: false,
      step: "verify_backfill_error",
      mode: "dryRun",
      filters: {},
      count: 0,
      successes: 0,
      failures: 0,
      error: String(err && err.message ? err.message : err),
    });
  }
}
