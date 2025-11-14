// public/js/verify-button.js
(function () {
  if (typeof document === "undefined") return;

  console.log("[FL] verify-button.js loaded");

  function todayISO() {
    try {
      return new Date().toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }

  function bindVerifyButton() {
    const btn = document.getElementById("fl-verify-btn");

    if (!btn) {
      console.error("[FL] Verify button not found (#fl-verify-btn)");
      return;
    }

    console.log("[FL] Verify button bound");

    btn.addEventListener("click", function handleVerifyClick(event) {
      event.preventDefault();
      console.log("[FL] Verify clicked");

      const trackInput =
        document.querySelector("[data-role='fl-track']") ||
        document.getElementById("fl-track");

      const raceInput =
        document.querySelector("[data-role='fl-race']") ||
        document.getElementById("fl-race-no");

      const dateInput =
        document.querySelector("[data-role='fl-date']") ||
        document.getElementById("fl-race-date");

      const track = trackInput && "value" in trackInput ? trackInput.value : "";
      const raceNo =
        raceInput && "value" in raceInput ? String(raceInput.value || "").trim() : "";
      const rawDate =
        dateInput && "value" in dateInput ? String(dateInput.value || "").trim() : "";
      const date = rawDate || todayISO();

      const initial = { track, raceNo, date };

      if (typeof window !== "undefined" && typeof window.__FL_OPEN_VERIFY_MODAL__ === "function") {
        console.log("[FL] Opening verify modal with:", initial);
        window.__FL_OPEN_VERIFY_MODAL__(initial);
      } else {
        console.error("[FL] ERROR: __FL_OPEN_VERIFY_MODAL__ is not defined");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindVerifyButton);
  } else {
    bindVerifyButton();
  }
})();
