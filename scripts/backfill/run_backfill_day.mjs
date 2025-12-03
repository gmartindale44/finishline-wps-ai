#!/usr/bin/env node
/**
 * Backfill Verify Results for a Single Day
 * 
 * Backfills verify results for all races on a specific date.
 * 
 * Usage:
 *   node scripts/backfill/run_backfill_day.mjs --date=YYYY-MM-DD [--track=TRACK] [--maxRaces=N] [--dryRun]
 */

import { fetchRaceList, verifyExists, writeToRedis, writeAuditLog, summarizeBackfill } from "../../utils/finishline/backfill_helpers.js";

function getVerifyBaseUrl() {
  if (process.env.FINISHLINE_VERIFY_BASE_URL) {
    return process.env.FINISHLINE_VERIFY_BASE_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

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

function parseArgs() {
  const args = {
    date: null,
    track: null,
    maxRaces: null,
    dryRun: true,
  };
  
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--date=")) {
      args.date = arg.split("=")[1];
    } else if (arg.startsWith("--track=")) {
      args.track = arg.split("=")[1];
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
  
  if (!args.date) {
    console.error("[backfill_day] Error: --date=YYYY-MM-DD is required");
    process.exit(1);
  }
  
  console.log("[backfill_day] Starting day backfill...");
  console.log(`[backfill_day] Date: ${args.date}`);
  console.log(`[backfill_day] Mode: ${args.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`[backfill_day] Track filter: ${args.track || "all"}`);
  console.log(`[backfill_day] Max races: ${args.maxRaces || "unlimited"}`);
  
  // Fetch races for this date
  const races = await fetchRaceList({
    date: args.date,
    track: args.track,
    maxRaces: args.maxRaces,
  });
  
  console.log(`[backfill_day] Found ${races.length} race(s) for ${args.date}`);
  
  if (races.length === 0) {
    console.log("[backfill_day] ✅ No races found for this date");
    return;
  }
  
  // Process races
  const results = [];
  
  for (let i = 0; i < races.length; i++) {
    const race = races[i];
    console.log(`[backfill_day] [${i + 1}/${races.length}] Processing ${race.track} R${race.raceNo}...`);
    
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
          console.log(`[backfill_day] ✅ Wrote verify result for ${race.track} R${race.raceNo}`);
        } else {
          console.warn(`[backfill_day] ⚠️  Failed to write verify result for ${race.track} R${race.raceNo}`);
        }
        
        await writeAuditLog(args.date, {
          type: "backfill_day",
          track: race.track,
          date: race.date,
          raceNo: race.raceNo,
          ok: resultEntry.ok,
          step: resultEntry.step,
          hasOutcome: !!(resultEntry.outcome.win || resultEntry.outcome.place || resultEntry.outcome.show),
        });
      } else {
        console.log(`[backfill_day] [DRY RUN] Would write verify result for ${race.track} R${race.raceNo}`);
      }
      
      results.push(resultEntry);
      
      // Delay between requests
      if (i < races.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 750));
      }
      
    } catch (err) {
      console.error(`[backfill_day] ❌ Error processing ${race.track} R${race.raceNo}:`, err.message);
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
  console.log("\n[backfill_day] ========================================");
  console.log("[backfill_day] Summary:");
  console.log(`[backfill_day]   Total: ${summary.total}`);
  console.log(`[backfill_day]   Successes: ${summary.successes}`);
  console.log(`[backfill_day]   Failures: ${summary.failures}`);
  console.log(`[backfill_day]   With Outcome: ${summary.withOutcome}`);
  console.log(`[backfill_day]   Without Outcome: ${summary.withoutOutcome}`);
  console.log(`[backfill_day]   By Step:`, summary.byStep);
  console.log(`[backfill_day]   By Track:`, summary.byTrack);
  console.log("[backfill_day] ========================================\n");
}

main().catch(err => {
  console.error("[backfill_day] Fatal error:", err);
  process.exit(1);
});

