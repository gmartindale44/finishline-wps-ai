(function () {
  if (typeof document === "undefined") return;

  console.log("[FL] verify-button.js loaded");

  function handleClick(event) {
    const btn = event.target.closest("[data-role='fl-open-verify']");
    if (!btn) return;

    console.log("[FL] Verify clicked");

    if (typeof window.__FL_OPEN_VERIFY_MODAL__ === "function") {
      // Collect initial values
      const trackInput =
        document.querySelector("[data-role='fl-track']") ||
        document.querySelector("#track") ||
        document.querySelector("input[placeholder*='track' i]") ||
        document.querySelector("input[id*='track' i]") ||
        document.querySelector("input[name*='track' i]");
      const raceInput =
        document.querySelector("[data-role='fl-race']") ||
        document.querySelector("#raceNo") ||
        document.querySelector("input[placeholder*='race' i]") ||
        document.querySelector("input[id*='race' i]") ||
        document.querySelector("input[name*='race' i]");

      const initial = {
        track: trackInput ? trackInput.value : "",
        raceNo: raceInput ? raceInput.value : ""
      };

      window.__FL_OPEN_VERIFY_MODAL__(initial);
    } else {
      console.error("[FL] ERROR: __FL_OPEN_VERIFY_MODAL__ missing");
    }
  }

  document.addEventListener("click", handleClick);

  // Also create Verify button dynamically if toolbar exists
  function mountVerifyButton() {
    const pills = Array.from(document.querySelectorAll("button, a")).filter(b => {
      const t = (b.textContent || "").trim().toLowerCase();
      return t === "copy" || t === "pin" || t === "new race";
    });
    if (!pills.length) return;
    const toolbar = pills[0].parentElement;
    if (!toolbar) return;
    if (document.querySelector("#fl-verify-pill")) return;

    const ref = pills.find(b => /new race/i.test((b.textContent || "").trim())) || pills[0];
    if (!ref) return;

    const pill = ref.cloneNode(true);
    pill.id = "fl-verify-pill";
    pill.textContent = "Verify";
    pill.setAttribute("data-role", "fl-open-verify");
    if (pill.tagName.toLowerCase() === "a") pill.removeAttribute("href");
    toolbar.appendChild(pill);
  }

  const mo = new MutationObserver(() => mountVerifyButton());
  mo.observe(document.documentElement, { subtree: true, childList: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountVerifyButton, { once: true });
  } else {
    mountVerifyButton();
  }
})();
