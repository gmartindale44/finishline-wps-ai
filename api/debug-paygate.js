// api/debug-paygate.js
// Re-export handler from pages/api to ensure Vercel routes correctly
// Vercel prioritizes root /api over pages/api, so we need this shim

export { default } from "../pages/api/debug-paygate.js";

