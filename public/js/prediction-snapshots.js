;(function(){
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_SNAPSHOTS__) return; window.__FL_SNAPSHOTS__ = true;

  const today = new Date();
  const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const text = (selector) => {
    try { return (document.querySelector(selector)?.textContent || "").trim(); }
    catch { return ""; }
  };

  const numPercent = (selector) => {
    const raw = text(selector);
    const match = raw.match(/(\d+(?:\.\d+)?)%/);
    return match ? parseFloat(match[1]) : null;
  };

  function currentTrack(){
    const el = document.querySelector('input[placeholder*="search tracks"], input[name="track"], [data-field="track"] input');
    if (el && (el.value || el.getAttribute("value"))) return (el.value || el.getAttribute("value") || "").trim();
    const raw = text('#track') || text('[data-field="track"]');
    return raw.trim();
  }

  function currentRaceNo(){
    const explicit = text('[data-field="raceNo"], [data-field="race"]');
    if (explicit) return explicit;
    const input = document.querySelector('input[name*="race" i], input[id*="race" i]');
    return (input && input.value || "").trim();
  }

  function readSignals(){
    const confidence = numPercent('.strategy-card .confidence, [data-metric="confidence"]');
    const top3Mass   = numPercent('.strategy-card .top3mass, [data-metric="top3mass"]');
    const gap12      = numPercent('.strategy-card .gap12, [data-metric="gap12"]');
    const gap23      = numPercent('.strategy-card .gap23, [data-metric="gap23"]');
    return { confidence, top3Mass, gap12: gap12 || 0, gap23: gap23 || 0 };
  }

  function readPicks(){
    const cards = Array.from(document.querySelectorAll('.prediction-card, [data-pick]')).slice(0, 3);
    const names = cards.map((card) => (card.querySelector('b, .title, .name')?.textContent || "").trim());
    return { win: names[0] || "", place: names[1] || "", show: names[2] || "" };
  }

  function saveSnapshot(){
    const track = currentTrack();
    if (!track) return;

    const raceNo = currentRaceNo();
    const signals = readSignals();
    if (signals.confidence == null || signals.top3Mass == null) return;

    const picks = readPicks();
    const payload = { ts: Date.now(), date: dayKey, track, raceNo, signals, picks };
    const key = `fl:snap:${dayKey}:${track}:${raceNo || 'nr'}`;
    try { sessionStorage.setItem(key, JSON.stringify(payload)); }
    catch (error) { console.warn('[snapshots] failed to persist', error); }
  }

  const observer = new MutationObserver(() => saveSnapshot());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: false });

  function bindPredictButtons(){
    Array.from(document.querySelectorAll('button, a')).forEach((btn) => {
      if (btn.__flSnapBound) return;
      const label = (btn.textContent || btn.value || "").toLowerCase();
      if (/predict/.test(label) || /strategy/.test(label)) {
        btn.addEventListener('click', () => setTimeout(saveSnapshot, 600));
        btn.__flSnapBound = true;
      }
    });
  }

  bindPredictButtons();
  setInterval(bindPredictButtons, 2000);
})();
