// public/js/add-row.js
import { FL_SELECTORS, q, getHorseRows, wait, waitForNewRow } from './dom-map.js';

export async function addRowReliable() {
  const before = getHorseRows().length;
  console.log(`[FinishLine] Attempting to add row. Current count: ${before}`);
  
  const btn = q(FL_SELECTORS.addBtn);
  if (!btn) {
    console.error('[FinishLine] Add Horse button not found — check selector.');
    console.error('[FinishLine] Tried selectors:', FL_SELECTORS.addBtn);
    console.error('[FinishLine] Available buttons:', Array.from(document.querySelectorAll('button')).map(b => ({
      id: b.id, 
      text: b.textContent.trim(),
      classes: b.className
    })));
    throw new Error('[FinishLine] Add Horse button not found — check selector.');
  }
  
  console.log('[FinishLine] Clicking Add Horse button');
  btn.click();

  // wait for UI to render a new row
  const added = await waitForNewRow(before, 3000);
  if (added) {
    console.log(`[FinishLine] Successfully added row ${before + 1}`);
    return;
  }

  // fallback: if the framework swallowed the click, clone the last row
  console.warn('[FinishLine] Add Horse click fallback: cloning last row manually.');
  const rows = getHorseRows();
  const last = rows.at(-1);
  if (!last) throw new Error('[FinishLine] No row template to clone.');
  const clone = last.cloneNode(true);
  // clear inputs in cloned node
  clone.querySelectorAll('input').forEach(i => { i.value = ''; });
  last.parentElement.appendChild(clone);
  await wait(100);
  console.log(`[FinishLine] Manually cloned row. New count: ${getHorseRows().length}`);
}
