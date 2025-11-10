;(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_VERIFY_LOADER_ACTIVE__) return;
  window.__FL_VERIFY_LOADER_ACTIVE__ = true;

  if (window.__flVerifyDebug === undefined) window.__flVerifyDebug = false;
  const log = (...a) => { try { if (window.__flVerifyDebug) console.log("[FL:verify]", ...a); } catch {} };

  try { console.info("%c FinishLine Verify Loader r8 ", "background:#6b46c1;color:#fff;padding:2px 6px;border-radius:4px"); } catch {}

  const withPrefix = (p) => {
    try {
      const ap = (window.__NEXT_DATA__ && window.__NEXT_DATA__.assetPrefix) || "";
      return ap ? `${ap}${p}` : p;
    } catch { return p; }
  };

  // Tiny heartbeat
  try {
    const tag = document.createElement("div");
    tag.textContent = "VT";
    tag.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:2147483647;font:600 11px/1.2 system-ui;padding:4px 6px;border-radius:6px;color:#fff;background:#6b46c1;opacity:.9;pointer-events:none";
    const mount = () => { document.body && document.body.appendChild(tag); setTimeout(()=> tag.remove(), 2000); };
    (document.readyState === "loading") ? document.addEventListener("DOMContentLoaded", mount, { once:true }) : mount();
  } catch {}

  // Load verify-tab.js (cache-busted)
  const ensureVerifyTab = () => {
    const already = Array.from(document.scripts || []).some(s => (s.src||"").includes("/js/verify-tab.js"));
    if (!already) {
      const s = document.createElement("script");
      s.defer = true;
      s.src = withPrefix("/js/verify-tab.js?v=" + encodeURIComponent("v2025-11-10-8"));
      s.onload = () => log("verify-tab.js loaded");
      s.onerror = () => console.error("[FL:verify] verify-tab.js failed to load", s.src);
      document.head.appendChild(s);
    } else {
      log("verify-tab.js already present");
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureVerifyTab, { once:true });
  } else {
    ensureVerifyTab();
  }

  // IMPORTANT: disable FAB fallback by default (r8). Re-enable only if window.__flVerifyFab = true.
  window.__flVerifyFab = !!window.__flVerifyFab; // off unless set true manually
})();

