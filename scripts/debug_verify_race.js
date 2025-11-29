// scripts/debug_verify_race.js
// Debug harness for verify_race API
// Supports both stub and full modes via VERIFY_RACE_MODE environment variable
// Usage:
//   VERIFY_RACE_MODE=stub node scripts/debug_verify_race.js --track "Del Mar" --date "2025-11-22" --race 1
//   VERIFY_RACE_MODE=full node scripts/debug_verify_race.js --track "Del Mar" --date "2025-11-22" --race 1
//   VERIFY_RACE_MODE=full node scripts/debug_verify_race.js --track "Aqueduct" --date "2025-11-22" --race 1

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    track: "Del Mar",
    date: "2025-11-22",
    raceNo: "1",
    predicted: {
      win: "",
      place: "",
      show: "",
    },
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--track" && i + 1 < args.length) {
      result.track = args[++i];
    } else if (arg === "--date" && i + 1 < args.length) {
      result.date = args[++i];
    } else if ((arg === "--race" || arg === "--raceNo") && i + 1 < args.length) {
      result.raceNo = args[++i];
    } else if (arg === "--predicted-win" && i + 1 < args.length) {
      result.predicted.win = args[++i];
    } else if (arg === "--predicted-place" && i + 1 < args.length) {
      result.predicted.place = args[++i];
    } else if (arg === "--predicted-show" && i + 1 < args.length) {
      result.predicted.show = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scripts/debug_verify_race.js [options]

Options:
  --track <name>              Track name (default: "Del Mar")
  --date <YYYY-MM-DD>         Race date in ISO format (default: "2025-11-22")
  --race <number>              Race number (default: "1")
  --predicted-win <name>       Predicted win horse
  --predicted-place <name>     Predicted place horse
  --predicted-show <name>      Predicted show horse
  --help, -h                   Show this help message

Environment:
  VERIFY_RACE_MODE            Set to "full" for full parser, "stub" for stub mode (default: "stub")

Examples:
  VERIFY_RACE_MODE=full node scripts/debug_verify_race.js --track "Del Mar" --date "2025-11-22" --race 1
  VERIFY_RACE_MODE=full node scripts/debug_verify_race.js --track "Aqueduct" --date "2025-11-22" --race 1 --predicted-win "Doc Sullivan"
      `);
      process.exit(0);
    }
  }

  return result;
}

async function main() {
  // Parse command-line arguments
  const args = parseArgs();

  // Read mode from environment (default to stub for safety)
  const mode = (process.env.VERIFY_RACE_MODE || "stub").toLowerCase().trim();
  console.log(`[debug_verify_race] Running in ${mode} mode`);
  console.log(`[debug_verify_race] Test case: ${args.track} - ${args.date} - Race ${args.raceNo}`);
  console.log(`[debug_verify_race] Received date: "${args.date}" (will be normalized to canonical format)`);
  if (args.predicted.win || args.predicted.place || args.predicted.show) {
    console.log(`[debug_verify_race] Predicted: Win=${args.predicted.win || "(none)"}, Place=${args.predicted.place || "(none)"}, Show=${args.predicted.show || "(none)"}`);
  }

  // Import the handler like Vercel would (ES module)
  // Use relative path from scripts/ to pages/api/verify_race.js
  const handlerModule = await import("../pages/api/verify_race.js");
  const handler = handlerModule.default || handlerModule;

  // Fake req/res objects
  const req = {
    method: "POST",
    body: {
      track: args.track,
      date: args.date,
      raceNo: args.raceNo,
      predicted: args.predicted,
    },
    headers: {
      host: "localhost:3000",
      "x-forwarded-proto": "http",
    },
    on: () => {}, // Stub for stream interface (not used when body is already parsed)
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.headersSent = true;
      console.log("\n=== RESPONSE ===");
      console.log("STATUS:", this.statusCode);
      console.log("STEP:", payload.step);
      console.log("OK:", payload.ok);
      console.log("DATE (response):", payload.date);
      if (payload.query) {
        console.log("QUERY:", payload.query);
      }
      if (payload.error) {
        console.log("ERROR:", payload.error);
      }
      if (payload.top?.link) {
        console.log("TOP LINK:", payload.top.link);
      }
      if (payload.debug?.googleUrl) {
        console.log("GOOGLE URL:", payload.debug.googleUrl);
      }
      if (payload.debug?.source) {
        console.log("SOURCE:", payload.debug.source);
      }
      if (payload.debug?.equibaseUrl) {
        console.log("EQUIBASE URL:", payload.debug.equibaseUrl);
      }
      if (payload.outcome?.win || payload.outcome?.place || payload.outcome?.show) {
        console.log("OUTCOME:", {
          win: payload.outcome.win,
          place: payload.outcome.place,
          show: payload.outcome.show,
        });
      }
      if (payload.hits) {
        console.log("HITS:", payload.hits);
      }
      if (payload.predicted) {
        console.log("PREDICTED:", payload.predicted);
      }
      if (payload.summary) {
        console.log("\n=== SUMMARY (cosmetic UI text, not used by calibration) ===");
        console.log(payload.summary);
      }
      // Verify date using structured field, not summary text
      if (payload.date) {
        console.log(`\n[VERIFICATION] Using date (from structured field): "${payload.date}"`);
        if (payload.date !== args.date && payload.date !== args.date.replace(/\//g, "-")) {
          console.warn(`[WARNING] Date mismatch! Input: "${args.date}", Response: "${payload.date}"`);
        } else {
          console.log(`[VERIFICATION] ✓ Date matches input: "${args.date}"`);
        }
      }
      console.log("\n=== FULL PAYLOAD ===");
      console.log(JSON.stringify(payload, null, 2));
    },
  };

  try {
    await handler(req, res);
    if (!res.headersSent) {
      console.warn("[debug_verify_race] handler returned without sending a response");
    }
  } catch (err) {
    console.error("[debug_verify_race] TOP-LEVEL THROW", err);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[debug_verify_race] Unhandled error", err);
  process.exitCode = 1;
});
