// public/js/ui-utils.js
export function toast(msg, ms = 2100) {
  const el = document.getElementById('toast');
  if (!el) { console.log('[FLDBG] toast:', msg); return; }
  el.textContent = msg;
  el.style.display = 'block';
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease';
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; el.style.transition = ''; }, 250);
  }, ms);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
