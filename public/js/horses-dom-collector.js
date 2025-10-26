// Read visible inputs as the single source of truth so actions work
// whether rows were typed or autofilled by OCR.
const HSEL = {
  name:    'input[placeholder^="Horse Name" i],input[aria-label^="Horse Name" i]',
  odds:    'input[placeholder^="ML Odds" i],input[aria-label^="ML Odds" i]',
  jockey:  'input[placeholder^="Jockey" i],input[aria-label^="Jockey" i]',
  trainer: 'input[placeholder^="Trainer" i],input[aria-label^="Trainer" i]',
};

function _read(el) { return (el && el.value || '').trim(); }

function _normalizeOdds(raw) {
  if (!raw) return '';
  // Accept "5-2", "9/2", "10-1", "15/1" (normalize spacing/dashes)
  const s = raw.replace(/\s+/g, '')
               .replace(/[–—]/g, '-')   // long dashes -> hyphen
               .replace(/:/g, '-')      // colon -> hyphen (rare)
               .replace(/\\/g, '/')     // stray backslash -> slash
  ;
  return /^(\d+[-/]\d+)$/.test(s) ? s : raw.trim();
}

function _findRowRoots() {
  // Find each "row" by walking up from each name input until a container that
  // holds all four fields is found.
  const names = Array.from(document.querySelectorAll(HSEL.name));
  return names.map(n => {
    let node = n;
    while (node && node !== document.body) {
      const ok = node.querySelector(HSEL.name)
             &&  node.querySelector(HSEL.odds)
             &&  node.querySelector(HSEL.jockey)
             &&  node.querySelector(HSEL.trainer);
      if (ok) return node;
      node = node.parentElement;
    }
    return n; // fallback to the input itself
  });
}

export function collectHorsesFromDOM() {
  const rows = _findRowRoots();
  const horses = rows.map(row => {
    const name    = _read(row.querySelector(HSEL.name));
    const oddsRaw = _read(row.querySelector(HSEL.odds));
    const jockey  = _read(row.querySelector(HSEL.jockey));
    const trainer = _read(row.querySelector(HSEL.trainer));
    const odds    = _normalizeOdds(oddsRaw);
    return { name, odds, jockey, trainer };
  }).filter(h => h.name || h.odds || h.jockey || h.trainer);

  // Require at least name + odds to consider valid for actions.
  const valid = horses.filter(h => h.name && h.odds);
  window.FL_HORSES = valid; // debug visibility
  console.log('[FLDBG] DOM collector found', valid.length, 'horses:', valid);
  return valid;
}
