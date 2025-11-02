// FinishLine WPS — Resilient Horse Data collector

// Turns the visible "Horse Data" grid into { horses: [{name, odds, trainer, jockey}] }

// Works even if markup shifts between previews.

(function () {
  function findHorsePanel() {
    // Prefer an explicit marker if present
    const marker = document.querySelector('[data-fl-horses]');
    if (marker) return marker;

    // Fallback: locate by heading text
    const nodes = [...document.querySelectorAll('*')];
    const hit = nodes.find(n => /horse\s*data/i.test(n.textContent || ''));
    return hit ? hit.closest('section,div,form') || hit.parentElement : document.body;
  }

  function bucketByRow(elems) {
    const buckets = new Map();
    elems.forEach(el => {
      const rowEl = el.closest('[data-horse-row]') || el.closest('[class*="row"],[class*="grid"]') || el.parentElement || el;
      const key = rowEl.getAttribute && rowEl.getAttribute('data-horse-row') || Math.round(rowEl.getBoundingClientRect().top / 8);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(el);
    });
    return [...buckets.values()];
  }

  function scrapeHorses(root) {
    const inputs = [...root.querySelectorAll('input,textarea,select')]
      .filter(el => el && el.offsetParent && el.type !== 'hidden');
    const rows = bucketByRow(inputs);
    const horses = [];

    rows.forEach(cols => {
      const vals = cols.map(el => (el.value || '').trim()).filter(Boolean);
      // Heuristic: [name, odds, trainer?, jockey?] — keep if odds looks numeric/fractional
      if (vals.length >= 2 && /\d/.test(vals[1])) {
        const [name, odds, trainer = '', jockey = ''] = vals;
        horses.push({ name, odds, trainer, jockey });
      }
    });

    // Deduplicate by name, keep order, max 12
    const seen = new Set();
    const uniq = [];
    for (const h of horses) {
      if (h.name && !seen.has(h.name)) {
        seen.add(h.name);
        uniq.push(h);
      }
    }
    return uniq.slice(0, 12);
  }

  window.FLForm = window.FLForm || {};
  window.FLForm.collect = function collect() {
    const root = findHorsePanel();
    const horses = scrapeHorses(root);
    return { horses };
  };

  // Debug hook
  console.debug('[FL] form-collector loaded');
})();
