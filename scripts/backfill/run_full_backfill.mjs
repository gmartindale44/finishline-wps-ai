#!/usr/bin/env node
/**
 * Full Backfill Runner
 * 
 * Main entry point for backfill operations. Supports multiple modes:
 * - today: Backfill today's races
 * - missing: Backfill only races missing verify results
 * - day: Backfill a specific date
 * - track: Backfill a specific track
 * 
 * Usage:
 *   node scripts/backfill/run_full_backfill.mjs --mode=today [--dryRun]
 *   node scripts/backfill/run_full_backfill.mjs --mode=missing [--track=TRACK] [--date=YYYY-MM-DD] [--maxRaces=N] [--dryRun]
 *   node scripts/backfill/run_full_backfill.mjs --mode=day --date=YYYY-MM-DD [--track=TRACK] [--maxRaces=N] [--dryRun]
 *   node scripts/backfill/run_full_backfill.mjs --mode=track --track=TRACK [--date=YYYY-MM-DD] [--maxRaces=N] [--dryRun]
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function parseArgs() {
  const args = {
    mode: null,
    track: null,
    date: null,
    maxRaces: null,
    dryRun: true,
  };
  
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--mode=")) {
      args.mode = arg.split("=")[1];
    } else if (arg.startsWith("--track=")) {
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
  
  if (!args.mode) {
    console.error("[backfill_full] Error: --mode=MODE is required");
    console.error("[backfill_full] Modes: today, missing, day, track");
    process.exit(1);
  }
  
  console.log("[backfill_full] Starting full backfill...");
  console.log(`[backfill_full] Mode: ${args.mode}`);
  console.log(`[backfill_full] Dry run: ${args.dryRun}`);
  
  let scriptPath = null;
  let scriptArgs = [];
  
  switch (args.mode) {
    case "today": {
      const today = new Date().toISOString().slice(0, 10);
      scriptPath = "scripts/backfill/run_backfill_day.mjs";
      scriptArgs = ["--date=" + today];
      if (args.track) scriptArgs.push("--track=" + args.track);
      if (args.maxRaces) scriptArgs.push("--maxRaces=" + args.maxRaces);
      if (args.dryRun) scriptArgs.push("--dryRun");
      else scriptArgs.push("--live");
      break;
    }
    
    case "missing": {
      scriptPath = "scripts/backfill/run_backfill_missing.mjs";
      if (args.track) scriptArgs.push("--track=" + args.track);
      if (args.date) scriptArgs.push("--date=" + args.date);
      if (args.maxRaces) scriptArgs.push("--maxRaces=" + args.maxRaces);
      if (args.dryRun) scriptArgs.push("--dryRun");
      else scriptArgs.push("--live");
      break;
    }
    
    case "day": {
      if (!args.date) {
        console.error("[backfill_full] Error: --date=YYYY-MM-DD is required for day mode");
        process.exit(1);
      }
      scriptPath = "scripts/backfill/run_backfill_day.mjs";
      scriptArgs = ["--date=" + args.date];
      if (args.track) scriptArgs.push("--track=" + args.track);
      if (args.maxRaces) scriptArgs.push("--maxRaces=" + args.maxRaces);
      if (args.dryRun) scriptArgs.push("--dryRun");
      else scriptArgs.push("--live");
      break;
    }
    
    case "track": {
      if (!args.track) {
        console.error("[backfill_full] Error: --track=TRACK is required for track mode");
        process.exit(1);
      }
      scriptPath = "scripts/backfill/run_backfill_track.mjs";
      scriptArgs = ["--track=" + args.track];
      if (args.date) scriptArgs.push("--date=" + args.date);
      if (args.maxRaces) scriptArgs.push("--maxRaces=" + args.maxRaces);
      if (args.dryRun) scriptArgs.push("--dryRun");
      else scriptArgs.push("--live");
      break;
    }
    
    default: {
      console.error(`[backfill_full] Error: Unknown mode "${args.mode}"`);
      console.error("[backfill_full] Modes: today, missing, day, track");
      process.exit(1);
    }
  }
  
  console.log(`[backfill_full] Executing: node ${scriptPath} ${scriptArgs.join(" ")}`);
  
  try {
    const { stdout, stderr } = await execAsync(`node ${scriptPath} ${scriptArgs.join(" ")}`, {
      cwd: process.cwd(),
      env: process.env,
    });
    
    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }
    
    console.log("[backfill_full] ✅ Backfill completed successfully");
    
  } catch (err) {
    console.error("[backfill_full] ❌ Backfill failed:", err.message);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("[backfill_full] Fatal error:", err);
  process.exit(1);
});

