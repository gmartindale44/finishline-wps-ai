;(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_VERIFY_LOADER_ACTIVE__) return;
  window.__FL_VERIFY_LOADER_ACTIVE__ = true;

  // Debug toggle: set window.__flVerifyDebug = true in console
  if (window.__flVerifyDebug === undefined) window.__flVerifyDebug = false;
  const log = (...a) => { try { if (window.__flVerifyDebug) console.log("[FL:verify]", ...a); } catch {} };

  // Resolve base prefix to support basePath/assetPrefix
  const getPrefix = () => {
    try {
      const data = window.__NEXT_DATA__;
      if (data && typeof data.assetPrefix === "string") return data.assetPrefix || "";
    } catch {}
    return ""; // fallback: root
  };
  const prefix = getPrefix();
  const withPrefix = (p) => (prefix ? `${prefix}${p}` : p);

  // VT heartbeat
  try {
    const tag = document.createElement("div");
    tag.textContent = "VT";
    tag.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:99999;font:600 11px/1.2 system-ui;padding:4px 6px;border-radius:6px;color:#fff;background:#6b46c1;opacity:.9;pointer-events:none";
    const mount = () => { document.body && document.body.appendChild(tag); setTimeout(()=> tag.remove(), 3000); };
    (document.readyState === "loading") ? document.addEventListener("DOMContentLoaded", mount, { once:true }) : mount();
    log("Heartbeat badge mounted");
  } catch {}

  // Inject verify-tab.js with cache-bust
  const ensureVerifyTab = () => {
    const already = Array.from(document.scripts || []).some(s => (s.src||"").includes("/js/verify-tab.js"));
    if (!already) {
      const s = document.createElement("script");
      s.defer = true;
      s.src = withPrefix("/js/verify-tab.js?v=" + encodeURIComponent("v2025-11-10-6"));
      s.onload = () => log("verify-tab.js loaded");
      s.onerror = () => console.error("[FL:verify] verify-tab.js failed to load", s.src);
      document.head.appendChild(s);
      log("verify-tab.js injected", s.src);
    } else {
      log("verify-tab.js already present");
    }
  };

  // Fallback FAB if tab fails to mount in 2s
  const makeFab = () => {
    if (document.getElementById("__fl_verify_fab")) return;
    const btn = document.createElement("button");
    btn.id = "__fl_verify_fab";
    btn.textContent = "Verify";
    btn.style.cssText = [
      "position:fixed","right:16px","bottom:16px","z-index:99998",
      "padding:10px 14px","border-radius:999px","font:600 13px system-ui",
      "background:#6b46c1","color:#fff","border:none","box-shadow:0 6px 18px rgba(0,0,0,.25)",
      "cursor:pointer"
    ].join(";");
    btn.onclick = () => {
      try {
        if (window.__FL_OPEN_VERIFY_PANEL__) {
          window.__FL_OPEN_VERIFY_PANEL__();
          log("Opened verify panel via exported hook");
        } else {
          const q = prompt("Verify race (paste a query or leave blank to use current context):", "");
          if (q !== null) {
            fetch(withPrefix("/api/verify_race"), {
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body: JSON.stringify({ q })
            })
            .then(r=>r.json())
            .then(data=> alert("Verify posted.\n\n"+JSON.stringify(data).slice(0,600)))
            .catch(err=> alert("Verify failed: "+(err && err.message)));
          }
        }
      } catch(e) { console.error("[FL:verify] FAB click error", e); }
    };
    document.body.appendChild(btn);
    log("Fallback FAB mounted");
  };

  const ensureAll = () => { ensureVerifyTab(); setTimeout(makeFab, 2000); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureAll, { once:true });
  } else {
    ensureAll();
  }
})();

