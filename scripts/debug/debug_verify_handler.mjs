#!/usr/bin/env node
/**
 * Debug script to test if the verify_race handler can be invoked without throwing
 */

(async () => {
  try {
    console.log("[debug_verify_handler] Importing handler...");
    
    const mod = await import("../../pages/api/verify_race.js");
    const handler = mod.default;
    
    console.log("[debug_verify_handler] Handler type:", typeof handler);
    
    if (typeof handler !== "function") {
      console.error("[debug_verify_handler] ❌ Handler is not a function");
      process.exit(1);
    }
    
    // Mock Next.js req/res
    const req = {
      method: "POST",
      body: {
        track: "Zia Park",
        raceNo: "2",
        date: "2025-12-02",
        dateIso: "2025-12-02",
        dateRaw: "12/02/2025",
        predicted: { win: "", place: "", show: "" },
      },
    };
    
    const res = {
      _status: 200,
      _json: null,
      _headers: {},
      status(code) {
        this._status = code;
        console.log(`[debug_verify_handler] res.status(${code}) called`);
        return this;
      },
      json(payload) {
        this._json = payload;
        console.log("[debug_verify_handler] res.json() called");
        console.log("[debug_verify_handler] Status:", this._status);
        console.log("[debug_verify_handler] Payload:", JSON.stringify(payload, null, 2));
        return this;
      },
      setHeader(name, value) {
        this._headers[name] = value;
        return this;
      },
    };
    
    console.log("[debug_verify_handler] Invoking handler with mock req/res...");
    
    await handler(req, res);
    
    console.log("[debug_verify_handler] ✅ Handler completed");
    console.log("[debug_verify_handler] Final status:", res._status);
    console.log("[debug_verify_handler] Has JSON payload:", !!res._json);
    
    if (res._status === 500) {
      console.error("[debug_verify_handler] ❌ Handler returned status 500!");
      process.exit(1);
    }
    
    if (!res._json) {
      console.error("[debug_verify_handler] ❌ Handler did not call res.json()!");
      process.exit(1);
    }
    
    // Validate required fields
    const required = ["ok", "step", "outcome", "debug"];
    const missing = required.filter(field => !(field in res._json));
    
    if (missing.length > 0) {
      console.error("[debug_verify_handler] ❌ Missing required fields:", missing);
      process.exit(1);
    }
    
    console.log("[debug_verify_handler] ✅ All required fields present");
    console.log("[debug_verify_handler] ok:", res._json.ok);
    console.log("[debug_verify_handler] step:", res._json.step);
    console.log("[debug_verify_handler] debug.backendVersion:", res._json.debug?.backendVersion);
    console.log("[debug_verify_handler] debug.handlerFile:", res._json.debug?.handlerFile);
    
  } catch (err) {
    console.error("[debug_verify_handler] ❌ INVOKE ERROR:");
    console.error("  Message:", err.message);
    console.error("  Stack:", err.stack);
    console.error("  Full error:", err);
    process.exit(1);
  }
})();

