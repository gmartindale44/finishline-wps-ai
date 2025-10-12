// Simple smoke test; replace with your real UI wiring.
const $ = (s)=>document.querySelector(s);
const statusEl = $('#status');

async function ping(url, label){
  if (!statusEl) return;
  statusEl.textContent = `${label}…`;
  try {
    const r = await fetch(url, { method:'POST' });
    if (r.ok) {
      statusEl.textContent = `${label}: OK`;
    } else {
      statusEl.textContent = `${label}: ${r.status}`;
    }
  } catch (e) {
    statusEl.textContent = `${label}: network error`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-extract')?.addEventListener('click', ()=> ping('/api/extract/smoke', 'Extract'));
  $('#btn-analyze')?.addEventListener('click', ()=> ping('/api/research/smoke', 'Analyze'));
  $('#btn-predict')?.addEventListener('click', ()=> ping('/api/predict/smoke', 'Predict'));
  
  console.log('✓ FinishLine UI loaded');
});
