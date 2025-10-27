// public/js/add-row.js
import { FL_SELECTORS, q, getHorseRows, wait, waitForNewRow } from './dom-map.js';

export async function addRowReliable() {
  const before = getHorseRows().length;
  const btn = q(FL_SELECTORS.addBtn);
  if (!btn) throw new Error('[FL] Add Horse button not found.');
  btn.click();

  // wait for UI to render a new row
  const added = await waitForNewRow(before, 3000);
  if (added) return;

  // fallback: if the framework swallowed the click, clone the last row
  console.warn('[FL] Add Horse click fallback: cloning last row.');
  const rows = getHorseRows();
  const last = rows.at(-1);
  if (!last) throw new Error('[FL] No row template to clone.');
  const clone = last.cloneNode(true);
  // clear inputs in cloned node
  clone.querySelectorAll('input').forEach(i => { i.value = ''; });
  last.parentElement.appendChild(clone);
  await wait(100);
}
