// FinishLine WPS — resilient Horse Data collector

window.FLForm = window.FLForm || {};

window.FLForm.collect = function collect() {
  const root = document.querySelector('[data-fl-horses]') || document.body;

  const inputs = [...root.querySelectorAll('input,textarea,select')].filter(el => el.offsetParent && el.type !== 'hidden');

  const rows = new Map();

  inputs.forEach(el => {
    const row = (el.closest('[data-horse-row]') || el.closest('[class*="row"],[class*="grid"],div')) || el;

    const key = row.getAttribute('data-horse-row') || Math.round(row.getBoundingClientRect().top / 8);

    if (!rows.has(key)) rows.set(key, []);

    rows.get(key).push(el);
  });

  const horses = [];

  [...rows.values()].forEach(cols => {
    const vals = cols.map(el => (el.value || '').trim()).filter(Boolean);

    if (vals.length >= 2) {
      const [name, odds, trainer = '', jockey = ''] = vals;

      if (/\d/.test(odds)) horses.push({ name, odds, trainer, jockey });
    }
  });

  const uniq = [];

  const seen = new Set();

  for (const h of horses) { if (h.name && !seen.has(h.name)) { seen.add(h.name); uniq.push(h); } }

  return { horses: uniq.slice(0, 12) };
};
