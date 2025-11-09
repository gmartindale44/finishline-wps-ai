// public/js/horses-dom-collector.js
import { getHorseRows, getRowFields } from './dom-map.js';

export function collectHorsesFromDOM() {
  const rows = getHorseRows();
  const out = [];
  for (const row of rows) {
    const f = getRowFields(row);
    const name = f.name?.value?.trim();
    const odds = f.odds?.value?.trim();
    const jockey = f.jockey?.value?.trim();
    const trainer = f.trainer?.value?.trim();
    // ignore empty rows (prevents "No horses to analyze")
    if (name || odds || jockey || trainer) {
      out.push({ name, odds, jockey, trainer });
    }
  }
  console.log('[FLDBG] DOM collector found', out.length, 'horses:', out);
  return out;
}

// Export to window for global access
window.collectHorsesFromDOM = collectHorsesFromDOM;