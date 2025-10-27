// public/js/dom-map.js
export const FL_SELECTORS = {
  addBtn: '#add-horse-btn, button#add-horse-btn, button.add-horse, button:has-text("Add Horse")',
  analyzeBtn: '#analyze-btn, button#btn-analyze-ai, button.analyze-btn',
  predictBtn: '#predict-btn, button#btn-predict-wps, button.predict-btn',
  // row inputs (per row wrapper)
  row: '.horse-row, .horse, .horse-form-row, .row.horse',
  name: 'input[placeholder^="Horse Name" i], input[name="horse-name"], input.horse-name',
  odds: 'input[placeholder^="ML Odds" i], input[name="ml-odds"], input.ml-odds',
  jockey: 'input[placeholder^="Jockey" i], input[name="jockey"], input.jockey',
  trainer: 'input[placeholder^="Trainer" i], input[name="trainer"], input.trainer',
};

export function q(sel, root=document) { return root.querySelector(sel); }
export function qa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

export function getHorseRows() {
  // rows are any containers that have at least the name input
  const all = qa(FL_SELECTORS.row);
  if (all.length) return all;
  // fallback: infer rows by finding name inputs and using their closest row-ish container
  const names = qa(FL_SELECTORS.name);
  if (!names.length) return [];
  return names.map(el => el.closest('.horse-row, .horse, .row, form, .grid, .flex') ?? el.parentElement);
}

export function getRowFields(row) {
  return {
    name: q(FL_SELECTORS.name, row),
    odds: q(FL_SELECTORS.odds, row),
    jockey: q(FL_SELECTORS.jockey, row),
    trainer: q(FL_SELECTORS.trainer, row),
  };
}

export const wait = (ms) => new Promise(r => setTimeout(r, ms));

export async function waitForNewRow(startCount, timeoutMs=4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getHorseRows().length > startCount) return true;
    await wait(120);
  }
  return false;
}
