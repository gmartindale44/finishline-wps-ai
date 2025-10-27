// public/js/horse-populate-hotfix.js
import { q, qa, getHorseRows, getRowFields, wait } from './dom-map.js';
import { addRowReliable } from './add-row.js';

function sanitize(v) { return (v ?? '').toString().trim(); }

export async function fillAllHorses(horses) {
  console.log('[FL] will fill', horses.length, 'horses.');
  if (!horses?.length) throw new Error('[FL] No horses to fill.');

  // Debug: list all available buttons
  console.log('[DEBUG] Available buttons:', [...document.querySelectorAll('button')].map(b => b.textContent.trim()));

  // never touch race fields — only row inputs:
  for (let i = 0; i < horses.length; i++) {
    const h = horses[i];
    // ensure row exists
    let rows = getHorseRows();
    while (rows.length <= i) {
      await addRowReliable();
      rows = getHorseRows();
    }
    const row = rows[i];
    const { name, odds, jockey, trainer } = getRowFields(row);

    if (!name || !odds || !jockey || !trainer) {
      console.warn('[FL] Missing inputs on row', i, '-- retrying row creation');
      await addRowReliable();
      rows = getHorseRows();
      const r2 = rows[i];
      const f2 = getRowFields(r2);
      if (!f2.name || !f2.odds || !f2.jockey || !f2.trainer) {
        throw new Error('[FL] Inputs still missing after fallback on row ' + i);
      }
    }

    // now set values (guard nulls)
    getRowFields(rows[i]).name.value   = sanitize(h.name);
    getRowFields(rows[i]).odds.value   = sanitize(h.odds);
    getRowFields(rows[i]).jockey.value = sanitize(h.jockey);
    getRowFields(rows[i]).trainer.value= sanitize(h.trainer);

    console.log(`[FL] filled row ${i}:`, {
      name: h.name, odds: h.odds, jockey: h.jockey, trainer: h.trainer
    });

    await wait(60);
  }

  console.log('[FL] Population complete — rows visible:', getHorseRows().length);
}