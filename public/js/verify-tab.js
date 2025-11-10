;(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_VERIFY_TAB_ACTIVE__) return;
  window.__FL_VERIFY_TAB_ACTIVE__ = true;

  // Small debug logger (toggle in console: window.__flVerifyDebug = true)
  if (window.__flVerifyDebug === undefined) window.__flVerifyDebug = false;
  const log = (...a) => { try { if (window.__flVerifyDebug) console.log("[FL:verify-tab]", ...a); } catch {} };

  const onReady = (fn) => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once:true });
    else fn();
  };

  function qsa(root, sel){ return Array.from((root||document).querySelectorAll(sel)); }
  function qs(root, sel){ return (root||document).querySelector(sel); }

  // Heuristics to find the tablist and content area used by Predictions/Exotic Ideas/Strategy
  function findTabSystem() {
    // Prefer explicit WAI-ARIA tablist
    let tablist = qs(document, '[role="tablist"]');
    let tabs = tablist ? qsa(tablist, '[role="tab"]') : [];

    // Fallback: locate by visible labels
    if (!tablist || tabs.length < 2) {
      const candidates = qsa(document, "nav, .tabs, [class*='tab'], [data-tabs], header, .toolbar");
      for (const el of candidates) {
        const texts = qsa(el, "button, a, [role='tab'], [data-tab]").map(n => (n.textContent||"").trim().toLowerCase());
        if (texts.includes("predictions") || texts.includes("exotic ideas") || texts.includes("strategy")) {
          tablist = el;
          tabs = qsa(el, "button, a, [role='tab'], [data-tab]");
          break;
        }
      }
    }
    if (!tablist || tabs.length === 0) return null;

    // Find the main panel area by walking down from something that contains the Strategy panel
    // Grab a visible panel near the tablist
    let contentRoot = null;
    const containers = [tablist.parentElement, tablist.closest("section, main, .card, .panel, .content, .container")].filter(Boolean);
    for (const c of containers) {
      // look for the currently active panel (sibling of others)
      const panels = qsa(c, '[role="tabpanel"], .tab-panel, .panel, [data-panel]');
      if (panels.length) { contentRoot = panels[0].parentElement || c; break; }
    }
    // last resort: find the first big content card near tablist
    if (!contentRoot) contentRoot = tablist.parentElement || document.body;

    return { tablist, tabs, contentRoot };
  }

  function copyInactiveClassFrom(tabEl) {
    // Copy className & relevant ARIA attrs from a sibling (e.g., Strategy) to match styling
    const cls = tabEl.className || "";
    const attrs = {};
    for (const a of tabEl.getAttributeNames ? tabEl.getAttributeNames() : []) {
      if (a.startsWith("data-")) attrs[a] = tabEl.getAttribute(a);
    }
    return { className: cls, dataAttrs: attrs };
  }

  function setAria(tab, selected) {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.setAttribute("tabindex", selected ? "0" : "-1");
  }

  function hideAllPanels(root) {
    const panels = qsa(root, '[role="tabpanel"], .tab-panel, [data-panel]');
    panels.forEach(p => {
      p.style.display = "none";
      p.setAttribute("aria-hidden", "true");
    });
  }

  function deselectAllTabs(tablist) {
    const allTabs = qsa(tablist, '[role="tab"], button, a, [data-tab]');
    allTabs.forEach(t => {
      setAria(t, false);
      t.classList.remove("is-active", "active", "selected");
    });
  }

  function makeVerifyPanel(contentRoot) {
    let panel = document.getElementById("fl-verify-panel");
    if (panel) return panel;

    // Try to clone styling from an existing panel to match theme
    let styledPanel = qs(contentRoot, '[role="tabpanel"], .tab-panel, .panel, .card');
    const baseClass = styledPanel ? (styledPanel.className || "") : "tab-panel";
    panel = document.createElement("div");
    panel.id = "fl-verify-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "fl-verify-tab");
    panel.className = baseClass;
    panel.style.display = "none";

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;font:600 16px/1.2 system-ui">Verify Race</h3>
        <small id="fl-verify-status" style="opacity:.8"></small>
      </div>
      <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;">
        <input id="fl-verify-q" type="text" placeholder="Enter a verify query (optional)" style="flex:1;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit" />
        <button id="fl-verify-run" style="padding:8px 12px;border-radius:8px;border:none;background:#6b46c1;color:#fff;font-weight:600">Run Verify</button>
      </div>
      <pre id="fl-verify-out" style="max-height:240px;overflow:auto;margin:0;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"></pre>
    `;

    // Wire the action
    const runBtn = panel.querySelector("#fl-verify-run");
    const outEl = panel.querySelector("#fl-verify-out");
    const statusEl = panel.querySelector("#fl-verify-status");
    const qInput = panel.querySelector("#fl-verify-q");

    const withPrefix = (p) => {
      try {
        const ap = (window.__NEXT_DATA__ && window.__NEXT_DATA__.assetPrefix) || "";
        return ap ? `${ap}${p}` : p;
      } catch { return p; }
    };

    runBtn.addEventListener("click", async () => {
      try {
        statusEl.textContent = "Running…";
        outEl.textContent = "";
        const q = qInput.value || "";
        const resp = await fetch(withPrefix("/api/verify_race"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(q ? { q } : {})
        });
        const json = await resp.json().catch(() => ({}));
        statusEl.textContent = resp.ok ? "OK" : `Error ${resp.status}`;
        outEl.textContent = JSON.stringify(json, null, 2).slice(0, 8000);
        log("verify_race response", resp.status, json);
      } catch (e) {
        statusEl.textContent = "Error";
        outEl.textContent = String(e && e.message || e);
        console.error("[FL:verify-tab] run error", e);
      }
    });

    contentRoot.appendChild(panel);
    return panel;
  }

  function ensureVerifyTab() {
    const sys = findTabSystem();
    if (!sys) { log("tab system not found"); return; }
    const { tablist, tabs, contentRoot } = sys;

    // Find a sibling tab to copy classes/attrs (Strategy preferred)
    let refTab = tabs.find(t => /strategy/i.test((t.textContent||"").trim())) || tabs[0];
    if (!refTab) { log("no reference tab"); return; }

    // Copy class + data-attrs for visual parity
    const { className: refClass, dataAttrs } = copyInactiveClassFrom(refTab);

    // Create Verify tab if missing
    let verifyTab = qs(tablist, "#fl-verify-tab");
    if (!verifyTab) {
      verifyTab = document.createElement(refTab.tagName.toLowerCase() === "a" ? "a" : "button");
      verifyTab.id = "fl-verify-tab";
      verifyTab.textContent = "Verify";
      verifyTab.type = "button";
      verifyTab.className = refClass;            // inherits theme classes
      setAria(verifyTab, false);
      for (const k in dataAttrs) verifyTab.setAttribute(k, dataAttrs[k]);
      tablist.appendChild(verifyTab);
    } else {
      verifyTab.className = refClass;
      setAria(verifyTab, false);
    }

    // Ensure panel exists
    const panel = makeVerifyPanel(contentRoot);

    // Click behavior
    function openVerify() {
      // deselect other tabs and hide panels
      deselectAllTabs(tablist);
      hideAllPanels(contentRoot);

      // select verify tab
      setAria(verifyTab, true);
      verifyTab.classList.add("active", "is-active", "selected");

      // show verify panel
      panel.style.display = "";
      panel.removeAttribute("aria-hidden");

      // focus into input
      const input = panel.querySelector("#fl-verify-q");
      if (input) try { input.focus(); } catch {}
    }

    // Wire the click + keyboard
    verifyTab.addEventListener("click", openVerify);
    verifyTab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openVerify(); }
    });

    // Export opener for FAB/loader
    window.__FL_OPEN_VERIFY_PANEL__ = openVerify;

    log("Verify tab mounted");
  }

  onReady(ensureVerifyTab);
})();
