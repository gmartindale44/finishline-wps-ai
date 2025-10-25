// public/js/horse-form.js
import { sleep, toast } from './ui-utils.js';

const ROW_SELECTORS = {
  name:   'input[name="horseName"]',
  odds:   'input[name="mlOdds"]',
  jockey: 'input[name="horseJockey"]',
  trainer:'input[name="horseTrainer"]',
};

function getRowsRoot() {
  const root = document.getElementById('horse-rows') || document;
  return root;
}

export function getHorseRows() {
  // Every row is a container that includes the 4 inputs above.
  const root = getRowsRoot();
  // Find rows by the presence of a horseName input
  const nameInputs = [...root.querySelectorAll(ROW_SELECTORS.name)];
  // Map each name input to its row container (closest common parent form group)
  return nameInputs.map(inp => inp.closest('.horse-row') || inp.parentElement.closest('div') || inp.parentElement);
}

export function ensureRowCount(n) {
  const addBtn = document.getElementById('btn-add-horse');
  if (!addBtn) { console.warn('[FLDBG] Missing #btn-add-horse'); return; }
  return new Promise(async (resolve) => {
    let tries = 0;
    while (getHorseRows().length < n && tries < n + 6) {
      addBtn.click();
      await sleep(60);
      tries++;
    }
    resolve();
  });
}

function setInput(row, sel, val) {
  const el = row.querySelector(sel);
  if (!el) return;
  el.value = val ?? '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function fillRowsFromHorses(horses) {
  if (!horses || !horses.length) {
    console.log('[FLDBG] fillRowsFromHorses: no horses');
    toast('No horses detected in the image');
    return;
  }
  console.log('[FLDBG] Horses to fill:', horses.length, horses);

  // Make sure we have enough rows
  await ensureRowCount(horses.length);

  const rows = getHorseRows();
  const count = Math.min(horses.length, rows.length);

  for (let i = 0; i < count; i++) {
    const h = horses[i] || {};
    const row = rows[i];
    setInput(row, ROW_SELECTORS.name,   h.name ?? '');
    setInput(row, ROW_SELECTORS.odds,   h.odds ?? '');
    setInput(row, ROW_SELECTORS.jockey, h.jockey ?? '');
    setInput(row, ROW_SELECTORS.trainer,h.trainer ?? '');
    console.log(`[FLDBG] Row ${i+1} filled:`, h);
    await sleep(30);
  }

  toast(`Added ${count} horse${count>1?'s':''} from image`);
}

export function readRowsToJson() {
  const rows = getHorseRows();
  const data = rows.map((row, idx) => {
    const name   = (row.querySelector(ROW_SELECTORS.name)?.value || '').trim();
    const odds   = (row.querySelector(ROW_SELECTORS.odds)?.value || '').trim();
    const jockey = (row.querySelector(ROW_SELECTORS.jockey)?.value || '').trim();
    const trainer= (row.querySelector(ROW_SELECTORS.trainer)?.value || '').trim();
    return { idx, name, odds, jockey, trainer };
  }).filter(r => r.name || r.odds || r.jockey || r.trainer);
  return data;
}
