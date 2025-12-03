#!/usr/bin/env node
/**
 * Debug script to test if pages/api/verify_race.js can be imported without throwing
 */

(async () => {
  try {
    console.log("[debug_verify_import] Attempting to import pages/api/verify_race.js...");
    
    const mod = await import("../../pages/api/verify_race.js");
    
    console.log("[debug_verify_import] ✅ Import OK");
    console.log("[debug_verify_import] Default export type:", typeof mod.default);
    console.log("[debug_verify_import] Config:", mod.config);
    
    if (typeof mod.default === "function") {
      console.log("[debug_verify_import] ✅ Handler is a function");
    } else {
      console.error("[debug_verify_import] ❌ Handler is not a function:", typeof mod.default);
    }
    
    console.log("[debug_verify_import] Module keys:", Object.keys(mod));
    
  } catch (err) {
    console.error("[debug_verify_import] ❌ IMPORT ERROR:");
    console.error("  Message:", err.message);
    console.error("  Stack:", err.stack);
    console.error("  Full error:", err);
    process.exit(1);
  }
})();

