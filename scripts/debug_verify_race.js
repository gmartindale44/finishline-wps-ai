// scripts/debug_verify_race.js
// Debug harness for verify_race API
// Supports both stub and full modes via VERIFY_RACE_MODE environment variable
// Usage:
//   VERIFY_RACE_MODE=stub npm run debug:verify
//   VERIFY_RACE_MODE=full npm run debug:verify

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Read mode from environment (default to stub for safety)
  const mode = (process.env.VERIFY_RACE_MODE || "stub").toLowerCase().trim();
  console.log(`[debug_verify_race] Running in ${mode} mode`);

  // Import the handler like Vercel would (ES module)
  // Use relative path from scripts/ to pages/api/verify_race.js
  const handlerModule = await import("../pages/api/verify_race.js");
  const handler = handlerModule.default || handlerModule;

  // Fake req/res objects
  const req = {
    method: "POST",
    body: {
      track: "Aqueduct",
      date: "2025-11-22",
      raceNo: "1",
      predicted: {
        win: "",
        place: "",
        show: "",
      },
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
