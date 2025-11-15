;(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_VERIFY_LOADER_ACTIVE__) return;
  window.__FL_VERIFY_LOADER_ACTIVE__ = true;

  if (window.__flVerifyDebug === undefined) window.__flVerifyDebug = false;

  try {
    console.info("%c FinishLine Verify Loader — modal gz-v2 ", "background:#6b46c1;color:#fff;padding:2px 6px;border-radius:4px");
  } catch {}

  const withPrefix = (p) => {
    try {
      const ap = (window.__NEXT_DATA__ && window.__NEXT_DATA__.assetPrefix) || "";
      return ap ? `${ap}${p}` : p;
    } catch { return p; }
  };

  try {
    const tag = document.createElement("div");
    tag.textContent = "VT";
    tag.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:2147483647;font:600 11px/1.2 system-ui;padding:4px 6px;border-radius:6px;color:#fff;background:#6b46c1;opacity:.9;pointer-events:none";
    const mount = () => { document.body && document.body.appendChild(tag); setTimeout(()=> tag.remove(), 1200); };
    (document.readyState === "loading") ? document.addEventListener("DOMContentLoaded", mount, { once:true }) : mount();
  } catch {}

  const inject = (src) => new Promise((res, rej) => {
    if ([...document.scripts].some(s => (s.src||"").includes(src.split("?")[0]))) return res();
    const s = document.createElement("script");
    s.defer = true; s.src = withPrefix(src);
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  const run = async () => {
    try { await inject("/js/track-guard.js?v=v2025-11-10-21"); } catch {}
    try { await inject("/js/verify-button.js?v=v2025-11-10-21"); } catch {}
    try { await inject("/js/verify-modal.js?v=v2025-11-14-datefix-final3"); } catch {}
    try { await inject("/js/green-zone-panel.js?v=v2025-11-10-21"); } catch {}
    try { await inject("/js/prediction-snapshots.js?v=v2025-11-10-21"); } catch {}
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once:true });
  } else {
    run();
  }
})();

