(function () {
  const BUTTON_ATTR = "data-fl-verify-btn";
  const attached = new WeakSet();

  function text(el) {
    return (el?.textContent || "").trim();
  }

  function inferContext() {
    const ctx = {};
    ctx.track =
      document.querySelector("[data-track]")?.getAttribute("data-track") ||
      text(document.querySelector(".fl-track-name")) ||
      text(document.querySelector("header .track-name")) ||
      "";

    const raceStr =
      text(document.querySelector(".fl-race-no")) ||
      text(document.querySelector("[data-race]")) ||
      text(document.querySelector("[data-race-number]")) ||
      "";
    const raceMatch =
      raceStr.match(/\bRace\s*#?\s*(\d+)\b/i) ||
      raceStr.match(/\bR(\d+)\b/i) ||
      raceStr.match(/\b(\d+)\b/);
    ctx.raceNo = raceMatch ? raceMatch[1] : "";

    ctx.date =
      document
        .querySelector("[data-race-date]")
        ?.getAttribute("data-race-date") || "";
    if (!ctx.date) {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      ctx.date = `${d.getFullYear()}-${m}-${day}`;
    }

    ctx.strategy =
      text(document.querySelector(".fl-strategy-active")) ||
      text(document.querySelector(".fl-strategy-name")) ||
      "";
    const picks = Array.from(
      document.querySelectorAll(
        ".fl-pick, .fl-strategy .fl-pick, [data-fl-pick]"
      )
    )
      .map((el) => text(el))
      .filter(Boolean);
    if (picks.length) ctx.ai_picks = picks.join(" | ");

    ctx.distance = text(document.querySelector(".fl-distance")) || "";
    ctx.surface = text(document.querySelector(".fl-surface")) || "";

    return ctx;
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  }

  function ensureButton(container) {
    if (!container || attached.has(container)) return;
    if (container.querySelector(`[${BUTTON_ATTR}]`)) return;

    const btn = document.createElement("button");
    btn.setAttribute(BUTTON_ATTR, "true");
    btn.className = "fl-btn fl-btn-secondary";
    btn.textContent = "Verify result";
    btn.style.marginLeft = "8px";

    btn.onclick = async () => {
      try {
        btn.disabled = true;
        btn.textContent = "Verifying…";
        const ctx = inferContext();

        if (!ctx.track)
          ctx.track = prompt("Track name?", ctx.track || "") || "";
        if (!ctx.raceNo)
          ctx.raceNo = prompt("Race number?", ctx.raceNo || "") || "";
        if (!ctx.date)
          ctx.date = prompt("Race date (YYYY-MM-DD)?", ctx.date || "") || "";

        if (!ctx.track || !ctx.raceNo || !ctx.date) {
          throw new Error("Track, race #, and date are required.");
        }

        const payload = await postJSON("/api/verify_race", {
          track: ctx.track,
          raceNo: ctx.raceNo,
          date: ctx.date,
          distance: ctx.distance,
          surface: ctx.surface,
          strategy: ctx.strategy,
          ai_picks: ctx.ai_picks || "",
        });
        console.info("[verify_race]", payload);

        alert(
          `Verified via CSE:\n` +
            `Query: ${payload.query}\n` +
            `Results: ${payload.count}\n` +
            (payload.top?.title ? `Top: ${payload.top.title}\n` : "") +
            (payload.top?.link ? `Link: ${payload.top.link}\n` : "")
        );
      } catch (err) {
        console.error(err);
        alert(`Verification failed: ${err.message || err}`);
      } finally {
        btn.disabled = false;
        btn.textContent = "Verify result";
      }
    };

    container.appendChild(btn);
    attached.add(container);
  }

  const observer = new MutationObserver(() => {
    const selectors = [
      ".fl-modal .fl-toolbar",
      ".fl-modal header .actions",
      ".fl-predictions .toolbar",
      ".fl-strategy .toolbar",
      ".fl-strategy-modal .fl-toolbar",
      "[data-fl-toolbar]",
    ];
    selectors
      .map((sel) => document.querySelectorAll(sel))
      .forEach((nodeList) => {
        nodeList.forEach((container) => ensureButton(container));
      });
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
  });
})();

