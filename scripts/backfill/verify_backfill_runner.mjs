#!/usr/bin/env node
/**
 * Verify Backfill Runner
 * 
 * Internal helper that performs verify backfill by calling /api/verify_race via HTTP.
 * Used by /api/verify_backfill endpoint and can be called from scripts.
 * 
 * This module calls the existing verify_race handler via HTTP (not by importing code),
 * ensuring we use the exact same logic as the UI and QA scripts.
 */

/**
 * Get the base URL for verify_race API calls
 * - Uses FINISHLINE_VERIFY_BASE_URL if set
 * - Falls back to Vercel URL if in Vercel environment
 * - Falls back to localhost for local dev
 */
function getVerifyBaseUrl() {
  // Explicit env var (for testing against preview/production)
  if (process.env.FINISHLINE_VERIFY_BASE_URL) {
    return process.env.FINISHLINE_VERIFY_BASE_URL;
  }
  
  // Vercel environment
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  
  // Local development fallback
  return "http://localhost:3000";
}

/**
 * Call /api/verify_race for a single race
 * @param {object} params
 * @param {string} params.track - Track name
 * @param {string} params.date - ISO date (YYYY-MM-DD)
 * @param {string|number} params.raceNo - Race number
 * @returns {Promise<object>} - verify_race response
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
    // Return a structured error response matching verify_race shape
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
      debug: {
        error: String(err && err.message ? err.message : err),
      },
    };
  }
}

/**
 * Trim debug object to only include lightweight fields
 * Removes any HTML snapshots, fingerprints, or large strings
 */
function trimDebug(debug) {
  if (!debug || typeof debug !== "object") {
    return {};
  }
  
  const trimmed = {};
  
  // Keep only lightweight fields
  const allowedFields = [
    "googleUrl",
    "hrnUrl",
    "hrnRaceNo",
    "hrnParseError",
    "equibaseUrl",
    "equibaseParseError",
    "backendVersion",
    "handlerFile",
    "canonicalDateIso",
    "source",
    "uiDateRaw",
  ];
  
  for (const field of allowedFields) {
    if (debug[field] !== undefined) {
      trimmed[field] = debug[field];
    }
  }
  
  return trimmed;
}

/**
 * Run verify backfill for a list of races
 * @param {object} options
 * @param {Array<{track: string, date: string, raceNo: string|number}>} options.races - List of races to process
 * @param {boolean} [options.dryRun=true] - If false, results will be persisted (TODO: implement persistence)
 * @returns {Promise<object>} - Backfill results
 */
export async function runVerifyBackfill({ races, dryRun = true }) {
  const results = [];
  let successes = 0;
  let failures = 0;
  
  for (const race of races) {
    const { track, date, raceNo } = race;
    
    try {
      // Call verify_race via HTTP
      const verifyResult = await callVerifyRace({ track, date, raceNo });
      
      // Build result entry matching calibration pipeline expectations
      const resultEntry = {
        track: verifyResult.track || track || "",
        date: verifyResult.date || date || "",
        raceNo: String(verifyResult.raceNo || raceNo || ""),
        ok: verifyResult.ok === true,
        step: verifyResult.step || "",
        outcome: verifyResult.outcome || { win: "", place: "", show: "" },
        predicted: verifyResult.predicted || { win: "", place: "", show: "" },
        hits: verifyResult.hits || {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        debug: trimDebug(verifyResult.debug),
      };
      
      results.push(resultEntry);
      
      // Count success/failure
      const hasOutcome = !!(resultEntry.outcome.win || resultEntry.outcome.place || resultEntry.outcome.show);
      if (resultEntry.ok && hasOutcome) {
        successes++;
      } else {
        failures++;
      }
      
      // Small delay between requests to avoid hammering the API
      if (races.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (err) {
      // Error calling verify_race
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
        debug: {
          error: String(err && err.message ? err.message : err),
        },
      });
    }
  }
  
  // TODO: If dryRun === false, persist results to Redis
  // This would call logVerifyResult or similar persistence function
  // For now, we just return the results
  
  return {
    results,
    count: results.length,
    successes,
    failures,
  };
}

/**
 * Get default canonical test races (for manual testing when no filters provided)
 */
export function getCanonicalTestRaces() {
  return [
    { track: "Laurel Park", raceNo: 1, date: "2025-11-30" },
    { track: "Parx Racing", raceNo: 3, date: "2025-12-01" },
    { track: "Turf Paradise", raceNo: 2, date: "2025-12-02" },
    { track: "Zia Park", raceNo: 2, date: "2025-12-02" },
  ];
}

