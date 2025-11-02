// public/js/table.js - Table rendering and reading helpers

(function () {
  'use strict';

  // Get the container for horse rows
  function getContainer() {
    return document.getElementById('horse-rows') || document.querySelector('.rows');
  }

  // Get the Add Horse button
  function getAddButton() {
    return document.getElementById('add-row-btn') || document.getElementById('add-horse-btn') || document.querySelector('[data-add-horse]');
  }

  // Create a single horse row element
  function createRow(horse = {}, index = 0) {
    const row = document.createElement('div');
    row.className = 'horse-row';
    row.setAttribute('data-horse-row', String(index));
    
    // Normalize horse data (case-insensitive keys)
    const h = normalizeHorse(horse);
    
    row.innerHTML = `
      <input type="text" class="input" data-field="name" placeholder="Horse Name" value="${escapeHtml(h.name)}" />
      <input type="text" class="input" data-field="odds" placeholder="ML Odds (e.g., 5/1)" value="${escapeHtml(h.odds)}" />
      <input type="text" class="input" data-field="jockey" placeholder="Jockey" value="${escapeHtml(h.jockey)}" />
      <input type="text" class="input" data-field="trainer" placeholder="Trainer" value="${escapeHtml(h.trainer)}" />
    `;
    
    return row;
  }

  // Normalize horse object keys (handle OCR variations)
  function normalizeHorse(horse) {
    if (!horse || typeof horse !== 'object') return { name: '', odds: '', jockey: '', trainer: '' };
    
    // Case-insensitive lookup
    const lower = {};
    for (const [k, v] of Object.entries(horse)) {
      lower[k.toLowerCase()] = v;
    }
    
    return {
      name: String(lower.name || lower.horse || lower.runner || ''),
      odds: String(lower.odds || lower.ml_odds || lower.price || lower.odd || ''),
      jockey: String(lower.jockey || lower.rider || lower.j || ''),
      trainer: String(lower.trainer || lower.trainer_name || lower.t || ''),
    };
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Clear all horse rows
  function clearHorseTable() {
    const container = getContainer();
    if (container) {
      container.innerHTML = '';
    }
  }

  // Render horses to the table
  function renderHorsesToTable(horses) {
    if (!Array.isArray(horses) || horses.length === 0) {
      clearHorseTable();
      return 0;
    }

    const container = getContainer();
    if (!container) {
      console.error('[table.js] Container #horse-rows not found');
      return 0;
    }

    clearHorseTable();

    let rendered = 0;
    for (let i = 0; i < horses.length; i++) {
      const row = createRow(horses[i], i);
      container.appendChild(row);
      rendered++;
    }

    return rendered;
  }

  // Read horses from the table
  function readHorsesFromTable() {
    const container = getContainer();
    if (!container) return [];

    const rows = container.querySelectorAll('.horse-row, [data-horse-row]');
    const horses = [];

    for (const row of rows) {
      const nameInput = row.querySelector('[data-field="name"]') || row.querySelector('.horse-name, input[placeholder*="Name" i]');
      const oddsInput = row.querySelector('[data-field="odds"]') || row.querySelector('.horse-odds, input[placeholder*="Odds" i]');
      const jockeyInput = row.querySelector('[data-field="jockey"]') || row.querySelector('.horse-jockey, input[placeholder*="Jockey" i]');
      const trainerInput = row.querySelector('[data-field="trainer"]') || row.querySelector('.horse-trainer, input[placeholder*="Trainer" i]');

      const name = (nameInput?.value || '').trim();
      const odds = (oddsInput?.value || '').trim();

      // Only include rows with at least a name and odds
      if (name && odds) {
        horses.push({
          name,
          odds,
          jockey: (jockeyInput?.value || '').trim(),
          trainer: (trainerInput?.value || '').trim(),
        });
      }
    }

    return horses;
  }

  // Normalize odds format (convert "8-5", "5/1", decimal to fractional string)
  function normalizeOdds(oddsStr) {
    if (!oddsStr || typeof oddsStr !== 'string') return '';
    
    const s = oddsStr.trim();
    
    // Already fractional: "5/1", "8/5"
    if (/^\d+\s*\/\s*\d+$/.test(s)) {
      return s.replace(/\s+/g, '');
    }
    
    // Dash format: "8-5", "5-2"
    if (/^\d+\s*-\s*\d+$/.test(s)) {
      return s.replace(/\s*-\s*/, '/');
    }
    
    // Decimal: "3.5", "6.0"
    const dec = parseFloat(s);
    if (!isNaN(dec) && dec > 0) {
      // Convert decimal to fractional (simplified)
      // 3.5 -> 5/2, 6.0 -> 5/1, etc.
      if (dec === Math.floor(dec)) {
        return `${Math.round(dec - 1)}/1`;
      }
      // For now, return as-is if complex decimal
      return s;
    }
    
    return s;
  }

  // Export to window for global access
  window.__fl_table = {
    renderHorsesToTable,
    readHorsesFromTable,
    clearHorseTable,
    normalizeOdds,
    getContainer,
    getAddButton,
  };
})();

