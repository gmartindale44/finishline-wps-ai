// FinishLine WPS AI — Hardened Photo Picker Bootstrap
// - Creates/ensures a hidden file input
// - Opens the OS picker via global click delegation (works for any "Choose Photos / PDF" button)
// - Provides clear console logs for debugging
(function () {
  if (window.__finishline_picker_bootstrapped__) return;
  window.__finishline_picker_bootstrapped__ = true;

  function log(...args) { console.log("[Picker]", ...args); }
  function warn(...args) { console.warn("[Picker]", ...args); }
  function error(...args) { console.error("[Picker]", ...args); }

  // 1) Ensure hidden <input type="file">
  let input = document.getElementById("photo-input-main");
  if (!input) {
    input = document.createElement("input");
    input.id = "photo-input-main";
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.style.display = "none";
    document.body.appendChild(input);
    log("Inserted hidden file input #photo-input-main");
  } else {
    log("Found existing #photo-input-main");
  }

  // 2) Overlay & z-index guard so clicks aren't swallowed
  const style = document.createElement("style");
  style.setAttribute("data-picker-guard", "true");
  style.textContent = `
    /* Prevent common overlays from consuming clicks over the picker button */
    .overlay, .backdrop, .mask, .modal-overlay, .loading, [data-blocking-overlay="true"] {
      pointer-events: none !important;
    }
    /* Keep any explicit picker label/button clickable and on top if needed */
    .photo-picker-label, [data-action="choose"] {
      position: relative;
      z-index: 1000 !important;
      pointer-events: auto !important;
    }
  `;
  document.head.appendChild(style);

  // 3) State: selected file enables "Analyze" button (if present)
  const btnAnalyze =
    document.querySelector('[data-action="analyze"]') ||
    Array.from(document.querySelectorAll("button")).find(b =>
      /analyze photos with ai/i.test(b.textContent || "")
    ) || null;

  let selectedFile = null;
  input.addEventListener("change", (e) => {
    selectedFile = (e.target.files && e.target.files[0]) || null;
    log("onFilesSelected:", selectedFile && { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type });
    if (btnAnalyze) btnAnalyze.disabled = !selectedFile;
  });

  // 4) Global click delegation: ANY "Choose Photos / PDF" (or data-action="choose") opens the picker
  const chooseRegex = /choose\s*(photos?|file)?\s*(\/\s*pdf)?|upload/i;
  document.addEventListener("click", (evt) => {
    const el = evt.target.closest('[data-action="choose"], .photo-picker-label, button');
    if (!el) return;
    const isChoose = el.dataset && el.dataset.action === "choose";
    const txt = (el.textContent || "").trim();
    if (isChoose || chooseRegex.test(txt)) {
      // Don't let other handlers cancel this path
      evt.preventDefault();
      evt.stopPropagation();
      if (!input) {
        error("No file input available; cannot open picker.");
        return;
      }
      // Allow re-selecting the same file
      input.value = "";
      log("Opening OS file dialog…");
      input.click();
    }
  }, true); // capture = true helps bypass rogue onclicks swallowing the event

  // Optional: expose a tiny API for tests or future use
  window.__finishline_picker = {
    open() { input && (input.value = "", input.click()); },
    input,
    get selectedFile() { return selectedFile; }
  };

  log("Hardened photo picker bootstrap ready");
})();
