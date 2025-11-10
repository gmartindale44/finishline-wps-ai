;(function(){
  if (typeof window==="undefined"||typeof document==="undefined") return;
  if (window.__FL_TRACK_GUARD__) return; window.__FL_TRACK_GUARD__=true;

  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const qs=(s,r=document)=>r.querySelector(s);

  function getTrackInput() {
    return qs("input[placeholder*='track' i]") ||
           qs("input[id*='track' i]") ||
           qs("input[name*='track' i]");
  }

  function ensureWarn(container, msg) {
    let w = qs("#fl-track-warn", container || document);
    if (!w) {
      w = document.createElement("div");
      w.id = "fl-track-warn";
      w.style.cssText = "margin-top:6px;color:#ffcc00;font:600 12px/1.2 system-ui";
      (container||document.body).appendChild(w);
    }
    w.textContent = msg;
    w.style.display = "";
    return w;
  }

  function hideWarn() {
    const w = qs("#fl-track-warn"); if (w) w.style.display = "none";
  }

  function guard(e) {
    const track = getTrackInput();
    const val = (track && track.value || "").trim();
    if (!val) {
      e.preventDefault(); e.stopPropagation();
      const wrap = (track && (track.closest("label, .field, .form-group, .input, .row") || track.parentElement)) || document.body;
      ensureWarn(wrap, "Please enter/select a Track before continuing.");
      if (track) try { track.focus(); } catch {}
      return false;
    }
    hideWarn();
    return true;
  }

  function wire() {
    const candidates = ["button", "a", "input[type='submit']"];
    const labels = [/analy[sz]e/i, /predict/i, /run/i, /go/i];
    qsa(candidates.join(",")).forEach(btn=>{
      const txt = (btn.textContent||btn.value||"").trim();
      if (labels.some(rx=>rx.test(txt))) {
        if (!btn.__flGuarded) {
          btn.addEventListener("click", (e)=>guard(e), true);
          btn.__flGuarded = true;
        }
      }
    });
  }

  const mo = new MutationObserver(()=>wire());
  mo.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener("DOMContentLoaded", wire, { once:true });
  wire();
})();
