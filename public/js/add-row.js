// public/js/add-row.js
import { FL_SELECTORS, q, getHorseRows, wait, waitForNewRow } from './dom-map.js';

export async function addRowReliable() {
  const before = getHorseRows().length;
  console.log(`[FinishLine] Attempting to add row. Current count: ${before}`);
  
  const btn = q(FL_SELECTORS.addBtn);
  if (!btn) {
    console.error('[FinishLine] Add Horse button not found. Buttons present:', [...document.querySelectorAll('button')].map(b => b.textContent.trim()));
    throw new Error('Add Horse button selector failed');
  }

  btn.click();
  console.log(`[FinishLine] Clicked Add Horse (row ${before + 1})`);

  // wait for UI to render a new row with extended timeout
  for (let i = 0; i < 25; i++) {
    await wait(200);
    const current = getHorseRows().length;
    if (current > before) {
      console.log(`[FinishLine] Confirmed new row added (${current} total)`);
      return;
    }
  }

  // fallback: clone the last row if click didn't work
  console.warn('[FinishLine] Fallback cloning last row...');
  const rows = getHorseRows();
  const last = rows.at(-1);
  if (last) {
    const clone = last.cloneNode(true);
    clone.querySelectorAll('input').forEach(i => (i.value = ''));
    last.parentElement.appendChild(clone);
    console.log(`[FinishLine] Cloned row. New count: ${getHorseRows().length}`);
  }
}
