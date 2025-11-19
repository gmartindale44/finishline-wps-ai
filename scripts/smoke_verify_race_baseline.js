// scripts/smoke_verify_race_baseline.js
import handler from "../pages/api/verify_race.js";

async function runSmokeTest() {
  const mockReq = {
    method: "POST",
    body: {
      track: "Mahoning Valley",
      date: "2025-11-17",
      raceNo: 1,
    },
    headers: {
      host: "localhost:3000",
      "x-forwarded-proto": "https",
    },
  };

  let statusCode = null;
  let jsonData = null;

  const mockRes = {
    status: function (code) {
      statusCode = code;
      return this;
    },
    json: function (data) {
      jsonData = data;
      return Promise.resolve();
    },
    setHeader: function (name, value) {
      // No-op for smoke test
    },
  };

  console.log("Running smoke test for verify_race handler...");
  console.log("Request:", { track: mockReq.body.track, date: mockReq.body.date, raceNo: mockReq.body.raceNo });

  try {
    await handler(mockReq, mockRes);

    console.log("\n--- Results ---");
    console.log("Status Code:", statusCode);
    console.log("Has error field:", !!jsonData?.error);
    console.log("Has outcome field:", !!jsonData?.outcome);
    console.log("Has top field:", !!jsonData?.top);

    if (jsonData?.error) {
      console.log("\nError Response:");
      console.log("  Error:", jsonData.error);
      console.log("  Details:", jsonData.details);
      console.log("  Step:", jsonData.step);
    } else {
      console.log("\nSuccess Response:");
      if (jsonData?.outcome) {
        console.log("  Outcome:", jsonData.outcome);
      }
      if (jsonData?.top) {
        console.log("  Top Result:", jsonData.top.title || "(no title)");
      }
    }

    // Verify status is 200
    if (statusCode !== 200) {
      console.error(`\n❌ FAILED: Expected status 200, got ${statusCode}`);
      process.exit(1);
    } else {
      console.log("\n✅ Status code is 200");
    }

    // Verify handler didn't throw
    console.log("✅ Handler completed without throwing");
  } catch (error) {
    console.error("\n❌ Handler threw an error:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

runSmokeTest().catch((error) => {
  console.error("Smoke test script failed:", error);
  process.exit(1);
});

