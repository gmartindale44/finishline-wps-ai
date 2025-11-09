// public/js/dom-map.js
export const FL_SELECTORS = {
  addBtn: [
    '#add-horse-btn',
    '#btn-add-horse',
    '#addHorseBtn',
    'button#add-horse-btn',
    'button.add-horse',
    'button.btn[type="button"]',
    '[data-action="add-horse"]'
  ].join(','),
  analyzeBtn: '#analyze-btn, button#analyze-btn, button:has-text("Analyze Photos")',
  predictBtn: '#predict-btn, button#predict-btn, button:has-text("Predict W/P/S")',
  // row inputs (per row wrapper)
  row: '.horse-row, .horse, .row, .form-row, .input-group, [data-horse-row]',
  name: 'input[placeholder^="Horse" i], input[placeholder^="Horse Name" i]',
  odds: 'input[placeholder^="ML Odds" i]',
  jockey: 'input[placeholder^="Jockey" i]',
  trainer: 'input[placeholder^="Trainer" i]',
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
