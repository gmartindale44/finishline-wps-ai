const out = document.getElementById('out');
const run = async (url) => {
  out.textContent = `POST ${url}…`;
  try {
    const r = await fetch(url, {method:'POST'});
    const t = await r.text();
    out.textContent = `${r.status} ${r.statusText}\n\n${t}`;
  } catch (e) {
    out.textContent = `Network error: ${e}`;
  }
};
document.getElementById('btn-extract').onclick = ()=>run('/api/extract/smoke');
document.getElementById('btn-analyze').onclick = ()=>run('/api/research/smoke');
document.getElementById('btn-predict').onclick = ()=>run('/api/predict/smoke');
