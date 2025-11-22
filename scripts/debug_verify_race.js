// scripts/debug_verify_race.js
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
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
    },
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
      console.log("STATUS:", this.statusCode);
      console.log("PAYLOAD:", JSON.stringify(payload, null, 2));
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

main();
