/**
 * Verify Tab – adds a first-class verification workflow inside the Predictions modal.
 * - Mounts a new tab beside the existing ones (Strategy, etc.).
 * - Prefills race context from the page but allows user edits.
 * - Calls /api/verify_race and renders results (top 5) with cache awareness.
 * - Guards against duplicate mounts and survives modal re-renders.
 */
(() => {
  const BOOT_ATTR = "data-fl-verify-boot";
  if (document.documentElement.hasAttribute(BOOT_ATTR)) return;
  document.documentElement.setAttribute(BOOT_ATTR, "1");

  // Small helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const text = (el) => (el?.textContent || "").trim();

  function findTabsRoot() {
    // Tabs container in Predictions modal header (existing three tabs)
    // Adjust selectors only if your structure changes.
    return $(".fl-predictions-tabs") ||
           $(".predictions header nav") ||
           $(".predictions nav") ||
           $$(".predictions").find(el => $$(".tab", el).length >= 3) ||
           null;
  }

  function findPanelsRoot() {
    // The container that holds the content panels for the tabs
    return $(".fl-predictions-panels") ||
           $(".predictions .panels") ||
           $(".predictions") ||
           null;
  }

  function currentContext() {
    // Pull context from visible UI. Prompt fallback happens in action.
    const ctx = {};
    ctx.track =
      $("[data-track]")?.getAttribute("data-track") ||
      text($(".fl-track-name")) ||
      text($("header .track-name")) ||
      "";

    const raceStr =
      text($(".fl-race-no")) ||
      text($("[data-race]")) ||
      text($("[data-race-number]")) ||
      "";
    const m =
      raceStr.match(/\bRace\s*#?\s*(\d+)\b/i) ||
      raceStr.match(/\bR(\d+)\b/i) ||
      raceStr.match(/\b(\d+)\b/);
    ctx.raceNo = m ? m[1] : "";

    // Format YYYY-MM-DD. If not present, default to today
    ctx.date = $("[data-race-date]")?.getAttribute("data-race-date") || "";
    if (!ctx.date) {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      ctx.date = `${d.getFullYear()}-${mm}-${dd}`;
    }

    ctx.distance = text($(".fl-distance")) || "";
    ctx.surface = text($(".fl-surface")) || "";
    ctx.strategy =
      text($(".fl-strategy-active")) ||
      text($(".fl-strategy-name")) ||
      "";

    const picks = $$(".fl-pick, [data-fl-pick]")
      .map((el) => text(el))
      .filter(Boolean);
    ctx.ai_picks = picks.join(" | ");
    return ctx;
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  }

  function ensureVerifyTab() {
    const tabsRoot = findTabsRoot();
    const panelsRoot = findPanelsRoot();
    if (!tabsRoot || !panelsRoot) return false;

    // If the tab already exists, don’t duplicate
    if ($('[data-tab-id="verify"]', tabsRoot)) return true;

    // Create the tab
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.type = "button";
    tab.textContent = "Verify";
    tab.setAttribute("data-tab-id", "verify");
    tab.style.marginLeft = "6px";

    // Create the panel (hidden by default)
    const panel = document.createElement("div");
    panel.className = "panel fl-verify-panel";
    panel.setAttribute("data-panel-id", "verify");
    panel.style.display = "none";
    panel.innerHTML = `
      <div class="fl-card" style="margin-top:12px">
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div>
            <label>Track</label>
            <input id="flv-track" class="fl-input" style="min-width:220px" />
          </div>
          <div>
            <label>Race #</label>
            <input id="flv-race" class="fl-input" style="width:90px" />
          </div>
          <div>
            <label>Date (YYYY-MM-DD)</label>
            <input id="flv-date" class="fl-input" style="width:150px" />
          </div>
          <button id="flv-run" class="fl-btn">Verify result</button>
        </div>
        <div id="flv-status" style="margin-top:12px;font-size:0.95rem;opacity:0.9"></div>
        <div id="flv-output" class="fl-code" style="margin-top:8px;white-space:pre-wrap"></div>
      </div>
    `;

    tabsRoot.appendChild(tab);
    panelsRoot.appendChild(panel);

    // Tab switching (simple, non-invasive)
    const allTabs = $$('[data-tab-id]', tabsRoot);
    const allPanels = $$('[data-panel-id]', panelsRoot);
    function show(id) {
      allTabs.forEach((t) =>
        t.toggleAttribute('data-active', t.getAttribute('data-tab-id') === id)
      );
      allPanels.forEach((p) => {
        p.style.display = p.getAttribute('data-panel-id') === id ? '' : 'none';
      });
    }
    tab.addEventListener('click', () => show('verify'));

    // Seed inputs from current UI context
    const ctx = currentContext();
    panel.querySelector('#flv-track').value = ctx.track || '';
    panel.querySelector('#flv-race').value = ctx.raceNo || '';
    panel.querySelector('#flv-date').value = ctx.date || '';

    // Wire the action button
    const btn = panel.querySelector('#flv-run');
    const status = panel.querySelector('#flv-status');
    const out = panel.querySelector('#flv-output');

    btn.onclick = async () => {
      try {
        btn.disabled = true;
        status.textContent = 'Running…';
        out.textContent = '';

        const payload = {
          track: panel.querySelector('#flv-track').value.trim(),
          raceNo: panel.querySelector('#flv-race').value.trim(),
          date: panel.querySelector('#flv-date').value.trim(),
          distance: ctx.distance || '',
          surface: ctx.surface || '',
          strategy: ctx.strategy || '',
          ai_picks: ctx.ai_picks || '',
        };
        if (!payload.track || !payload.raceNo || !payload.date)
          throw new Error('Track, race #, and date are required.');

        const res = await postJSON('/api/verify_race', payload);
        status.textContent = `OK — ${res.count ?? (res.items?.length ?? 0)} results`;
        const top = res.top || res.topHit || {};
        out.textContent =
          [
            `Query: ${res.query || "(built from inputs)"}`,
            top.title ? `Top: ${top.title}` : "",
            top.link ? `Link: ${top.link}` : "",
          ]
            .filter(Boolean)
            .join("\n") || JSON.stringify(res, null, 2);
      } catch (e) {
        status.textContent = `Failed — ${e.message || e}`;
      } finally {
        btn.disabled = false;
      }
    };

    return true;
  }

  // Keep trying until the modal mounts
  const iv = setInterval(() => {
    if (ensureVerifyTab()) clearInterval(iv);
  }, 300);
})();
