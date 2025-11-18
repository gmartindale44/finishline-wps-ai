// scripts/debug_verify_race.js
import handler from "../pages/api/verify_race.js";

async function runDebug() {
  const mockReq = {
    method: "POST",
    body: {
      track: "Mahoning Valley",
      date: "2025-11-17",
      raceNo: 1,
      predicted: { win: "", place: "", show: "" },
    },
    headers: {},
  };

  const mockRes = {
    statusCode: null,
    jsonData: null,
    status: function (statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    },
    setHeader: function (name, value) {
      this.headers = { ...this.headers, [name]: value };
    },
  };

  console.log("Calling /api/verify_race with mock data...");
  try {
    await handler(mockReq, mockRes);

    console.log("\n--- Mock Response ---");
    console.log("Status Code:", mockRes.statusCode);
    console.log("\nJSON Keys:", Object.keys(mockRes.jsonData || {}));
    
    if (mockRes.jsonData) {
      console.log("\nDate:", mockRes.jsonData.date);
      console.log("Track:", mockRes.jsonData.track);
      console.log("Race No:", mockRes.jsonData.raceNo);
      console.log("\nOutcome:", mockRes.jsonData.outcome);
      console.log("\nSummary:");
      console.log(mockRes.jsonData.summary || "(no summary)");
      
      if (mockRes.jsonData.error) {
        console.error("\nError:", mockRes.jsonData.error);
        if (mockRes.jsonData.details) console.error("Details:", mockRes.jsonData.details);
        if (mockRes.jsonData.step) console.error("Step:", mockRes.jsonData.step);
      }
    }

    // Verify status is 200
    if (mockRes.statusCode !== 200) {
      console.error(`\n❌ FAILED: Expected status 200, got ${mockRes.statusCode}`);
      process.exit(1);
    } else {
      console.log("\n✅ Status code is 200");
    }

    // Verify summary format
    if (mockRes.jsonData?.summary) {
      const summary = mockRes.jsonData.summary;
      if (summary.includes("Using date:") && summary.includes("Outcome:")) {
        console.log("✅ Summary format looks correct");
      } else {
        console.warn("⚠️  Summary format may not match expected format");
        console.log("Expected: 'Using date: ...' and 'Outcome: ...'");
      }
    }
  } catch (error) {
    console.error("\n❌ Handler threw an error:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

runDebug().catch((error) => {
  console.error("Debug script failed:", error);
  process.exit(1);
});
