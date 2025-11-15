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
  function getRaceNoInput(){
    return qs("#fl-race-number") || qs("input[placeholder*='race' i]") || qs("input[id*='race' i]") || qs("input[name*='race' i]");
  }
  function getRaceDateInput(){
    return qs("#fl-race-date");
  }
  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
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
    qsa("input[type='date'], input[placeholder*='date' i], input[id*='date' i], [data-field='date']").forEach(el=>{
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
      const trackEl=getTrackInput();
      const raceEl=getRaceNoInput();
      const dateEl=getRaceDateInput();
      const track=(trackEl&&trackEl.value||"").trim();
      const raceNo=(raceEl&&raceEl.value||"").trim();
      const date=(dateEl&&dateEl.value) ? dateEl.value : todayISO();
      if(!track){
        const wrap=(trackEl&&(trackEl.closest("label, .field, .form-group, .input, .row")||trackEl.parentElement))||document.body;
        let w=qs("#fl-track-warn",wrap);
        if(!w){w=document.createElement("div");w.id="fl-track-warn";w.style.cssText="margin-top:6px;color:#ffcc00;font:600 12px/1.2 system-ui";wrap.appendChild(w);} 
        w.textContent="Please enter/select a Track before verifying.";
        try{trackEl&&trackEl.focus();}catch{}
        return;
      }
      console.log("[verify-button] clicked", { track, date, raceNo });
      try{sessionStorage.setItem("fl:verify:ctx",JSON.stringify({track,raceNo:raceNo||undefined,date,ts:Date.now()}));}catch{}
      if(window.__FL_OPEN_VERIFY_MODAL__) {
        window.__FL_OPEN_VERIFY_MODAL__({ track, raceNo, date });
      } else {
        console.error("[verify-button] __FL_OPEN_VERIFY_MODAL__ is not defined");
      }
    });
    toolbar.appendChild(pill);
    log("verify pill mounted");
  }

  const mo=new MutationObserver(()=>mount());
  mo.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener("DOMContentLoaded",()=>mount(),{once:true});
  mount();
})();
