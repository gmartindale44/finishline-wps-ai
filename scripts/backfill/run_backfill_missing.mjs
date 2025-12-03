#!/usr/bin/env node
/**
 * Backfill Missing Verify Results
 * 
 * Scans prediction keys in Redis and backfills verify results for races
 * that don't have a matching verify log yet.
 * 
 * Usage:
 *   node scripts/backfill/run_backfill_missing.mjs [--track=TRACK] [--date=YYYY-MM-DD] [--maxRaces=N] [--dryRun]
 */

import { fetchRaceList, verifyExists, writeToRedis, writeAuditLog, summarizeBackfill, buildRaceId } from "../../utils/finishline/backfill_helpers.js";

// Get base URL for verify_race API
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
 * Parse command line arguments
 */
function parseArgs() {
  const args = {
    track: null,
    date: null,
    maxRaces: null,
    dryRun: true,
  };
  
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--track=")) {
      args.track = arg.split("=")[1];
    } else if (arg.startsWith("--date=")) {
      args.date = arg.split("=")[1];
    } else if (arg.startsWith("--maxRaces=")) {
      args.maxRaces = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--live" || arg === "--no-dryRun") {
      args.dryRun = false;
    } else if (arg === "--dryRun") {
      args.dryRun = true;
    }
  }
  
  return args;
}

async function main() {
  const args = parseArgs();
  
  console.log("[backfill_missing] Starting missing verify backfill...");
  console.log(`[backfill_missing] Mode: ${args.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`[backfill_missing] Filters:`, {
    track: args.track || "all",
    date: args.date || "all",
    maxRaces: args.maxRaces || "unlimited",
  });
  
  // Fetch race list
  const races = await fetchRaceList({
    track: args.track,
    date: args.date,
    maxRaces: args.maxRaces,
  });
  
  console.log(`[backfill_missing] Found ${races.length} prediction(s) to check`);
  
  // Filter to only missing verify results
  const missingRaces = [];
  for (const race of races) {
    const exists = await verifyExists(race.track, race.date, race.raceNo);
    if (!exists) {
      missingRaces.push(race);
    }
  }
  
  console.log(`[backfill_missing] ${missingRaces.length} race(s) missing verify results`);
  
  if (missingRaces.length === 0) {
    console.log("[backfill_missing] ✅ All races already have verify results");
    return;
  }
  
  // Process missing races
  const results = [];
  const today = new Date().toISOString().slice(0, 10);
  
  for (let i = 0; i < missingRaces.length; i++) {
    const race = missingRaces[i];
    console.log(`[backfill_missing] [${i + 1}/${missingRaces.length}] Processing ${race.track} ${race.date} R${race.raceNo}...`);
    
    try {
      const verifyResult = await callVerifyRace(race);
      
      const resultEntry = {
        ...race,
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
        query: verifyResult.query || "",
        top: verifyResult.top || null,
        summary: verifyResult.summary || "",
        debug: verifyResult.debug || {},
      };
      
      // Write to Redis if not dry run
      if (!args.dryRun) {
        const written = await writeToRedis(resultEntry);
        if (written) {
          console.log(`[backfill_missing] ✅ Wrote verify result for ${race.track} ${race.date} R${race.raceNo}`);
        } else {
          console.warn(`[backfill_missing] ⚠️  Failed to write verify result for ${race.track} ${race.date} R${race.raceNo}`);
        }
        
        // Write audit log
        await writeAuditLog(today, {
          type: "backfill_missing",
          track: race.track,
          date: race.date,
          raceNo: race.raceNo,
          ok: resultEntry.ok,
          step: resultEntry.step,
          hasOutcome: !!(resultEntry.outcome.win || resultEntry.outcome.place || resultEntry.outcome.show),
        });
      } else {
        console.log(`[backfill_missing] [DRY RUN] Would write verify result for ${race.track} ${race.date} R${race.raceNo}`);
      }
      
      results.push(resultEntry);
      
      // Delay between requests
      if (i < missingRaces.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 750));
      }
      
    } catch (err) {
      console.error(`[backfill_missing] ❌ Error processing ${race.track} ${race.date} R${race.raceNo}:`, err.message);
      results.push({
        ...race,
        ok: false,
        step: "backfill_error",
        outcome: { win: "", place: "", show: "" },
        predicted: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        error: String(err && err.message ? err.message : err),
      });
    }
  }
  
  // Print summary
  const summary = summarizeBackfill(results);
  console.log("\n[backfill_missing] ========================================");
  console.log("[backfill_missing] Summary:");
  console.log(`[backfill_missing]   Total: ${summary.total}`);
  console.log(`[backfill_missing]   Successes: ${summary.successes}`);
  console.log(`[backfill_missing]   Failures: ${summary.failures}`);
  console.log(`[backfill_missing]   With Outcome: ${summary.withOutcome}`);
  console.log(`[backfill_missing]   Without Outcome: ${summary.withoutOutcome}`);
  console.log(`[backfill_missing]   By Step:`, summary.byStep);
  console.log(`[backfill_missing]   By Track:`, summary.byTrack);
  console.log("[backfill_missing] ========================================\n");
}

main().catch(err => {
  console.error("[backfill_missing] Fatal error:", err);
  process.exit(1);
});

