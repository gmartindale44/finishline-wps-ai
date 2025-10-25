/* public/js/horse-populate-hotfix.js
   Robust, zero-config filler that:
   - Finds the horse row inputs by placeholder text (no ids needed)
   - Clicks "Add Horse" by text if #btn-add-horse is missing
   - Adds rows as needed, then fills every horse
   - Never touches race date/track/surface/distance
*/

const SELS = {
  name:   'input[placeholder^="Horse Name" i],input[aria-label^="Horse Name" i]',
  odds:   'input[placeholder^="ML Odds" i],input[aria-label^="ML Odds" i]',
  jockey: 'input[placeholder^="Jockey" i],input[aria-label^="Jockey" i]',
  trainer:'input[placeholder^="Trainer" i],input[aria-label^="Trainer" i]',
};

function q(root, sel){ return root.querySelector(sel); }
function qa(root, sel){ return Array.from(root.querySelectorAll(sel)); }

function addHorseBtn() {
  // Prefer id if present
  const byId = document.getElementById('btn-add-horse');
  if (byId) return byId;
  // Fallback: find a button whose visible text contains "Add Horse"
  const btns = qa(document, 'button, [role="button"]');
  return btns.find(b => (b.textContent||'').trim().toLowerCase() === 'add horse');
}

function firstRowRoot() {
  // Try to find a common container that holds the *first* row inputs
  // Using the name input as the anchor.
  const firstName = document.querySelector(SELS.name);
  if (!firstName) return null;
  // Climb until we find a block that also contains the other inputs
  let node = firstName;
  while (node && node !== document.body) {
    const hasAll =
      q(node, SELS.name) && q(node, SELS.odds) &&
      q(node, SELS.jockey) && q(node, SELS.trainer);
    // must not be the whole document; prefer a smaller block
    if (hasAll && node.querySelectorAll(SELS.name).length === 1) return node;
    node = node.parentElement;
  }
  // fallback to the nearest ancestor that has all four (even if it has more)
  node = firstName;
  while (node && node !== document.body) {
    const hasAll =
      q(node, SELS.name) && q(node, SELS.odds) &&
      q(node, SELS.jockey) && q(node, SELS.trainer);
    if (hasAll) return node;
    node = node.parentElement;
  }
  return null;
}

function allRowRoots() {
  // We consider each "row" to be the nearest ancestor wrapping one set of the 4 inputs.
  const names = qa(document, SELS.name);
  return names.map(n => {
    let node = n;
    while (node && node !== document.body) {
      const hasAll =
        q(node, SELS.name) && q(node, SELS.odds) &&
        q(node, SELS.jockey) && q(node, SELS.trainer);
      if (hasAll) return node;
      node = node.parentElement;
    }
    return n; // worst case: use the input itself
  });
}

function setVal(input, val) {
  if (!input) return;
  input.value = val ?? '';
  input.dispatchEvent(new Event('input',  { bubbles:true }));
  input.dispatchEvent(new Event('change', { bubbles:true }));
}

async function ensureRowCount(n) {
  let rows = allRowRoots();
  const btn = addHorseBtn();
  let guard = 0;
  while (rows.length < n && btn && guard < n + 8) {
    btn.click();
    await new Promise(r => setTimeout(r, 60));
    rows = allRowRoots();
    guard++;
  }
}

export async function fillAllHorses(horses) {
  try {
    if (!Array.isArray(horses) || horses.length === 0) {
      console.log('[FLDBG] hotfix: no horses to fill');
      return;
    }
    console.log('[FLDBG] hotfix: will fill', horses.length, 'horses');

    // make sure at least first row exists
    if (!firstRowRoot()) {
      console.warn('[FLDBG] hotfix: could not locate first row inputs (by placeholder).');
      return;
    }

    await ensureRowCount(horses.length);
    const rows = allRowRoots();
    const count = Math.min(horses.length, rows.length);

    for (let i=0; i<count; i++){
      const row = rows[i];
      const h = horses[i] || {};
      setVal(q(row, SELS.name),    h.name ?? '');
      setVal(q(row, SELS.odds),    h.odds ?? '');
      setVal(q(row, SELS.jockey),  h.jockey ?? '');
      setVal(q(row, SELS.trainer), h.trainer ?? '');
      console.log(`[FLDBG] hotfix: filled row ${i+1}`, h);
      await new Promise(r => setTimeout(r, 25));
    }
    console.log('[FLDBG] hotfix: done.');
  } catch (e) {
    console.error('[FLDBG] hotfix error:', e);
  }
}

// Convenience to test quickly from DevTools:
// window.FL_FILL = fillAllHorses;
