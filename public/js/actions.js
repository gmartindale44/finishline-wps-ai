// public/js/actions.js
import { collectHorsesFromDOM } from './horses-dom-collector.js';
import { toast } from './ui-utils.js';

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

function bindAction(id, url, emptyMsg) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const horses = collectHorsesFromDOM();
    if (!horses.length) { toast(emptyMsg || 'Add at least one horse'); return; }
    btn.disabled = true;
    btn.dataset.loading = '1';
    try {
      console.log(`[FLDBG] POST ${url}`, horses);
      const { ok, status, json } = await postJSON(url, { horses });
      if (!ok) {
        console.warn(`[FLDBG] ${url} failed`, status, json);
        toast(`Error ${status} from ${url}`);
        alert(`Request to ${url} failed (${status}). Check logs.`);
      } else {
        console.log(`[FLDBG] ${url} ok`, json);
        toast('Done');
        // If backend returns predictions, you could render them here.
      }
    } catch (e) {
      console.error(`[FLDBG] ${url} exception`, e);
      toast('Unexpected error');
      alert('Unexpected error — see console for details.');
    } finally {
      btn.disabled = false;
      btn.dataset.loading = '';
    }
  });
}

export function initActions() {
  bindAction('btn-analyze', '/api/analyze', 'No horses to analyze');
  bindAction('btn-predict', '/api/predict', 'No horses to predict');
}
