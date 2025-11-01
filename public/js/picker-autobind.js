// public/js/picker-autobind.js
(function () {
  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }

  ready(function () {
    // App-wide state (durable across UI mutations)
    window.__fl_state = window.__fl_state || { pickedFiles: [], analyzed:false, parsedHorses:null };

    function q(sel, root){ return (root||document).querySelector(sel); }

    function findInput(){
      // Prefer an input[type=file] within the Horse Data region; fallback to any file input.
      const horsePanels = Array.from(document.querySelectorAll('section,div,form,fieldset,main,article'));
      const panel = horsePanels.find(n => /horse\s*data/i.test((n.getAttribute('aria-label')||'') + ' ' + (n.querySelector('h2,h3,h4')?.textContent||'') + ' ' + (n.textContent||'').slice(0,200)));
      return (panel && panel.querySelector('input[type="file"]')) || q('input[type="file"]');
    }

    function findAnalyzeBtn(){
      return q('#analyze-btn,#analyze-with-ai,[data-analyze-btn]') ||
             Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"]'))
               .find(b => /analyze/i.test(b.value||b.textContent||''));
    }

    function findFileLabel(){
      return q('#file-selected-label,[data-file-selected-label]') ||
             Array.from(document.querySelectorAll('span,div,small,p'))
               .find(n => /no file selected|loaded\s+\d+\s*file/i.test((n.textContent||'').toLowerCase()));
    }

    function findChooseProxy(){
      return q('[data-fl-file-btn],[data-choose-file],[data-choose-photo]') ||
             Array.from(document.querySelectorAll('label,button,span,div,a'))
               .find(n => /choose\s*photos|choose\s*photo|choose\s*file|pdf/i.test((n.textContent||'').toLowerCase()));
    }

    function setAnalyzeEnabled(enable){
      const btn = findAnalyzeBtn();
      if (!btn) return;
      btn.disabled = !enable;
      btn.ariaDisabled = (!enable).toString();
      btn.classList.toggle('disabled', !enable);
    }

    function updateLabel(){
      const lbl = findFileLabel();
      const n = window.__fl_state.pickedFiles.length;
      if (lbl) lbl.textContent = n ? `Loaded ${n} file${n>1?'s':''}` : 'No file selected';
      setAnalyzeEnabled(n > 0);
    }

    function onFiles(files){
      window.__fl_state.pickedFiles = Array.from(files||[]);
      window.__fl_state.analyzed = false;
      updateLabel();
      console.log('[picker] files:', window.__fl_state.pickedFiles.map(f=>f.name));
    }

    function bindInput(input) {
      if (!input) return;
      const handler = () => onFiles(input.files);
      input.addEventListener('change', handler, true);
      input.addEventListener('input',  handler, true);
    }

    function bind(input){
      if (!input) return;

      // Defensive z-index/pointer events (non-invasive)
      input.style.pointerEvents = 'auto';
      input.style.position = input.style.position || 'relative';
      input.style.zIndex = Math.max( (parseInt(getComputedStyle(input).zIndex)||0), 10011 ).toString();

      // Robust event listeners
      const handler = () => onFiles(input.files);
      input.addEventListener('change', handler, true);
      input.addEventListener('input',  handler, true);

      // Proxy trigger always opens the native picker
      const proxy = findChooseProxy();
      if (proxy) {
        const open = (e) => {
          e && (e.preventDefault(), e.stopPropagation());
          try { input.value = ''; } catch {}
          if (typeof input.showPicker === 'function') input.showPicker(); else input.click();

          // Poll in case the site UI swallows the 'change' event
          let t=0; const id=setInterval(()=>{
            t++;
            if ((input.files||[]).length){ onFiles(input.files); clearInterval(id); }
            if (t>40) clearInterval(id);
          }, 50);
        };
        proxy.addEventListener('click', open, true);
        proxy.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ open(e); } }, true);
      }

      // Initial sync on first bind
      onFiles(input.files);
    }

    // Rebind on UI mutations (hot-reloads / partial rerenders)
    const mo = new MutationObserver(() => bind(findInput()));
    mo.observe(document.documentElement, { childList:true, subtree:true });

    bind(findInput());

    // DevTools helper
    window.__fl_diag = () => ({
      pickedFiles: window.__fl_state.pickedFiles.map(f=>({name:f.name,size:f.size})),
      analyzed: window.__fl_state.analyzed,
      parsedHorses: Array.isArray(window.__fl_state.parsedHorses) ? window.__fl_state.parsedHorses.length : 0
    });
  });
})();
