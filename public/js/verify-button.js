;(function(){
  if (typeof window==="undefined"||typeof document==="undefined") return;
  if (window.__FL_VERIFY_BTN__) return; window.__FL_VERIFY_BTN__=true;
  if (window.__flVerifyDebug===undefined) window.__flVerifyDebug=false;
  const log=(...a)=>{ try{ if(window.__flVerifyDebug) console.log("[FL:verify-btn]",...a);}catch{} };
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));

  function getTrackInput(){
    return qs("#race-track") || qs("input[placeholder*='track' i]") || qs("input[id*='track' i]") || qs("input[name*='track' i]");
  }
  function getRaceDateInput(){
    return qs("#fl-race-date");
  }
  function getRaceNoInput(){
    return qs("#fl-race-number") || qs("input[placeholder*='race' i]") || qs("input[id*='race' i]") || qs("input[name*='race' i]");
  }
  function todayISO() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function findToolbar(){
    const pills = qsa("button, a").filter(b=>{
      const t=(b.textContent||"").trim().toLowerCase();
      return t==="copy"||t==="pin"||t==="new race";
    });
    if(!pills.length) return null;
    return pills[0].parentElement;
  }

  function ensureWarn(trackEl){
    const wrap = (trackEl && (trackEl.closest("label, .field, .form-group, .input, .row") || trackEl.parentElement)) || document.body;
    let w = qs("#fl-track-warn", wrap);
    if (!w) {
      w = document.createElement("div");
      w.id = "fl-track-warn";
      w.style.cssText = "margin-top:6px;color:#ffcc00;font:600 12px/1.2 system-ui";
      wrap.appendChild(w);
    }
    w.textContent = "Please enter/select a Track before verifying.";
    w.style.display = "";
  }

  function hideDate(){
    // Hide old date fields but NOT our new fl-race-date field
    qsa("input[type='date'], input[placeholder*='date' i], input[id*='date' i], [data-field='date']").forEach(el=>{
      // Skip our new main form date field
      if (el.id === "fl-race-date") return;
      const wrap=el.closest("label, .field, .form-group, .input, .row")||el;
      wrap.style.display="none";
    });
  }

  function mount(){
    hideDate();
    const toolbar=findToolbar(); if(!toolbar)return;
    if(qs("#fl-verify-pill",toolbar))return;

    const ref = qsa("button, a", toolbar).find(b=>/new race/i.test((b.textContent||"").trim())) || qsa("button, a", toolbar)[0];
    if(!ref)return;

    const pill=ref.cloneNode(true);
    pill.id="fl-verify-pill";
    pill.textContent="Verify";
    if(pill.tagName.toLowerCase()==="a") pill.removeAttribute("href");
    pill.addEventListener("click", (e)=>{
      e.preventDefault();
      const trackEl = getTrackInput();
      const raceDateEl = getRaceDateInput();
      const raceNoEl = getRaceNoInput();
      const track = (trackEl && trackEl.value || "").trim();
      let date = (raceDateEl && raceDateEl.value) ? raceDateEl.value.trim() : null;
      const raceNo = (raceNoEl && raceNoEl.value || "").trim();
      
      // If date is blank, default to today
      if (!date) {
        date = todayISO();
      }
      
      if(!track){
        const wrap=(trackInput&&(trackInput.closest("label, .field, .form-group, .input, .row")||trackInput.parentElement))||document.body;
        let w=qs("#fl-track-warn",wrap);
        if(!w){w=document.createElement("div");w.id="fl-track-warn";w.style.cssText="margin-top:6px;color:#ffcc00;font:600 12px/1.2 system-ui";wrap.appendChild(w);} 
        w.textContent="Please enter/select a Track before verifying.";
        try{trackInput&&trackInput.focus();}catch{}
        return;
      }
      
      // Log the click
      console.log("[verify-button] clicked", { track, date, raceNo });
      
      // Save to sessionStorage
      try{
        sessionStorage.setItem("fl:verify:last", JSON.stringify({ track, date, raceNo, ts: Date.now() }));
      } catch {}
      
      // Check if modal opener is available
      if (!window.__FL_OPEN_VERIFY_MODAL__) {
        console.error("[verify-button] __FL_OPEN_VERIFY_MODAL__ is not defined");
        return;
      }
      
      // Open the modal with context
      window.__FL_OPEN_VERIFY_MODAL__({ track, date, raceNo });
    });
    toolbar.appendChild(pill);
    log("verify pill mounted");
    console.log("[verify-button] mounted");
  }

  const mo=new MutationObserver(()=>mount());
  mo.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener("DOMContentLoaded",()=>mount(),{once:true});
  mount();
})();
