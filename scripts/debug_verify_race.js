// scripts/debug_verify_race.js
// Local test script for /api/verify_race handler

import handler from "../pages/api/verify_race.js";

// Mock request object
const mockReq = {
  method: "POST",
  body: {
    track: "Mahoning Valley Race Course",
    date: "2025-11-18",
    raceNo: 1,
  },
  headers: {
    host: "localhost:3000",
    "x-forwarded-proto": "http",
  },
};

// Mock response object
let responseStatus = null;
let responseHeaders = {};
let responseBody = null;

const mockRes = {
  status: (code) => {
    responseStatus = code;
    return mockRes;
  },
  json: (data) => {
    responseBody = data;
    return mockRes;
  },
  setHeader: (key, value) => {
    responseHeaders[key] = value;
    return mockRes;
  },
};

// Run the handler
console.log("[debug] Testing verify_race handler...");
console.log("[debug] Request:", JSON.stringify(mockReq.body, null, 2));

try {
  await handler(mockReq, mockRes);

  console.log("\n[debug] Response Status:", responseStatus);
  console.log("[debug] Response Headers:", responseHeaders);
  console.log("[debug] Response Body:", JSON.stringify(responseBody, null, 2));

  // Validate response
  if (responseStatus !== 200) {
    console.error("\n[ERROR] Handler returned non-200 status:", responseStatus);
    process.exit(1);
  }

  if (!responseBody) {
    console.error("\n[ERROR] Handler returned no response body");
    process.exit(1);
  }

  // Check required fields
  const requiredFields = ["date", "track", "raceNo", "outcome"];
  const missingFields = requiredFields.filter((field) => !(field in responseBody));

  if (missingFields.length > 0) {
    console.error("\n[ERROR] Missing required fields:", missingFields);
    process.exit(1);
  }

  // Check outcome structure
  if (!responseBody.outcome || typeof responseBody.outcome !== "object") {
    console.error("\n[ERROR] Invalid outcome structure:", responseBody.outcome);
    process.exit(1);
  }

  console.log("\n[SUCCESS] Handler executed successfully");
  console.log("[SUCCESS] Status: 200");
  console.log("[SUCCESS] All required fields present");
  
  if (responseBody.error) {
    console.log("[INFO] Response contains error:", responseBody.error);
    console.log("[INFO] Error details:", responseBody.details);
    console.log("[INFO] Error step:", responseBody.step);
  } else {
    console.log("[INFO] Response contains no error field");
    if (responseBody.top) {
      console.log("[INFO] Top result:", responseBody.top.title);
      console.log("[INFO] Top link:", responseBody.top.link);
    }
    if (responseBody.outcome) {
      console.log("[INFO] Outcome:", responseBody.outcome);
    }
  }
} catch (error) {
  console.error("\n[FATAL ERROR] Handler threw an uncaught exception:");
  console.error("Message:", error?.message || String(error));
  console.error("Stack:", error?.stack);
  process.exit(1);
}

