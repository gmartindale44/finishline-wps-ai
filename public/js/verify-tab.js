;(function(){
  if(typeof window==="undefined"||typeof document==="undefined")return;
  if(window.__FL_VERIFY_TAB__)return;window.__FL_VERIFY_TAB__=true;
  if(window.__flVerifyDebug===undefined)window.__flVerifyDebug=false;
  const log=(...a)=>{try{if(window.__flVerifyDebug)console.log("[FL:verify-tab]",...a);}catch{}}
  const qs=(s,r=document)=>r.querySelector(s);
  const qsa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const withPrefix=p=>{try{const ap=(window.__NEXT_DATA__&&window.__NEXT_DATA__.assetPrefix)||"";return ap?`${ap}${p}`:p;}catch{return p;}}

  function hideDate(){qsa("input[type='date'],input[placeholder*='date' i],input[id*='date' i],[data-field='date']").forEach(el=>{(el.closest("label,.field,.form-group,.input,.row")||el).style.display="none";});}
  function getTrackInput(){return qs("input[placeholder*='track' i]")||qs("input[id*='track' i]")||qs("input[name*='track' i]");}
  function getRaceInput(){return qs("input[placeholder*='race' i]")||qs("input[id*='race' i]")||qs("input[name*='race' i]");}

  function findTabSystem(){
    let tablist=qs('[role="tablist"]');
    let tabs=tablist?qsa('[role="tab"]',tablist):[];
    if(!tablist||tabs.length<2){
      const cands=qsa("nav,.tabs,[data-tabs],.toolbar,header");
      for(const el of cands){
        const labels=qsa("button,a,[role='tab'],[data-tab]",el).map(n=>(n.textContent||"").trim().toLowerCase());
        if(labels.some(t=>["predictions","exotic ideas","strategy"].includes(t))){tablist=el;tabs=qsa("button,a,[role='tab'],[data-tab]",el);break;}
      }
    }
    if(!tablist)return null;
    let contentRoot=tablist.parentElement;
    const panels=qsa('[role="tabpanel"],.tab-panel,.panel,.card',contentRoot);
    if(panels.length)contentRoot=panels[0].parentElement||contentRoot;
    return{tablist,tabs,contentRoot};
  }

  function setAria(tab,selected){tab.setAttribute("role","tab");tab.setAttribute("aria-selected",selected?"true":"false");tab.setAttribute("tabindex",selected?"0":"-1");}
  function deselectAll(tablist){qsa('[role="tab"],button,a,[data-tab]',tablist).forEach(t=>{setAria(t,false);t.classList.remove("is-active","active","selected");});}
  function hideAllPanels(root){qsa('[role="tabpanel"],.tab-panel,[data-panel]',root).forEach(p=>{p.style.display="none";p.setAttribute("aria-hidden","true");});}

  function makePanel(root){
    let panel=qs("#fl-verify-panel");
    if(panel)return panel;
    const styled=qs('[role="tabpanel"],.tab-panel,.panel,.card',root);
    panel=document.createElement("div");
    panel.id="fl-verify-panel";
    panel.setAttribute("role","tabpanel");
    panel.setAttribute("aria-labelledby","fl-verify-tab");
    panel.className=styled?(styled.className||""):"tab-panel";
    panel.style.display="none";
    panel.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;font:600 16px/1.2 system-ui">Verify Race</h3>
        <small id="flv-status" style="opacity:.8"></small>
      </div>
      <div style="display:grid;gap:10px;margin-bottom:12px;grid-template-columns:1fr auto;">
        <div>
          <label style="display:block;margin:0 0 6px 0;opacity:.9">Track <span style="color:#ffcc00">*</span></label>
          <input id="flv-track" type="text" placeholder="Track" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit"/>
          <small id="flv-track-warn" style="display:none;color:#ffcc00">Enter/select a Track before verifying.</small>
        </div>
        <div style="min-width:120px">
          <label style="display:block;margin:0 0 6px 0;opacity:.9">Race # (optional)</label>
          <input id="flv-race" type="text" placeholder="e.g. 6" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit"/>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
        <button id="flv-run" style="padding:8px 12px;border-radius:8px;border:none;background:#6b46c1;color:#fff;font-weight:600">Verify Now</button>
        <small style="opacity:.75">Track auto-filled from the top field; Race # helps context.</small>
      </div>
      <details id="flv-summary" open>
        <summary style="cursor:pointer;opacity:.9">Summary</summary>
        <div id="flv-summary-body" style="margin-top:8px"></div>
      </details>
      <details id="flv-raw">
        <summary style="cursor:pointer;opacity:.9">Raw</summary>
        <pre id="flv-raw-body" style="max-height:260px;overflow:auto;margin:8px 0 0;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font:12px/1.5 ui-monospace, Menlo, Consolas"></pre>
      </details>
    `;
    root.appendChild(panel);

    const topTrack=getTrackInput();
    const topRace=getRaceInput();
    if(topTrack&&topTrack.value)qs("#flv-track",panel).value=topTrack.value.trim();
    if(topRace&&topRace.value)qs("#flv-race",panel).value=topRace.value.trim();

    const status=qs("#flv-status",panel),raw=qs("#flv-raw-body",panel),sum=qs("#flv-summary-body",panel),warn=qs("#flv-track-warn",panel);
    qs("#flv-run",panel).addEventListener("click",async()=>{
      const track=qs("#flv-track",panel).value.trim();
      const raceNo=qs("#flv-race",panel).value.trim();
      if(!track){warn.style.display="";qs("#flv-track",panel).focus();return;}else warn.style.display="none";
      try{
        status.textContent="Running…";raw.textContent="";sum.innerHTML="";
        const resp=await fetch(withPrefix("/api/verify_race"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({track,raceNo:raceNo||undefined})});
        const data=await resp.json().catch(()=>({}));
        status.textContent=resp.ok?"OK":`Error ${resp.status}`;
        raw.textContent=JSON.stringify(data,null,2);
        const parts=[];
        if(data.query)parts.push(`<div><b>Query:</b> ${data.query}</div>`);
        if(data.count!==undefined)parts.push(`<div><b>Matches:</b> ${data.count}</div>`);
        if(data.top&&data.top.title)parts.push(`<div><b>Top Result:</b> ${data.top.title}</div>`);
        if(data.summary)parts.push(`<div>${data.summary}</div>`);
        sum.innerHTML=parts.join("")||"<em>No summary returned.</em>";
      }catch(e){status.textContent="Error";raw.textContent=String(e&&e.message||e);console.error(e);}
    });
    return panel;
  }

  function ensureVerifyTab(sys){
    const { tablist, tabs, contentRoot } = sys;
    let strategy=tabs.find(t=>/strategy/i.test((t.textContent||"").trim()))||tabs[tabs.length-1];
    if(!strategy)return;

    let verifyTab=qs("#fl-verify-tab",tablist);
    if(!verifyTab){
      verifyTab=strategy.cloneNode(true);
      verifyTab.id="fl-verify-tab";
      verifyTab.textContent="Verify";
      if(verifyTab.tagName.toLowerCase()==="a")verifyTab.removeAttribute("href");
      setAria(verifyTab,false);
      verifyTab.classList.remove("is-active","active","selected");
      strategy.after(verifyTab);
    }else{
      verifyTab.className=strategy.className;
      setAria(verifyTab,false);
    }

    const panel=makePanel(contentRoot);
    const open=()=>{
      hideDate();
      const topTrack=getTrackInput();
      const topRace=getRaceInput();
      if(topTrack&&topTrack.value)qs("#flv-track",panel).value=topTrack.value.trim();
      if(topRace&&topRace.value)qs("#flv-race",panel).value=topRace.value.trim();
      deselectAll(tablist);
      hideAllPanels(contentRoot);
      setAria(verifyTab,true);
      verifyTab.classList.add("active","is-active","selected");
      panel.style.display=""; panel.removeAttribute("aria-hidden");
      try{qs("#flv-track",panel).focus();}catch{}
    };
    verifyTab.addEventListener("click",open);
    verifyTab.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
    window.__FL_OPEN_VERIFY_PANEL__=open;
  }

  function mount(){
    hideDate();
    const sys=findTabSystem();
    if(sys)ensureVerifyTab(sys);
  }

  const mo=new MutationObserver(()=>mount());
  mo.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener("DOMContentLoaded",()=>{hideDate();mount();},{once:true});
  hideDate();mount();
})();
