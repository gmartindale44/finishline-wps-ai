;(function(){
  if (typeof window==="undefined"||typeof document==="undefined") return;
  if (window.__FL_VERIFY_BTN__) return; window.__FL_VERIFY_BTN__=true;
  if (window.__flVerifyDebug===undefined) window.__flVerifyDebug=false;
  const log=(...a)=>{ try{ if(window.__flVerifyDebug) console.log("[FL:verify-btn]",...a);}catch{} };
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  
  try {
    console.log("[FL] verify-button wired");
  } catch {}

  console.log("[FL] verify-button.js loaded");

  function handleClick(event) {
    const btn = event.target.closest("[data-role='fl-open-verify']");
    if (!btn) return;

    console.log("[FL] Verify clicked");

    if (typeof window.__FL_OPEN_VERIFY_MODAL__ === "function") {
      // Collect initial values
      const trackInput =
        document.querySelector("[data-role='fl-track']") ||
        document.querySelector("#track") ||
        document.querySelector("input[placeholder*='track' i]") ||
        document.querySelector("input[id*='track' i]") ||
        document.querySelector("input[name*='track' i]");
      const raceInput =
        document.querySelector("[data-role='fl-race']") ||
        document.querySelector("#raceNo") ||
        document.querySelector("input[placeholder*='race' i]") ||
        document.querySelector("input[id*='race' i]") ||
        document.querySelector("input[name*='race' i]");

      const initial = {
        track: trackInput ? trackInput.value : "",
        raceNo: raceInput ? raceInput.value : ""
      };

      window.__FL_OPEN_VERIFY_MODAL__(initial);
    } else {
      console.error("[FL] ERROR: __FL_OPEN_VERIFY_MODAL__ missing");
    }
  }

  document.addEventListener("click", handleClick);

  // Also create Verify button dynamically if toolbar exists
  function mountVerifyButton() {
    const pills = Array.from(document.querySelectorAll("button, a")).filter(b => {
      const t = (b.textContent || "").trim().toLowerCase();
      return t === "copy" || t === "pin" || t === "new race";
    });
    if (!pills.length) return;
    const toolbar = pills[0].parentElement;
    if (!toolbar) return;
    if (document.querySelector("#fl-verify-pill")) return;

    const ref = pills.find(b => /new race/i.test((b.textContent || "").trim())) || pills[0];
    if (!ref) return;

    const pill=ref.cloneNode(true);
    pill.id="fl-verify-pill";
    pill.textContent="Verify";
    if(pill.tagName.toLowerCase()==="a") pill.removeAttribute("href");
    pill.addEventListener("click", (e)=>{
      e.preventDefault();
      const trackEl=getTrackInput();
      const raceEl=getRaceNoInput();
      const track=(trackEl&&trackEl.value||"").trim();
      const raceNo=(raceEl&&raceEl.value||"").trim();
      if(!track){
        const wrap=(trackEl&&(trackEl.closest("label, .field, .form-group, .input, .row")||trackEl.parentElement))||document.body;
        let w=qs("#fl-track-warn",wrap);
        if(!w){w=document.createElement("div");w.id="fl-track-warn";w.style.cssText="margin-top:6px;color:#ffcc00;font:600 12px/1.2 system-ui";wrap.appendChild(w);} 
        w.textContent="Please enter/select a Track before verifying.";
        try{trackEl&&trackEl.focus();}catch{}
        return;
      }
      try{sessionStorage.setItem("fl:verify:ctx",JSON.stringify({track,raceNo:raceNo||undefined,ts:Date.now()}));}catch{}
      try {
        console.log("[FL] Verify clicked");
      } catch {}
      if(typeof window !== "undefined" && typeof window.__FL_OPEN_VERIFY_MODAL__ === "function") {
        window.__FL_OPEN_VERIFY_MODAL__({ track, raceNo });
      } else {
        console.error("[FL] Verify modal function not available");
      }
    });
    toolbar.appendChild(pill);
  }

  const mo = new MutationObserver(() => mountVerifyButton());
  mo.observe(document.documentElement, { subtree: true, childList: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountVerifyButton, { once: true });
  } else {
    mountVerifyButton();
  }
})();
