/**
 * Verify Tab – adds a first-class verification workflow inside the Predictions modal.
 * - Mounts a new tab beside the existing ones (Strategy, etc.).
 * - Prefills race context from the page but allows user edits.
 * - Calls /api/verify_race and renders results (top 5) with cache awareness.
 * - Guards against duplicate mounts and survives modal re-renders.
 */
(() => {
  const BOOT = "data-fl-verify-mounted";
  if (document.documentElement.hasAttribute(BOOT)) return;
  document.documentElement.setAttribute(BOOT, "1");

  const log = (...a) => console.debug("[VerifyTab]", ...a);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const text = (el) => (el?.textContent || "").trim();

  function findTabStrip() {
    const CANDIDATE_TEXTS = ["Predictions", "Exotic Ideas", "Strategy"];
    const clickables = $$("button, [role='tab'], a");
    const containers = new Map();
    clickables.forEach((el) => {
      const t = text(el);
      if (!t) return;
      if (CANDIDATE_TEXTS.some((x) => t.toLowerCase() === x.toLowerCase())) {
        const p = el.parentElement;
        if (p) containers.set(p, (containers.get(p) || 0) + 1);
      }
    });
    const best = [...containers.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (!best) {
      log("Tab strip not found yet.");
    }
    return best;
  }

  function makeModal() {
    const wrap = document.createElement("div");
    wrap.style.position = "fixed";
    wrap.style.inset = "0";
    wrap.style.background = "rgba(0,0,0,0.45)";
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.zIndex = "9999";

    const card = document.createElement("div");
    card.style.minWidth = "480px";
    card.style.maxWidth = "680px";
    card.style.background = "var(--bg, #121316)";
    card.style.color = "inherit";
    card.style.border = "1px solid rgba(255,255,255,0.08)";
    card.style.borderRadius = "12px";
    card.style.padding = "16px";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    card.innerHTML = `
      <h3 style="margin:0 0 8px 0">Verify result (Google CSE)</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <label style="display:flex;flex-direction:column;gap:4px">
          <span>Track</span>
          <input id="flv-track" class="fl-input" style="min-width:220px"/>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span>Race #</span>
          <input id="flv-race" class="fl-input" style="width:90px"/>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span>Date (YYYY-MM-DD)</span>
          <input id="flv-date" class="fl-input" style="width:150px"/>
        </label>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:8px">
        <button id="flv-run" class="fl-btn">Verify</button>
        <button id="flv-close" class="fl-btn fl-btn-secondary">Close</button>
      </div>
      <div id="flv-status" style="font-size:0.95rem;opacity:0.9;margin-bottom:6px"></div>
      <div id="flv-out" class="fl-code" style="white-space:pre-wrap;max-height:50vh;overflow:auto"></div>
    `;
    wrap.appendChild(card);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.remove();
    });
    return wrap;
  }

  function currentContext() {
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

  function insertVerifyButton(strip) {
    const templateBtn =
      strip.querySelector("button, [role='tab'], a") || document.createElement("button");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Verify";
    btn.setAttribute("data-fl-verify-btn", "1");
    btn.className = templateBtn.className || "tab";
    btn.style.marginLeft = "6px";
    strip.appendChild(btn);
    btn.addEventListener("click", () => {
      const ctx = currentContext();
      const modal = makeModal();
      document.body.appendChild(modal);
      $("#flv-track", modal).value = ctx.track || "";
      $("#flv-race", modal).value = ctx.raceNo || "";
      $("#flv-date", modal).value = ctx.date || "";
      const run = $("#flv-run", modal);
      const close = $("#flv-close", modal);
      const status = $("#flv-status", modal);
      const out = $("#flv-out", modal);
      close.onclick = () => modal.remove();
      run.onclick = async () => {
        try {
          run.disabled = true;
          status.textContent = "Verifying…";
          out.textContent = "";
          const payload = {
            track: $("#flv-track", modal).value.trim(),
            raceNo: $("#flv-race", modal).value.trim(),
            date: $("#flv-date", modal).value.trim(),
            distance: ctx.distance || "",
            surface: ctx.surface || "",
            strategy: ctx.strategy || "",
            ai_picks: ctx.ai_picks || "",
          };
          if (!payload.track || !payload.raceNo || !payload.date)
            throw new Error("Track, race #, and date are required.");
          const res = await postJSON("/api/verify_race", payload);
          const top = res.top || res.topHit || {};
          status.textContent = `OK — ${res.count ?? (res.items?.length ?? 0)} results`;
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
          run.disabled = false;
        }
      };
    });
    log("Verify button inserted.");
  }

  function tryMount() {
    const strip = findTabStrip();
    if (!strip) return false;
    if (strip.querySelector("[data-fl-verify-btn]")) return true;
    insertVerifyButton(strip);
    return true;
  }

  const iv = setInterval(() => {
    if (tryMount()) {
      clearInterval(iv);
    }
  }, 300);

  document.addEventListener("DOMContentLoaded", tryMount);
})();
