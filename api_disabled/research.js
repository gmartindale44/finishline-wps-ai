export async function tavilyLookup(horses = [], meta = {}, { timeoutMs = 6000 } = {}) {
  try {
    const key = process.env.FINISHLINE_TAVILY_API_KEY;
    if (!key) return { notes: {}, used: false };
    const track = meta?.track || '';
    // Lightweight, single call prompt to keep latency reasonable.
    const q = [
      'horse racing recent form quick notes:',
      `track:${track}`,
      horses.slice(0, 12).map(h => h.name).join(', ')
    ].join(' ');
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ query: q, max_results: 6 })
    });
    const data = await res.json().catch(() => ({}));
    const joined = (data?.results || []).map(r => `${r.title} — ${r.snippet}`).join('\n');
    const perHorse = {};
    for (const h of horses) perHorse[h.name] = ''; // stash; fused later in LLM prompt
    return { notes: { _joined: joined }, used: true };
  } catch {
    return { notes: {}, used: false };
  }
}

export function impliedFromOdds(oddsStr = '') {
  // ML "A/B" -> implied 1/(A+B). E.g., 5/1 -> 1/6.
  const m = String(oddsStr).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return 0.08; // default mild outsider
  const a = Number(m[1]); const b = Number(m[2] || 1);
  const p = 1 / (a + b);
  return Math.max(0.02, Math.min(0.80, p));
}

export function normalizeProbs(names, baseMap) {
  let s = 0;
  for (const n of names) s += baseMap[n] ?? 0;
  if (s <= 0) {
    const u = 1 / names.length;
    const out = {}; names.forEach(n => out[n] = u); return out;
  }
  const out = {};
  names.forEach(n => out[n] = (baseMap[n] ?? 0) / s);
  return out;
}

