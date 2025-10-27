// public/js/dom-map.js
export const FL_SELECTORS = {
  addBtn: '#btn-add-horse, #addHorseBtn, button[data-action="add-horse"], button:has-text("Add Horse")',
  analyzeBtn: '#btn-analyze, #analyze-btn, button.analyze-btn',
  predictBtn: '#btn-predict, #predict-btn, button.predict-btn',
  // row inputs (per row wrapper)
  row: '.horse-row, .horse, .horse-form-row, .row.horse, [data-horse-row]',
  name: 'input[placeholder^="Horse Name" i], input[name^="horseName" i], input[name^="horse-name" i]',
  odds: 'input[placeholder^="ML Odds" i], input[name^="mlOdds" i], input[name^="ml-odds" i]',
  jockey: 'input[placeholder^="Jockey" i], input[name^="jockey" i], input[name^="horseJockey" i]',
  trainer: 'input[placeholder^="Trainer" i], input[name^="trainer" i], input[name^="horseTrainer" i]',
};

export function q(sel, root=document) { return root.querySelector(sel); }
export function qa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

export function getHorseRows() {
  // First try: rows with explicit row classes or attributes
  const explicit = qa(FL_SELECTORS.row);
  if (explicit.length) return explicit;
  
  // Second try: infer rows by finding name inputs
  const names = qa(FL_SELECTORS.name);
  if (!names.length) return [];
  
  // Find containers that hold all 4 inputs
  const rows = new Set();
  for (const name of names) {
    let node = name;
    while (node && node !== document.body) {
      const hasAll = 
        node.querySelector(FL_SELECTORS.name) &&
        node.querySelector(FL_SELECTORS.odds) &&
        node.querySelector(FL_SELECTORS.jockey) &&
        node.querySelector(FL_SELECTORS.trainer);
      if (hasAll) {
        rows.add(node);
        break;
      }
      node = node.parentElement;
    }
  }
  
  return Array.from(rows);
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
