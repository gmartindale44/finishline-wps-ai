/* public/js/horse-populate-hotfix.js
   Robust, zero-config filler that:
   - Finds the horse row inputs by placeholder text (no ids needed)
   - Clicks "Add Horse" by text if #btn-add-horse is missing
   - Adds rows as needed, then fills every horse
   - Never touches race date/track/surface/distance
*/

// Helper functions
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function qs(sel, root = document) { return root.querySelector(sel); }
function q(root, sel){ return root.querySelector(sel); }
function qa(root, sel){ return Array.from(root.querySelectorAll(sel)); }

const FL_SELECTORS = {
  addBtn: '#btn-add-horse, button#add-horse, button.add-horse',
  name:    'input[placeholder^="Horse Name" i],input[aria-label^="Horse Name" i]',
  odds:    'input[placeholder^="ML Odds" i],input[aria-label^="ML Odds" i]',
  jockey:  'input[placeholder^="Jockey" i],input[aria-label^="Jockey" i]',
  trainer: 'input[placeholder^="Trainer" i],input[aria-label^="Trainer" i]',
};

const SELS = {
  name:   'input[placeholder^="Horse Name" i],input[aria-label^="Horse Name" i]',
  odds:   'input[placeholder^="ML Odds" i],input[aria-label^="ML Odds" i]',
  jockey: 'input[placeholder^="Jockey" i],input[aria-label^="Jockey" i]',
  trainer:'input[placeholder^="Trainer" i],input[aria-label^="Trainer" i]',
};

// Returns an array of "row" roots, one per horse row (group that contains all 4 inputs)
function getHorseRows() {
  // Strategy 1: group by parent containers that hold all 4 inputs
  const nameInputs = qsa(FL_SELECTORS.name);
  const rows = [];
  for (const n of nameInputs) {
    let node = n;
    while (node && node !== document.body) {
      const hasAll = node.querySelector(FL_SELECTORS.name)
        && node.querySelector(FL_SELECTORS.odds)
        && node.querySelector(FL_SELECTORS.jockey)
        && node.querySelector(FL_SELECTORS.trainer);
      if (hasAll) { rows.push(node); break; }
      node = node.parentElement;
    }
  }
  // Deduplicate
  return Array.from(new Set(rows));
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForRowCount(target, timeoutMs = 4000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const rows = getHorseRows();
    if (rows.length >= target) return rows;
    await wait(50);
  }
  throw new Error(`[hotfix] timeout waiting for row count ${target}`);
}

function getRowInputs(row) {
  return {
    name:    row.querySelector(FL_SELECTORS.name),
    odds:    row.querySelector(FL_SELECTORS.odds),
    jockey:  row.querySelector(FL_SELECTORS.jockey),
    trainer: row.querySelector(FL_SELECTORS.trainer),
  };
}

function setVal(input, value) {
  if (!input) return;
  input.value = value ?? '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function normOdds(raw) {
  if (!raw) return '';
  return raw.replace(/\s+/g, '')
            .replace(/[–—]/g, '-')
            .replace(/:/g, '-')
            .replace(/\\/g, '/');
}

async function fillRowByIndex(index, horse) {
  const rows = getHorseRows();
  const row = rows[index];
  if (!row) throw new Error(`[hotfix] row ${index} not found`);
  const { name, odds, jockey, trainer } = getRowInputs(row);
  setVal(name, horse.name || '');
  setVal(odds, normOdds(horse.odds || ''));
  setVal(jockey, horse.jockey || '');
  setVal(trainer, horse.trainer || '');
  console.log('[hotfix] filled row', index, 'horse:', horse.name);
}

async function clickAddHorse() {
  // Prefer id/class if present; otherwise find by text
  let btn = qs(FL_SELECTORS.addBtn);
  if (!btn) {
    // fallback: find any button whose textContent includes "Add Horse"
    btn = Array.from(document.querySelectorAll('button')).find(b => /add\s*horse/i.test(b.textContent || ''));
  }
  if (!btn) throw new Error('[hotfix] Add Horse button not found');
  btn.click();
}

// Main population function
async function populateAllHorses(horses) {
  if (!Array.isArray(horses) || !horses.length) {
    console.warn('[hotfix] no horses to populate');
    return;
  }
  console.log('[hotfix] will fill', horses.length, 'horses');

  // Ensure at least one row is present (the first row already exists)
  await waitForRowCount(1);

  for (let i = 0; i < horses.length; i++) {
    if (i === 0) {
      // Fill the initial row
      await fillRowByIndex(0, horses[0]);
    } else {
      // Create a new row and wait for it to exist
      await clickAddHorse();
      await waitForRowCount(i + 1);
      await fillRowByIndex(i, horses[i]);
    }
    // Small pacing delay to let UI reflect changes
    await wait(60);
  }

  // Post-population: refresh collector so Analyze/Predict see all rows
  try {
    const all = window.collectHorsesFromDOM ? window.collectHorsesFromDOM() : [];
    console.log('[hotfix] done. DOM shows', all.length, 'horses');
  } catch (e) {
    console.warn('[hotfix] collector refresh failed', e);
  }
}

export async function fillAllHorses(horses) {
  return populateAllHorses(horses);
}

// Convenience to test quickly from DevTools:
// window.FL_FILL = fillAllHorses;