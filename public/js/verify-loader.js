;(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_VERIFY_LOADER_ACTIVE__) return;
  window.__FL_VERIFY_LOADER_ACTIVE__ = true;

  if (window.__flVerifyDebug === undefined) window.__flVerifyDebug = false;
  const log = (...a) => { try { if (window.__flVerifyDebug) console.log("[FL:loader]", ...a); } catch {} };
  try { console.info("%c FinishLine Verify Loader — page r1 ", "background:#6b46c1;color:#fff;padding:2px 6px;border-radius:4px"); } catch {}

  const withPrefix = (p) => {
    try {
      const ap = (window.__NEXT_DATA__ && window.__NEXT_DATA__.assetPrefix) || "";
      return ap ? `${ap}${p}` : p;
    } catch { return p; }
  };
  const inject = (src) => new Promise((res, rej) => {
    if ([...document.scripts].some(s => (s.src||"").includes(src.split("?")[0]))) return res();
    const s = document.createElement("script");
    s.defer = true; s.src = withPrefix(src);
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  const run = async () => {
    try { await inject("/js/track-guard.js?v=v2025-11-10-11"); } catch {}
    try { await inject("/js/verify-button.js?v=v2025-11-10-11"); } catch {}
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once:true });
  } else {
    run();
  }
})();

