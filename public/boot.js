// public/boot.js
(() => {
  const VER = "boot@1.0.0";
  const LOG = (...a) => console.log("[BOOT]", ...a);
  const ERR = (...a) => console.error("[BOOT]", ...a);

  // Global error surfacing
  window.addEventListener("error", (e) => {
    ERR("window error:", e?.message, e?.error);
    try { alert(`Script error: ${e?.message || e}`); } catch {}
  });
  window.addEventListener("unhandledrejection", (e) => {
    ERR("unhandled rejection:", e?.reason);
    try { alert(`Unhandled error: ${e?.reason?.message || e?.reason}`); } catch {}
  });

  function byId(id){ return document.getElementById(id); }
  function setStatus(msg){ const s=byId("picker-status"); if(s) s.textContent=msg||""; LOG("status:", msg); }

  // Hardened binding (safe to call multiple times)
  function bindOnce(el, type, handler) {
    if (!el) return;
    el.removeEventListener(type, handler);
    el.addEventListener(type, handler);
  }

  async function onChooseClick() {
    try {
      LOG("Choose clicked");
      const input = byId("photo-input-main");
      if (!input) throw new Error("photo-input-main missing");
      input.value = "";          // allow reselect same file
      input.click();             // open OS picker
    } catch (e) {
      ERR("onChooseClick:", e);
      alert(`Open dialog error: ${e?.message || e}`);
    }
  }

  async function onFileSelected(ev) {
    try {
      const files = ev?.target?.files || [];
      LOG("onFileSelected count=", files.length);
      if (!files.length) { setStatus("No file selected."); return; }

      const f = files[0];
      LOG("file:", { name: f.name, type: f.type, size: f.size });
      setStatus("Ready to send file (frontend OK).");
      // NOTE: We do not POST here; your main app's logic should do it.
      // This boot layer proves events are firing — if nothing else happens,
      // the problem is in the main app flow (payload shape or API handler).
    } catch (e) {
      ERR("onFileSelected:", e);
      alert(`File select error: ${e?.message || e}`);
    } finally {
      try { ev.target.value = ""; } catch {}
    }
  }

  function onAnalyze(){ LOG("Analyze clicked"); alert("Analyze button is wired. Hand off to app logic here."); }
  function onPredict(){ LOG("Predict clicked"); alert("Predict button is wired. Hand off to app logic here."); }
  function onAddHorse(){ LOG("Add Horse clicked"); alert("Add Horse button is wired. Hand off to app logic here."); }

  function initUI() {
    LOG(`initUI ${VER}`);
    const btnPick = byId("choose-photos-btn");
    const input   = byId("photo-input-main");
    const btnAna  = byId("analyze-btn");
    const btnPre  = byId("predict-btn");
    const btnAdd  = byId("add-horse-btn");

    // Clear 'disabled' accidentally left by earlier state
    [btnPick, btnAna, btnPre, btnAdd].forEach(btn => btn && btn.removeAttribute("disabled"));

    bindOnce(btnPick, "click", onChooseClick);
    if (input) {
      bindOnce(input, "change", onFileSelected);
      bindOnce(input, "input",  onFileSelected); // extra guard
    }
    bindOnce(btnAna, "click", onAnalyze);
    bindOnce(btnPre, "click", onPredict);
    bindOnce(btnAdd, "click", onAddHorse);

    const debug = new URLSearchParams(location.search).get("debug") === "ui";
    if (debug) {
      LOG("debug=ui → dump elements:", { btnPick, input, btnAna, btnPre, btnAdd });
      const badge = document.createElement("div");
      badge.textContent = "UI DEBUG MODE";
      Object.assign(badge.style, { position:"fixed", right:"8px", bottom:"8px", padding:"4px 6px", background:"#2b2d31", color:"#fff", fontSize:"12px", borderRadius:"4px", zIndex:99999 });
      document.body.appendChild(badge);
    }

    setStatus("");
    LOG("UI wired successfully.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUI, { once:true });
  } else {
    initUI();
  }
})();
