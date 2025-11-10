(function () {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    // Prevent duplicate execution across routers or navigations
    if (window.__FL_VERIFY_LOADED__) return;
    window.__FL_VERIFY_LOADED__ = true;

    // Visual heartbeat so we know loader executed in production
    try {
      const tag = document.createElement("div");
      tag.textContent = "VT";
      tag.style.cssText = [
        "position:fixed",
        "right:8px",
        "bottom:8px",
        "z-index:99999",
        "font:600 11px/1.2 system-ui",
        "padding:4px 6px",
        "border-radius:6px",
        "color:#fff",
        "background:#6b46c1",
        "opacity:.9",
        "pointer-events:none",
      ].join(";");
      const mount = () => {
        if (!document.body) return;
        document.body.appendChild(tag);
        setTimeout(() => { if (tag && tag.parentNode) tag.parentNode.removeChild(tag); }, 3000);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mount, { once: true });
      } else {
        mount();
      }
    } catch (e) {
      // non-fatal
    }

    // Inject verify-tab.js (cache-busted) if not already present
    const already = Array.from(document.scripts || []).some((s) =>
      (s.src || "").includes("/js/verify-tab.js")
    );
    if (!already) {
      const s = document.createElement("script");
      s.defer = true;
      s.src = "/js/verify-tab.js?v=" + encodeURIComponent("v2025-11-10-4");
      document.head.appendChild(s);
    }
  } catch (e) {
    // non-fatal
  }
})();
