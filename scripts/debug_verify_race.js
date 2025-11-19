// scripts/debug_verify_race.js
console.log("[debug_verify_race] Starting debug script...");

let handler;

try {
  console.log("[debug_verify_race] Attempting to import handler...");
  handler = (await import("../pages/api/verify_race.js")).default;
  console.log("[debug_verify_race] Handler imported successfully");
} catch (err) {
  console.error("[debug_verify_race] ERROR importing handler:", err);
  console.error("[debug_verify_race] Error message:", err?.message || String(err));
  console.error("[debug_verify_race] Error stack:", err?.stack);
  process.exit(1);
}

const mockReq = {
  method: "POST",
  headers: {
    host: "localhost:3000",
    "x-forwarded-proto": "http",
  },
  body: {
    track: "Finger Lakes",
    date: "2025-11-18",
    raceNo: "3",
    predicted: { win: "", place: "", show: "" },
  },
};

const mockRes = {
  statusCode: 200,
  jsonData: null,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(name, value) {
    this.headers[name] = value;
  },
  json(data) {
    this.jsonData = data;
    console.log(">>> RESPONSE STATUS:", this.statusCode);
    console.log(">>> RESPONSE JSON:", JSON.stringify(data, null, 2));
    return this;
  },
};

(async () => {
  try {
    console.log("[debug_verify_race] Invoking handler...");
    await handler(mockReq, mockRes);
    console.log("[debug_verify_race] Handler completed without throwing.");
    console.log("[debug_verify_race] Final status code:", mockRes.statusCode);
    if (mockRes.jsonData) {
      console.log("[debug_verify_race] Response has data:", Object.keys(mockRes.jsonData));
    }
  } catch (err) {
    console.error("[debug_verify_race] RUNTIME ERROR from handler:", err);
    console.error("[debug_verify_race] Error message:", err?.message || String(err));
    console.error("[debug_verify_race] Error stack:", err?.stack);
    if (err?.cause) {
      console.error("[debug_verify_race] Error cause:", err.cause);
    }
  } finally {
    process.exit(0);
  }
})();
